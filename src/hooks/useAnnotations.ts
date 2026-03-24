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
  removeAllAnnotations,
} from "@/lib/annotationEngine";

const LOG = "[AnnotationObj]";
const REFRESH_DEBOUNCE = 400;

export function useAnnotations(
  api: TrimbleAPI | null,
  selection: ViewerSelection[],
  settings: AnnotationSettings,
) {
  const [properties, setProperties] = useState<PropertyToggleState[]>([]);
  const [objectsProps, setObjectsProps] = useState<ObjectProperties[]>([]);
  const [annotatedObjects, setAnnotatedObjects] = useState<AnnotatedObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("pset");

  const annotatedRef = useRef<AnnotatedObject[]>([]);
  annotatedRef.current = annotatedObjects;
  const propsRef = useRef(properties);
  propsRef.current = properties;
  const objectsPropsRef = useRef(objectsProps);
  objectsPropsRef.current = objectsProps;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // Mutex pour empêcher les refreshes concurrents
  const refreshingRef = useRef(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const extractProperties = useCallback(
    (propsArray: ObjectProperties[]) => {
      const seen = new Set<string>();
      const result: PropertyToggleState[] = [];

      for (const obj of propsArray) {
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

  /** Charger les propriétés quand la sélection change */
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
      if (api && annotatedRef.current.length > 0) {
        removeAllAnnotations(api, annotatedRef.current).then(() => {
          setAnnotatedObjects([]);
        });
      }
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
  }, [api, selection, extractProperties]);

  const enabledKey = useMemo(
    () => properties.filter((p) => p.enabled).map((p) => p.key).join("|"),
    [properties],
  );

  const settingsKey = `${settings.color}|${settings.separator}|${settings.horizontal}|${settings.showUnits}`;

  /** Refresh sérialisé — attend la fin du précédent avant de lancer le suivant */
  const doRefresh = useCallback(async () => {
    if (!api) return;

    if (refreshingRef.current) {
      console.log(`${LOG} Refresh skipped (already running)`);
      return;
    }
    refreshingRef.current = true;

    try {
      const currentProps = propsRef.current;
      const currentObjProps = objectsPropsRef.current;
      const currentSelection = selectionRef.current;
      const currentSettings = settingsRef.current;

      // Supprimer les anciennes annotations (attend que l'atlas settle)
      await removeAllAnnotations(api, annotatedRef.current);
      setAnnotatedObjects([]);

      const enabledProps = currentProps.filter((p) => p.enabled);
      if (enabledProps.length === 0 || currentObjProps.length === 0) {
        return;
      }

      console.log(`${LOG} Creating annotations: ${currentObjProps.length} objects, ${enabledProps.length} props`);

      const newAnnotated: AnnotatedObject[] = [];

      for (const sel of currentSelection) {
        const limitedIds = sel.objectRuntimeIds.slice(
          0,
          currentSettings.maxObjects - newAnnotated.length,
        );
        if (limitedIds.length === 0) break;

        const bboxes = await fetchObjectBoundingBoxes(api, sel.modelId, limitedIds);
        console.log(`${LOG} Bounding boxes:`, bboxes);

        for (const runtimeId of limitedIds) {
          const props = currentObjProps.find(
            (p) => p.id === runtimeId
              || (p as unknown as Record<string, unknown>).runtimeId === runtimeId,
          );
          const bbox = bboxes.find(
            (b) => b.runtimeId === runtimeId
              || (b as unknown as Record<string, unknown>).id === runtimeId,
          );

          console.log(`${LOG} Match runtimeId=${runtimeId}: props=${!!props}, bbox=${!!bbox}`);

          if (!props || !bbox) continue;

          const annotated = await createAnnotationsForObject(
            api, sel.modelId, runtimeId, props, enabledProps, bbox, currentSettings,
          );
          if (annotated) newAnnotated.push(annotated);
        }
      }

      setAnnotatedObjects(newAnnotated);
      console.log(`${LOG} Annotations created: ${newAnnotated.length}`);
    } finally {
      refreshingRef.current = false;
    }
  }, [api]);

  /** Debounce le refresh pour éviter les appels rapides */
  useEffect(() => {
    clearTimeout(refreshTimerRef.current);

    if (!enabledKey) {
      if (api && annotatedRef.current.length > 0) {
        removeAllAnnotations(api, annotatedRef.current).then(() => {
          setAnnotatedObjects([]);
        });
      }
      return;
    }

    refreshTimerRef.current = setTimeout(() => {
      doRefresh();
    }, REFRESH_DEBOUNCE);

    return () => clearTimeout(refreshTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, settingsKey, doRefresh]);

  const toggleProperty = useCallback((key: string) => {
    setProperties((prev) =>
      prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)),
    );
  }, []);

  const toggleAll = useCallback((enabled: boolean) => {
    setProperties((prev) => prev.map((p) => ({ ...p, enabled })));
  }, []);

  /** Propriétés triées : activées en haut, puis par mode de tri */
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

    return sorted.sort((a, b) => {
      // Activées toujours en premier
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return comparator(a, b);
    });
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

  const enabledCount = useMemo(
    () => properties.filter((p) => p.enabled).length,
    [properties],
  );

  return {
    allProperties: sortedProperties,
    groupedProperties,
    objectsProps,
    annotatedObjects,
    isLoading,
    maxReached,
    enabledCount,
    sortMode,
    setSortMode,
    toggleProperty,
    toggleAll,
  };
}
