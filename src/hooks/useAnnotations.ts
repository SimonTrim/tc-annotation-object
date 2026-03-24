import { useState, useCallback, useRef, useEffect } from "react";
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

export function useAnnotations(
  api: TrimbleAPI | null,
  selection: ViewerSelection[],
) {
  const [allProperties, setAllProperties] = useState<PropertyToggleState[]>([]);
  const [objectsProps, setObjectsProps] = useState<ObjectProperties[]>([]);
  const [annotatedObjects, setAnnotatedObjects] = useState<AnnotatedObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("pset");

  const annotatedRef = useRef<AnnotatedObject[]>([]);
  annotatedRef.current = annotatedObjects;

  /** Extraire toutes les propriétés uniques des objets */
  const extractProperties = useCallback(
    (propsArray: ObjectProperties[], existing: PropertyToggleState[]) => {
      const seen = new Set(existing.map((p) => p.key));
      const result = [...existing];

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
      setMaxReached(false);
      return;
    }

    let cancelled = false;

    async function load(maxObjects: number) {
      setIsLoading(true);
      setMaxReached(totalCount > maxObjects);

      try {
        const allProps: ObjectProperties[] = [];
        for (const sel of selection) {
          const ids = sel.objectRuntimeIds.slice(0, maxObjects - allProps.length);
          if (ids.length === 0) break;

          console.log(`${LOG} Fetching props for model=${sel.modelId}, ids=[${ids.join(",")}]`);
          const batch = await fetchObjectProperties(api, sel.modelId, ids);
          console.log(`${LOG} Got ${batch.length} results`, batch);
          allProps.push(...batch);
        }

        if (!cancelled) {
          setObjectsProps(allProps);
          setAllProperties((prev) => extractProperties(allProps, prev));
          console.log(`${LOG} Properties loaded: ${allProps.length} objects`);
        }
      } catch (err) {
        console.error(`${LOG} Error loading properties:`, err);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load(20);

    return () => { cancelled = true; };
  }, [api, selection, extractProperties]);

  /** Mettre à jour les annotations 3D dans le viewer */
  const refreshAnnotations = useCallback(
    async (settings: AnnotationSettings) => {
      if (!api) return;

      await removeAllAnnotations(api, annotatedRef.current);

      const enabledProps = allProperties.filter((p) => p.enabled);
      if (enabledProps.length === 0 || objectsProps.length === 0) {
        setAnnotatedObjects([]);
        return;
      }

      console.log(`${LOG} Creating annotations for ${objectsProps.length} objects, ${enabledProps.length} props enabled`);

      const newAnnotated: AnnotatedObject[] = [];

      for (const sel of selection) {
        const limitedIds = sel.objectRuntimeIds.slice(
          0,
          settings.maxObjects - newAnnotated.length,
        );
        if (limitedIds.length === 0) break;

        const bboxes = await fetchObjectBoundingBoxes(api, sel.modelId, limitedIds);

        for (const runtimeId of limitedIds) {
          const props = objectsProps.find((p) => p.id === runtimeId);
          const bbox = bboxes.find((b) => b.runtimeId === runtimeId);
          if (!props || !bbox) continue;

          const annotated = await createAnnotationsForObject(
            api, sel.modelId, runtimeId, props, enabledProps, bbox, settings,
          );
          if (annotated) newAnnotated.push(annotated);
        }
      }

      setAnnotatedObjects(newAnnotated);
      console.log(`${LOG} Annotations created: ${newAnnotated.length}`);
    },
    [api, allProperties, objectsProps, selection],
  );

  /** Basculer l'état d'une propriété */
  const toggleProperty = useCallback((key: string) => {
    setAllProperties((prev) =>
      prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)),
    );
  }, []);

  /** Activer/désactiver toutes les propriétés */
  const toggleAll = useCallback((enabled: boolean) => {
    setAllProperties((prev) => prev.map((p) => ({ ...p, enabled })));
  }, []);

  /** Propriétés triées */
  const sortedProperties = (() => {
    const sorted = [...allProperties];
    switch (sortMode) {
      case "alpha-asc":
        return sorted.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
      case "alpha-desc":
        return sorted.sort((a, b) => b.propertyName.localeCompare(a.propertyName));
      case "pset":
      default:
        return sorted.sort((a, b) => a.propertySet.localeCompare(b.propertySet));
    }
  })();

  /** Grouper par PropertySet */
  const groupedProperties = sortedProperties.reduce<
    Record<string, PropertyToggleState[]>
  >((acc, prop) => {
    const group = prop.propertySet;
    if (!acc[group]) acc[group] = [];
    acc[group]!.push(prop);
    return acc;
  }, {});

  const enabledCount = allProperties.filter((p) => p.enabled).length;

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
    refreshAnnotations,
    toggleProperty,
    toggleAll,
  };
}
