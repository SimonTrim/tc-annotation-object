import { useState, useCallback, useRef } from "react";
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

export function useAnnotations(api: TrimbleAPI | null) {
  const [allProperties, setAllProperties] = useState<PropertyToggleState[]>([]);
  const [objectsProps, setObjectsProps] = useState<ObjectProperties[]>([]);
  const [annotatedObjects, setAnnotatedObjects] = useState<AnnotatedObject[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [maxReached, setMaxReached] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("pset");

  const annotatedRef = useRef<AnnotatedObject[]>([]);
  annotatedRef.current = annotatedObjects;

  /** Extraire toutes les propriétés uniques des objets sélectionnés */
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

  /** Charger les propriétés pour une sélection donnée */
  const loadSelection = useCallback(
    async (selection: ViewerSelection[], maxObjects: number) => {
      const totalCount = selection.reduce(
        (sum, s) => sum + s.objectRuntimeIds.length,
        0,
      );

      setMaxReached(totalCount > maxObjects);

      if (totalCount === 0) {
        setObjectsProps([]);
        return;
      }

      setIsLoading(true);
      try {
        const allProps: ObjectProperties[] = [];
        for (const sel of selection) {
          const ids = sel.objectRuntimeIds.slice(0, maxObjects - allProps.length);
          if (ids.length === 0) break;

          const batch = await fetchObjectProperties(api, sel.modelId, ids);
          allProps.push(...batch);
        }

        setObjectsProps(allProps);
        setAllProperties((prev) => extractProperties(allProps, prev));
      } catch (err) {
        console.error("[Annotations] Erreur chargement propriétés:", err);
      } finally {
        setIsLoading(false);
      }
    },
    [api, extractProperties],
  );

  /** Mettre à jour les annotations 3D dans le viewer */
  const refreshAnnotations = useCallback(
    async (
      selection: ViewerSelection[],
      settings: AnnotationSettings,
    ) => {
      if (!api) return;

      // Supprimer les anciennes annotations
      await removeAllAnnotations(api, annotatedRef.current);

      const enabledProps = allProperties.filter((p) => p.enabled);
      if (enabledProps.length === 0 || objectsProps.length === 0) {
        setAnnotatedObjects([]);
        return;
      }

      const newAnnotated: AnnotatedObject[] = [];

      for (const sel of selection) {
        const limitedIds = sel.objectRuntimeIds.slice(
          0,
          settings.maxObjects - newAnnotated.length,
        );
        if (limitedIds.length === 0) break;

        const bboxes = await fetchObjectBoundingBoxes(
          api,
          sel.modelId,
          limitedIds,
        );

        for (const runtimeId of limitedIds) {
          const props = objectsProps.find((p) => p.id === runtimeId);
          const bbox = bboxes.find((b) => b.runtimeId === runtimeId);
          if (!props || !bbox) continue;

          const annotated = await createAnnotationsForObject(
            api,
            sel.modelId,
            runtimeId,
            props,
            enabledProps,
            bbox,
            settings,
          );
          if (annotated) newAnnotated.push(annotated);
        }
      }

      setAnnotatedObjects(newAnnotated);
    },
    [api, allProperties, objectsProps],
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
    loadSelection,
    refreshAnnotations,
    toggleProperty,
    toggleAll,
  };
}
