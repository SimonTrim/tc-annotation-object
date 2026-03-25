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
      console.log(`${LOG} Raw props response:`, safeStringify(props, 800));

      // Diagnostic: afficher la structure des PSets
      for (const p of props as unknown[]) {
        const obj = p as Record<string, unknown>;
        const psets = obj.properties as unknown[] | undefined;
        if (psets) {
          const summary = psets.map((ps) => {
            const psObj = ps as Record<string, unknown>;
            const innerProps = psObj.properties as unknown[] | undefined;
            return {
              set: psObj.set ?? psObj.name ?? "(null)",
              count: innerProps?.length ?? 0,
              names: (innerProps ?? []).slice(0, 5).map((pr) => (pr as Record<string, unknown>).name),
            };
          });
          console.log(`${LOG} PSet structure for id=${obj.id}:`, safeStringify(summary, 2000));
        } else {
          console.log(`${LOG} No properties array for id=${obj.id}, keys:`, Object.keys(obj));
        }
      }

      const normalized = normalizeObjectProperties(props as unknown[]);
      console.log(`${LOG} Normalized ${normalized.length} properties, ids=[${normalized.map((p) => p.id).join(",")}]`);
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
