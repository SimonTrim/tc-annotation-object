import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  TrimbleAPI,
  ViewerSelection,
  ObjectProperties,
  PropertyToggleState,
  AnnotationSettings,
  ConnectProject,
  SortMode,
} from "@/types";
import {
  fetchObjectProperties,
  fetchObjectBoundingBoxes,
  enrichObjectProperties,
} from "@/lib/viewerBridge";
import {
  createAnnotationsForObject,
  removeMarkupIds,
} from "@/lib/annotationEngine";
import {
  REF_GROUP,
  IDENTITY_GROUP,
  TOP_LEVEL_LABELS,
  PRODUCT_LABELS,
  SKIP_TOP_LEVEL,
} from "@/lib/propertyMapping";

const LOG = "[AnnotationObj]";
const REFRESH_DEBOUNCE = 500;

export function useAnnotations(
  api: TrimbleAPI | null,
  selection: ViewerSelection[],
  settings: AnnotationSettings,
  project: ConnectProject | null,
  accessToken: string | null,
) {
  const [properties, setProperties] = useState<PropertyToggleState[]>([]);
  const [enabledOrder, setEnabledOrder] = useState<string[]>([]);
  const [objectsProps, setObjectsProps] = useState<ObjectProperties[]>([]);
  const [totalAnnotations, setTotalAnnotations] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("pset");

  // Suivi des annotations par objet : "modelId:runtimeId" → markup IDs
  const markupMapRef = useRef<Map<string, number[]>>(new Map());

  const propsRef = useRef(properties);
  propsRef.current = properties;
  const enabledOrderRef = useRef(enabledOrder);
  enabledOrderRef.current = enabledOrder;
  const objectsPropsRef = useRef(objectsProps);
  objectsPropsRef.current = objectsProps;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pendingRefreshRef = useRef(false);

  const extractProperties = useCallback(
    (propsArray: ObjectProperties[], currentOrder: Set<string>) => {
      const seen = new Set<string>();
      const result: PropertyToggleState[] = [];

      const add = (pset: string, name: string) => {
        const key = `${pset}::${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        result.push({ key, propertySet: pset, propertyName: name, enabled: currentOrder.has(key) });
      };

      for (const obj of propsArray) {
        const raw = obj as unknown as Record<string, unknown>;

        // ── Référence Objet : tous les champs scalaires du top-level ──
        for (const [field, val] of Object.entries(raw)) {
          if (SKIP_TOP_LEVEL.has(field) || val == null || val === "" || typeof val === "object") continue;
          const label = TOP_LEVEL_LABELS[field] ?? field;
          add(REF_GROUP, label);
        }

        // ── Identité : tous les champs scalaires du product ──
        if (obj.product) {
          const prodRaw = obj.product as unknown as Record<string, unknown>;
          for (const [field, val] of Object.entries(prodRaw)) {
            if (val == null || val === "" || typeof val === "object") continue;
            const label = PRODUCT_LABELS[field] ?? field;
            add(IDENTITY_GROUP, label);
          }
        }

        // ── PropertySets ──
        for (const pset of obj.properties ?? []) {
          const setName = pset.set
            ?? ((pset as unknown as Record<string, unknown>).name as string)
            ?? "Autres";
          for (const prop of pset.properties ?? []) {
            add(setName, prop.name);
          }
        }
      }
      return result;
    },
    [],
  );

  useEffect(() => {
    const totalCount = selection.reduce(
      (sum, s) => sum + s.objectRuntimeIds.length,
      0,
    );

    console.log(`${LOG} Selection effect: ${totalCount} object(s)`);

    if (totalCount === 0) {
      setObjectsProps([]);
      setProperties([]);
      setMaxReached(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setMaxReached(totalCount > settings.maxObjects);

      try {
        const allProps: ObjectProperties[] = [];
        for (const sel of selection) {
          const ids = sel.objectRuntimeIds.slice(0, settings.maxObjects - allProps.length);
          if (ids.length === 0) break;

          console.log(`${LOG} Fetching props for model=${sel.modelId}, ids=[${ids.join(",")}]`);
          const batch = await fetchObjectProperties(api, sel.modelId, ids);
          console.log(`${LOG} Got ${batch.length} results`, batch);

          // Enrichir avec GUIDs, model info et service psets
          const enriched = api
            ? await enrichObjectProperties(api, project, accessToken, sel.modelId, batch, ids)
            : batch;

          allProps.push(...enriched);
        }

        if (!cancelled) {
          setObjectsProps(allProps);
          const currentOrder = new Set(enabledOrderRef.current);
          setProperties(extractProperties(allProps, currentOrder));
          console.log(`${LOG} Properties loaded: ${allProps.length} objects, preserved ${currentOrder.size} enabled keys`);
        }
      } catch (err) {
        console.error(`${LOG} Error loading properties:`, err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, selection, extractProperties, project, accessToken]);

  const enabledKey = useMemo(
    () => enabledOrder.join("|"),
    [enabledOrder],
  );

  const settingsKey = `${settings.color}|${settings.separator}|${settings.horizontal}|${settings.showUnits}`;

  const doRefresh = useCallback(async () => {
    if (!api) return;

    if (refreshingRef.current) {
      pendingRefreshRef.current = true;
      console.log(`${LOG} Refresh queued (already running)`);
      return;
    }
    refreshingRef.current = true;

    try {
      const currentOrder = enabledOrderRef.current;
      const currentProps = propsRef.current;
      const currentObjProps = objectsPropsRef.current;
      const currentSelection = selectionRef.current;
      const currentSettings = settingsRef.current;

      const orderedEnabled = currentOrder
        .map((key) => currentProps.find((p) => p.key === key))
        .filter((p): p is PropertyToggleState => p != null && p.enabled);

      // Si aucune propriété activée ou aucun objet, supprimer les annotations des objets sélectionnés
      if (orderedEnabled.length === 0 || currentObjProps.length === 0) {
        for (const sel of currentSelection) {
          for (const runtimeId of sel.objectRuntimeIds) {
            const objKey = `${sel.modelId}:${runtimeId}`;
            const ids = markupMapRef.current.get(objKey);
            if (ids && ids.length > 0) {
              await removeMarkupIds(api, ids);
              markupMapRef.current.delete(objKey);
            }
          }
        }
        setTotalAnnotations(markupMapRef.current.size);
        return;
      }

      console.log(`${LOG} Creating annotations: ${currentObjProps.length} objects, ${orderedEnabled.length} props`);

      for (const sel of currentSelection) {
        const limitedIds = sel.objectRuntimeIds.slice(
          0,
          currentSettings.maxObjects,
        );
        if (limitedIds.length === 0) break;

        // Supprimer les annotations existantes pour ces objets avant d'en créer de nouvelles
        for (const runtimeId of limitedIds) {
          const objKey = `${sel.modelId}:${runtimeId}`;
          const existingIds = markupMapRef.current.get(objKey);
          if (existingIds && existingIds.length > 0) {
            await removeMarkupIds(api, existingIds);
            markupMapRef.current.delete(objKey);
          }
        }

        const bboxes = await fetchObjectBoundingBoxes(api, sel.modelId, limitedIds);

        for (const runtimeId of limitedIds) {
          const props = currentObjProps.find(
            (p) => p.id === runtimeId
              || (p as unknown as Record<string, unknown>).runtimeId === runtimeId,
          );
          const bbox = bboxes.find(
            (b) => b.runtimeId === runtimeId
              || (b as unknown as Record<string, unknown>).id === runtimeId,
          );

          if (!props || !bbox) continue;

          const annotated = await createAnnotationsForObject(
            api, sel.modelId, runtimeId, props, orderedEnabled, bbox, currentSettings,
          );
          if (annotated) {
            const objKey = `${sel.modelId}:${runtimeId}`;
            markupMapRef.current.set(objKey, annotated.markupIds);
          }
        }
      }

      setTotalAnnotations(markupMapRef.current.size);
      console.log(`${LOG} Annotations: ${markupMapRef.current.size} objects annotated`);
    } finally {
      refreshingRef.current = false;

      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        console.log(`${LOG} Running queued refresh`);
        doRefresh();
      }
    }
  }, [api]);

  useEffect(() => {
    clearTimeout(refreshTimerRef.current);

    if (!enabledKey) {
      // Toutes les propriétés désactivées : supprimer les annotations des objets actuellement sélectionnés
      if (api) {
        const currentSelection = selectionRef.current;
        const idsToRemove: number[] = [];
        for (const sel of currentSelection) {
          for (const runtimeId of sel.objectRuntimeIds) {
            const objKey = `${sel.modelId}:${runtimeId}`;
            const ids = markupMapRef.current.get(objKey);
            if (ids) {
              idsToRemove.push(...ids);
              markupMapRef.current.delete(objKey);
            }
          }
        }
        if (idsToRemove.length > 0) {
          removeMarkupIds(api, idsToRemove).then(() => {
            setTotalAnnotations(markupMapRef.current.size);
          });
        }
      }
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      doRefresh();
    }, REFRESH_DEBOUNCE);

    return () => clearTimeout(refreshTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, settingsKey, doRefresh, api]);

  /** Supprimer TOUTES les annotations */
  const clearAllAnnotations = useCallback(async () => {
    if (!api) return;

    const allIds = Array.from(markupMapRef.current.values()).flat();
    markupMapRef.current.clear();

    if (allIds.length > 0) {
      await removeMarkupIds(api, allIds);
    }

    setTotalAnnotations(0);
    setProperties((prev) => prev.map((p) => ({ ...p, enabled: false })));
    setEnabledOrder([]);
    console.log(`${LOG} All annotations cleared`);
  }, [api]);

  const toggleProperty = useCallback((key: string) => {
    setProperties((prev) =>
      prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)),
    );
    setEnabledOrder((prev) => {
      if (prev.includes(key)) {
        return prev.filter((k) => k !== key);
      }
      return [...prev, key];
    });
  }, []);

  const toggleAll = useCallback((enabled: boolean) => {
    setProperties((prev) => prev.map((p) => ({ ...p, enabled })));
    if (enabled) {
      setEnabledOrder((prev) => {
        const allKeys = properties.map((p) => p.key);
        const existing = new Set(prev);
        const newKeys = allKeys.filter((k) => !existing.has(k));
        return [...prev, ...newKeys];
      });
    } else {
      setEnabledOrder([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  const moveProperty = useCallback((key: string, direction: "up" | "down") => {
    setEnabledOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[targetIdx]] = [next[targetIdx]!, next[idx]!];
      return next;
    });
  }, []);

  const reorderProperty = useCallback((fromIndex: number, toIndex: number) => {
    setEnabledOrder((prev) => {
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    });
  }, []);

  const sortedProperties = useMemo(() => {
    const sorted = [...properties];
    const comparator = (a: PropertyToggleState, b: PropertyToggleState) => {
      switch (sortMode) {
        case "alpha-asc":
          return a.propertyName.localeCompare(b.propertyName);
        case "alpha-desc":
          return b.propertyName.localeCompare(a.propertyName);
        case "pset":
        default:
          return a.propertySet.localeCompare(b.propertySet)
            || a.propertyName.localeCompare(b.propertyName);
      }
    };
    return sorted.sort(comparator);
  }, [properties, sortMode]);

  const groupedProperties = useMemo(() => {
    return sortedProperties.reduce<Record<string, PropertyToggleState[]>>(
      (acc, prop) => {
        const group = prop.propertySet;
        if (!acc[group]) acc[group] = [];
        acc[group]!.push(prop);
        return acc;
      },
      {},
    );
  }, [sortedProperties]);

  const orderedEnabledProps = useMemo(() => {
    return enabledOrder
      .map((key) => properties.find((p) => p.key === key))
      .filter((p): p is PropertyToggleState => p != null && p.enabled);
  }, [enabledOrder, properties]);

  const enabledCount = orderedEnabledProps.length;

  return {
    allProperties: sortedProperties,
    groupedProperties,
    orderedEnabledProps,
    objectsProps,
    isLoading,
    maxReached,
    enabledCount,
    totalAnnotations,
    sortMode,
    setSortMode,
    toggleProperty,
    toggleAll,
    moveProperty,
    reorderProperty,
    clearAllAnnotations,
  };
}
