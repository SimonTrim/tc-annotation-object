import type {
  TrimbleAPI,
  ObjectProperties,
  ObjectBoundingBox,
} from "@/types";

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
          { name: "Length", value: "5400 mm", type: "number" },
        ],
      },
    ],
  },
  {
    id: 2,
    class: "IfcColumn",
    product: { name: "Poteau BA 30x30", objectType: "STANDARD" },
    properties: [
      {
        set: "Pset_ColumnCommon",
        properties: [
          { name: "LoadBearing", value: "true", type: "boolean" },
          { name: "FireRating", value: "R 60", type: "string" },
        ],
      },
      {
        set: "BaseQuantities",
        properties: [
          { name: "Width", value: "300 mm", type: "number" },
          { name: "Height", value: "3200 mm", type: "number" },
        ],
      },
    ],
  },
  {
    id: 3,
    class: "IfcBeam",
    product: { name: "Poutre IPE 300", objectType: "STANDARD" },
    properties: [
      {
        set: "Pset_BeamCommon",
        properties: [
          { name: "LoadBearing", value: "true", type: "boolean" },
          { name: "Span", value: "6000 mm", type: "number" },
        ],
      },
    ],
  },
];

const MOCK_BBOXES: ObjectBoundingBox[] = [
  { runtimeId: 1, min: { x: 0, y: 0, z: 0 }, max: { x: 5.4, y: 0.2, z: 3 } },
  { runtimeId: 2, min: { x: 6, y: 0, z: 0 }, max: { x: 6.3, y: 0.3, z: 3.2 } },
  { runtimeId: 3, min: { x: 0, y: 0, z: 3 }, max: { x: 6, y: 0.3, z: 3.3 } },
];

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
      results.push(...(props as ObjectProperties[]));
    } catch (err) {
      console.error("[ViewerBridge] getObjectProperties batch failed:", err);
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
    return bboxes as ObjectBoundingBox[];
  } catch (err) {
    console.error("[ViewerBridge] getObjectBoundingBoxes failed:", err);
    return [];
  }
}
