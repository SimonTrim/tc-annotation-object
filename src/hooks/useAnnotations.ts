import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import type {
  TrimbleAPI,
  ViewerSelection,
  ObjectProperties,
  PropertyToggleState,
  AnnotationSettings,
  AnnotatedObject,
  SortMode,
} from "@/types";
import {
  fetchObjectProperties,
  fetchObjectBoundingBoxes,
} from "@/lib/viewerBridge";
import {
  createAnnotationsForObject,
  removeMarkupIds,
} from "@/lib/annotationEngine";

const LOG = "[AnnotationObj]";
const REFRESH_DEBOUNCE = 500;

export function useAnnotations(
  api: TrimbleAPI | null,
  selection: ViewerSelection[],
  settings: AnnotationSettings,
) {
  const [properties, setProperties] = useState<PropertyToggleState[]>([]);
  const [enabledOrder, setEnabledOrder] = useState<string[]>([]);
  const [objectsProps, setObjectsProps] = useState<ObjectProperties[]>([]);
  const [annotatedObjects, setAnnotatedObjects] = useState<AnnotatedObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("pset");

  const activeMarkupIdsRef = useRef<number[]>([]);

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
    (propsArray: ObjectProperties[]) => {
      const seen = new Set<string>();
      const result: PropertyToggleState[] = [];

      for (const obj of propsArray) {
        // Identité — champs spéciaux du product
        if (obj.class) {
          const key = "Identité::Classe IFC";
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ key, propertySet: "Identité", propertyName: "Classe IFC", enabled: false });
          }
        }
        if (obj.product?.name) {
          const key = "Identité::Nom";
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ key, propertySet: "Identité", propertyName: "Nom", enabled: false });
          }
        }
        if (obj.product?.objectType) {
          const key = "Identité::Type d'objet";
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ key, propertySet: "Identité", propertyName: "Type d'objet", enabled: false });
          }
        }
        if (obj.product?.description) {
          const key = "Identité::Description";
          if (!seen.has(key)) {
            seen.add(key);
            result.push({ key, propertySet: "Identité", propertyName: "Description", enabled: false });
          }
        }

        // PropertySets — utiliser le vrai nom du PSet
        for (const pset of obj.properties ?? []) {
          const setName = pset.set ?? "Autres";
          for (const prop of pset.properties ?? []) {
            const key = `${setName}::${prop.name}`;
            if (!seen.has(key)) {
              seen.add(key);
              result.push({
                key,
                propertySet: setName,
                propertyName: prop.name,
                enabled: false,
              });
            }
          }
        }
      }
      return result;
    },
    [],
  );

  const cleanupMarkups = useCallback(async () => {
    if (!api || activeMarkupIdsRef.current.length === 0) return;
    const ids = [...activeMarkupIdsRef.current];
    activeMarkupIdsRef.current = [];
    await removeMarkupIds(api, ids);
  }, [api]);

  useEffect(() => {
    const totalCount = selection.reduce(
      (sum, s) => sum + s.objectRuntimeIds.length,
      0,
    );

    console.log(`${LOG} Selection effect: ${totalCount} object(s)`);

    if (totalCount === 0) {
      setObjectsProps([]);
      setProperties([]);
      setEnabledOrder([]);
      setMaxReached(false);
      cleanupMarkups().then(() => setAnnotatedObjects([]));
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
          allProps.push(...batch);
        }

        if (!cancelled) {
          setObjectsProps(allProps);
          setProperties(extractProperties(allProps));
          setEnabledOrder([]);
          console.log(`${LOG} Properties loaded: ${allProps.length} objects`);
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
  }, [api, selection, extractProperties, cleanupMarkups]);

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
      await cleanupMarkups();
      setAnnotatedObjects([]);

      const currentOrder = enabledOrderRef.current;
      const currentProps = propsRef.current;
      const currentObjProps = objectsPropsRef.current;
      const currentSelection = selectionRef.current;
      const currentSettings = settingsRef.current;

      // Construire la liste ordonnée des propriétés activées
      const orderedEnabled = currentOrder
        .map((key) => currentProps.find((p) => p.key === key))
        .filter((p): p is PropertyToggleState => p != null && p.enabled);

      if (orderedEnabled.length === 0 || currentObjProps.length === 0) {
        return;
      }

      console.log(`${LOG} Creating annotations: ${currentObjProps.length} objects, ${orderedEnabled.length} props`);

      const newAnnotated: AnnotatedObject[] = [];

      for (const sel of currentSelection) {
        const limitedIds = sel.objectRuntimeIds.slice(
          0,
          currentSettings.maxObjects - newAnnotated.length,
        );
        if (limitedIds.length === 0) break;

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
            newAnnotated.push(annotated);
            activeMarkupIdsRef.current.push(...annotated.markupIds);
          }
        }
      }

      setAnnotatedObjects(newAnnotated);
      console.log(`${LOG} Annotations created: ${newAnnotated.length}`);
    } finally {
      refreshingRef.current = false;

      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        console.log(`${LOG} Running queued refresh`);
        doRefresh();
      }
    }
  }, [api, cleanupMarkups]);

  useEffect(() => {
    clearTimeout(refreshTimerRef.current);

    if (!enabledKey) {
      cleanupMarkups().then(() => setAnnotatedObjects([]));
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      doRefresh();
    }, REFRESH_DEBOUNCE);

    return () => clearTimeout(refreshTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, settingsKey, doRefresh]);

  /** Toggle une propriété on/off et mettre à jour l'ordre */
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

  /** Déplacer une propriété dans l'ordre (haut/bas) */
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

  /** Drag & drop: déplacer de fromIndex à toIndex */
  const reorderProperty = useCallback((fromIndex: number, toIndex: number) => {
    setEnabledOrder((prev) => {
      if (fromIndex === toIndex) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      return next;
    });
  }, []);

  /** Propriétés triées par groupe pour la liste principale */
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

  /** Propriétés activées dans l'ordre personnalisé */
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
    annotatedObjects,
    isLoading,
    maxReached,
    enabledCount,
    sortMode,
    setSortMode,
    toggleProperty,
    toggleAll,
    moveProperty,
    reorderProperty,
  };
}
