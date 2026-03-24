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

const LOG = "[AnnotationEngine]";

function hexToRgba(hex: string, alpha = 255): ColorRGBA {
  const cleaned = hex.replace("#", "");
  return {
    r: parseInt(cleaned.substring(0, 2), 16),
    g: parseInt(cleaned.substring(2, 4), 16),
    b: parseInt(cleaned.substring(4, 6), 16),
    a: alpha,
  };
}

function buildAnnotationText(
  obj: ObjectProperties,
  enabledProps: PropertyToggleState[],
  settings: AnnotationSettings,
): string {
  const parts: string[] = [];

  for (const toggle of enabledProps) {
    if (!toggle.enabled) continue;

    if (toggle.key === "Identité::Classe IFC" && obj.class) {
      parts.push(obj.class);
      continue;
    }
    if (toggle.key === "Identité::Nom" && obj.product?.name) {
      parts.push(obj.product.name);
      continue;
    }

    let found = false;
    for (const pset of obj.properties ?? []) {
      if (pset.set !== toggle.propertySet) continue;
      const prop = pset.properties?.find((p) => p.name === toggle.propertyName);
      if (prop) {
        const value = String(prop.value);
        parts.push(settings.showUnits ? value : value.replace(/\s*(mm|m|kg|m²|m³)$/i, "").trim());
        found = true;
        break;
      }
    }

    if (!found) {
      console.warn(`${LOG} Property not found: ${toggle.key} in object id=${obj.id}`);
    }
  }

  console.log(`${LOG} buildAnnotationText: ${parts.length} values → "${parts.join(" | ")}"`);
  if (parts.length === 0) return "";

  return settings.horizontal ? parts.join(settings.separator) : parts.join("\n");
}

const ICON_BASE_URL =
  "data:image/svg+xml;base64," +
  btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#0063a3"><circle cx="12" cy="12" r="10" fill="#0063a3" stroke="#fff" stroke-width="2"/><text x="12" y="16" text-anchor="middle" fill="#fff" font-size="12" font-family="sans-serif" font-weight="bold">i</text></svg>`);

let iconCounter = 10000;

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

  console.log(`${LOG} Placing markup at [${centerX}, ${centerY}, ${topZ}] text="${text.substring(0, 40)}"`);

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
        positionZ: topZ + 1200,
      },
      color,
    },
  ];

  try {
    console.log(`${LOG} addTextMarkup payload:`, JSON.stringify(markups).slice(0, 300));
    const created = await api.markup.addTextMarkup(markups);
    console.log(`${LOG} addTextMarkup response:`, JSON.stringify(created).slice(0, 300));
    const markupIds = created.map((m) => m.id).filter((id): id is number => id != null);

    const iconId = ++iconCounter;
    await api.viewer.addIcon({
      id: iconId,
      iconPath: ICON_BASE_URL,
      position: {
        x: (bbox.min.x + bbox.max.x) / 2,
        y: (bbox.min.y + bbox.max.y) / 2,
        z: bbox.max.z + 0.3,
      },
      size: 24,
    });

    console.log(`${LOG} Created annotation: markupIds=[${markupIds}], iconId=${iconId}`);
    return { modelId, runtimeId, markupIds, iconId, properties: props };
  } catch (err) {
    console.error(`${LOG} Error creating annotation for runtimeId=${runtimeId}:`, err);
    return null;
  }
}

export async function removeAllAnnotations(
  api: TrimbleAPI,
  annotated: AnnotatedObject[],
): Promise<void> {
  if (annotated.length === 0) return;

  console.log(`${LOG} Removing ${annotated.length} annotations`);

  try {
    const allMarkupIds = annotated.flatMap((a) => a.markupIds);
    if (allMarkupIds.length > 0) {
      await api.markup.removeMarkups(allMarkupIds);
    }

    for (const obj of annotated) {
      await api.viewer.removeIcon({
        id: obj.iconId,
        iconPath: "",
        position: { x: 0, y: 0, z: 0 },
        size: 0,
      });
    }
  } catch (err) {
    console.error(`${LOG} Error removing annotations:`, err);
  }
}
