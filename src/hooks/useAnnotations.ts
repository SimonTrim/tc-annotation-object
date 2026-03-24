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

  // Refs pour accéder aux valeurs courantes dans les callbacks async
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

  /** Extraire toutes les propriétés uniques des objets */
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
      // Nettoyer les annotations 3D
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

  /** Clé stable des propriétés activées (pour déclencher le refresh) */
  const enabledKey = useMemo(
    () => properties.filter((p) => p.enabled).map((p) => p.key).join("|"),
    [properties],
  );

  const settingsKey = `${settings.color}|${settings.separator}|${settings.horizontal}|${settings.showUnits}`;

  /** Fonction de refresh stable (dépend uniquement de api) */
  const doRefresh = useCallback(async () => {
    if (!api) return;

    const currentProps = propsRef.current;
    const currentObjProps = objectsPropsRef.current;
    const currentSelection = selectionRef.current;
    const currentSettings = settingsRef.current;

    // Supprimer les anciennes annotations
    await removeAllAnnotations(api, annotatedRef.current);

    const enabledProps = currentProps.filter((p) => p.enabled);
    if (enabledProps.length === 0 || currentObjProps.length === 0) {
      setAnnotatedObjects([]);
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
        // Chercher les propriétés — compatible id et runtimeId
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
  }, [api]);

  /** Déclencher le refresh quand les props activées ou settings changent */
  useEffect(() => {
    if (!enabledKey) {
      // Aucune prop activée — supprimer les annotations
      if (api && annotatedRef.current.length > 0) {
        removeAllAnnotations(api, annotatedRef.current).then(() => {
          setAnnotatedObjects([]);
        });
      }
      return;
    }

    doRefresh();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabledKey, settingsKey, doRefresh]);

  /** Basculer l'état d'une propriété */
  const toggleProperty = useCallback((key: string) => {
    setProperties((prev) =>
      prev.map((p) => (p.key === key ? { ...p, enabled: !p.enabled } : p)),
    );
  }, []);

  /** Activer/désactiver toutes les propriétés */
  const toggleAll = useCallback((enabled: boolean) => {
    setProperties((prev) => prev.map((p) => ({ ...p, enabled })));
  }, []);

  /** Propriétés triées (mémoïsées) */
  const sortedProperties = useMemo(() => {
    const sorted = [...properties];
    switch (sortMode) {
      case "alpha-asc":
        return sorted.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
      case "alpha-desc":
        return sorted.sort((a, b) => b.propertyName.localeCompare(a.propertyName));
      case "pset":
      default:
        return sorted.sort((a, b) => a.propertySet.localeCompare(b.propertySet));
    }
  }, [properties, sortMode]);

  /** Grouper par PropertySet (mémoïsé) */
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
