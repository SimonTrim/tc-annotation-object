import type {
  TrimbleAPI,
  ObjectProperties,
  ObjectBoundingBox,
} from "@/types";

const LOG = "[AnnotationObj]";
const BATCH_SIZE = 50;

// ── Données fictives (mode dev) ──

const MOCK_PROPS: ObjectProperties[] = [
  {
    id: 1,
    class: "IfcWall",
    product: { name: "Mur porteur 200mm", objectType: "STANDARD" },
    properties: [
      {
        set: "Pset_WallCommon",
        properties: [
          { name: "IsExternal", value: "true", type: "boolean" },
          { name: "LoadBearing", value: "true", type: "boolean" },
          { name: "FireRating", value: "REI 120", type: "string" },
        ],
      },
      {
        set: "BaseQuantities",
        properties: [
          { name: "Width", value: "200 mm", type: "number" },
          { name: "Height", value: "3000 mm", type: "number" },
        ],
      },
    ],
  },
];

const MOCK_BBOXES: ObjectBoundingBox[] = [
  { runtimeId: 1, min: { x: 0, y: 0, z: 0 }, max: { x: 5.4, y: 0.2, z: 3 } },
];

// ── Normaliser les propriétés (format API variable) ──

function normalizeObjectProperties(raw: unknown[]): ObjectProperties[] {
  return raw.map((item) => {
    const obj = item as Record<string, unknown>;
    // L'API peut retourner "id", "runtimeId", ou les deux
    const id = (obj.id ?? obj.runtimeId ?? 0) as number;
    return {
      ...obj,
      id,
    } as ObjectProperties;
  });
}

function normalizeBoundingBoxes(raw: unknown[]): ObjectBoundingBox[] {
  return raw.map((item) => {
    const obj = item as Record<string, unknown>;
    const runtimeId = (obj.runtimeId ?? obj.id ?? 0) as number;
    return {
      ...obj,
      runtimeId,
    } as ObjectBoundingBox;
  });
}

// ── API Viewer Bridge ──

export async function fetchObjectProperties(
  api: TrimbleAPI | null,
  modelId: string,
  runtimeIds: number[],
): Promise<ObjectProperties[]> {
  if (!api) {
    return MOCK_PROPS.filter((p) => runtimeIds.includes(p.id));
  }

  const results: ObjectProperties[] = [];
  for (let i = 0; i < runtimeIds.length; i += BATCH_SIZE) {
    const batch = runtimeIds.slice(i, i + BATCH_SIZE);
    try {
      const props = await api.viewer.getObjectProperties(modelId, batch);
      console.log(`${LOG} Raw props response:`, JSON.stringify(props).slice(0, 500));
      results.push(...normalizeObjectProperties(props as unknown[]));
    } catch (err) {
      console.error(`${LOG} getObjectProperties batch failed:`, err);
    }
  }
  return results;
}

export async function fetchObjectBoundingBoxes(
  api: TrimbleAPI | null,
  modelId: string,
  runtimeIds: number[],
): Promise<ObjectBoundingBox[]> {
  if (!api) {
    return MOCK_BBOXES.filter((b) => runtimeIds.includes(b.runtimeId));
  }

  try {
    const bboxes = await api.viewer.getObjectBoundingBoxes(modelId, runtimeIds);
    console.log(`${LOG} Raw bboxes response:`, JSON.stringify(bboxes).slice(0, 500));
    return normalizeBoundingBoxes(bboxes as unknown[]);
  } catch (err) {
    console.error(`${LOG} getObjectBoundingBoxes failed:`, err);
    return [];
  }
}
