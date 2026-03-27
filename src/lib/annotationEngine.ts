import type {
  TrimbleAPI,
  ObjectProperties,
  ObjectBoundingBox,
  PropertyToggleState,
  AnnotationSettings,
  AnnotatedObject,
  TextMarkup,
  ColorRGBA,
} from "@/types";
import {
  REF_GROUP,
  IDENTITY_GROUP,
  TOP_LEVEL_LABELS,
  PRODUCT_LABELS,
  findFieldByLabel,
} from "@/lib/propertyMapping";

const LOG = "[AnnotationEngine]";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function hexToRgba(hex: string, alpha = 255): ColorRGBA {
  const cleaned = hex.replace("#", "");
  return {
    r: parseInt(cleaned.substring(0, 2), 16),
    g: parseInt(cleaned.substring(2, 4), 16),
    b: parseInt(cleaned.substring(4, 6), 16),
    a: alpha,
  };
}

function resolveValue(
  obj: ObjectProperties,
  toggle: PropertyToggleState,
): string | null {
  const raw = obj as unknown as Record<string, unknown>;

  // "Référence Objet" → top-level object fields
  if (toggle.propertySet === REF_GROUP) {
    const field = findFieldByLabel(TOP_LEVEL_LABELS, toggle.propertyName) ?? toggle.propertyName;
    const val = raw[field];
    if (val != null && val !== "") return String(val);
    return null;
  }

  // "Identité" → product sub-object fields
  if (toggle.propertySet === IDENTITY_GROUP) {
    const prodRaw = (obj.product ?? {}) as unknown as Record<string, unknown>;
    const field = findFieldByLabel(PRODUCT_LABELS, toggle.propertyName) ?? toggle.propertyName;
    const val = prodRaw[field];
    if (val != null && val !== "") return String(val);
    return null;
  }

  // PropertySets
  for (const pset of obj.properties ?? []) {
    const setName = pset.set ?? (pset as unknown as Record<string, unknown>).name as string ?? "Autres";
    if (setName !== toggle.propertySet) continue;
    const prop = pset.properties?.find((p) => p.name === toggle.propertyName);
    if (prop) return String(prop.value);
  }

  return null;
}

function buildAnnotationText(
  obj: ObjectProperties,
  enabledProps: PropertyToggleState[],
  settings: AnnotationSettings,
): string {
  const parts: string[] = [];

  for (const toggle of enabledProps) {
    const value = resolveValue(obj, toggle);
    if (value != null) {
      parts.push(settings.showUnits ? value : value.replace(/\s*(mm|m|kg|m²|m³)$/i, "").trim());
    } else {
      console.warn(`${LOG} Property not found: ${toggle.key} in object id=${obj.id}`);
    }
  }

  if (parts.length === 0) return "";

  return settings.horizontal ? parts.join(settings.separator) : parts.join("\n");
}

const SETTLE_DELAY = 400;

export async function createAnnotationsForObject(
  api: TrimbleAPI,
  modelId: string,
  runtimeId: number,
  props: ObjectProperties,
  enabledProps: PropertyToggleState[],
  bbox: ObjectBoundingBox,
  settings: AnnotationSettings,
): Promise<AnnotatedObject | null> {
  const text = buildAnnotationText(props, enabledProps, settings);
  if (!text) {
    console.warn(`${LOG} Empty text for runtimeId=${runtimeId}, skipping`);
    return null;
  }

  const centerX = ((bbox.min.x + bbox.max.x) / 2) * 1000;
  const centerY = ((bbox.min.y + bbox.max.y) / 2) * 1000;
  const topZ = bbox.max.z * 1000;

  const lineCount = text.split("\n").length;
  const lineHeight = 300;
  const endOffsetZ = 800 + lineCount * lineHeight;

  console.log(`${LOG} Placing markup at [${centerX.toFixed(0)}, ${centerY.toFixed(0)}, ${topZ.toFixed(0)}] lines=${lineCount}`);

  const color = hexToRgba(settings.color);

  const markups: TextMarkup[] = [
    {
      text,
      start: {
        positionX: centerX,
        positionY: centerY,
        positionZ: topZ,
        modelId,
        objectId: runtimeId,
      },
      end: {
        positionX: centerX + 800,
        positionY: centerY + 800,
        positionZ: topZ + endOffsetZ,
      },
      color,
    },
  ];

  try {
    const created = await api.markup.addTextMarkup(markups);
    const markupIds = created.map((m) => m.id).filter((id): id is number => id != null);
    console.log(`${LOG} TextMarkup created: ids=[${markupIds}]`);

    return { modelId, runtimeId, markupIds, iconId: -1, properties: props };
  } catch (err) {
    console.error(`${LOG} Error creating annotation for runtimeId=${runtimeId}:`, err);
    return null;
  }
}

/**
 * Supprime une liste de markup IDs du viewer.
 * Attend que le viewer ait fini de processer (atlas settle).
 */
export async function removeMarkupIds(
  api: TrimbleAPI,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;

  console.log(`${LOG} Removing markup ids: [${ids}]`);
  try {
    await api.markup.removeMarkups(ids);
  } catch (err) {
    console.error(`${LOG} Error removing markups:`, err);
  }

  await sleep(SETTLE_DELAY);
}

/** @deprecated Use removeMarkupIds instead */
export async function removeAllAnnotations(
  api: TrimbleAPI,
  annotated: AnnotatedObject[],
): Promise<void> {
  const allIds = annotated.flatMap((a) => a.markupIds);
  await removeMarkupIds(api, allIds);
}
