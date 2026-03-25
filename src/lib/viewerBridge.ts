import type {
  TrimbleAPI,
  ObjectProperties,
  ObjectBoundingBox,
} from "@/types";

const LOG = "[AnnotationObj]";
const BATCH_SIZE = 50;

// ── Safe JSON (BigInt → Number) ──

function safeStringify(value: unknown, maxLen = 500): string {
  try {
    const str = JSON.stringify(value, (_key, val) =>
      typeof val === "bigint" ? Number(val) : val,
    );
    return str.length > maxLen ? str.slice(0, maxLen) + "…" : str;
  } catch {
    return "[unserializable]";
  }
}

function convertBigInts(obj: unknown): unknown {
  if (typeof obj === "bigint") return Number(obj);
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = convertBigInts(v);
    }
    return result;
  }
  return obj;
}

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

// ── Normaliser les propriétés (format API variable + BigInt) ──

function normalizeObjectProperties(raw: unknown[]): ObjectProperties[] {
  return raw.map((item) => {
    const obj = convertBigInts(item) as Record<string, unknown>;
    const id = (obj.id ?? obj.runtimeId ?? 0) as number;

    // Normaliser les PropertySets: l'API TC utilise "name" au lieu de "set"
    const rawPsets = obj.properties as unknown[] | undefined;
    if (rawPsets && Array.isArray(rawPsets)) {
      obj.properties = rawPsets.map((ps) => {
        const psObj = ps as Record<string, unknown>;
        if (!psObj.set && psObj.name && typeof psObj.name === "string") {
          psObj.set = psObj.name;
        }
        return psObj;
      });
    }

    return { ...obj, id } as ObjectProperties;
  });
}

function normalizeBoundingBoxes(raw: unknown[]): ObjectBoundingBox[] {
  return raw.map((item) => {
    const obj = convertBigInts(item) as Record<string, unknown>;
    const runtimeId = (obj.runtimeId ?? obj.id ?? 0) as number;

    // L'API TC imbrique min/max dans "boundingBox"
    const bbox = (obj.boundingBox ?? obj) as Record<string, unknown>;
    const min = bbox.min as ObjectBoundingBox["min"];
    const max = bbox.max as ObjectBoundingBox["max"];

    return { runtimeId, min, max };
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
      const normalized = normalizeObjectProperties(props as unknown[]);

      const psetNames = normalized.flatMap((p) => (p.properties ?? []).map((ps) => ps.set ?? "?"));
      console.log(`${LOG} Loaded ${normalized.length} objects, PSets: [${[...new Set(psetNames)].join(", ")}]`);

      results.push(...normalized);
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
    console.log(`${LOG} Raw bboxes response:`, safeStringify(bboxes));
    return normalizeBoundingBoxes(bboxes as unknown[]);
  } catch (err) {
    console.error(`${LOG} getObjectBoundingBoxes failed:`, err);
    return [];
  }
}
