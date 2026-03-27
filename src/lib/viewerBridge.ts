import type {
  TrimbleAPI,
  ObjectProperties,
  ObjectBoundingBox,
  PropertySet,
  ConnectProject,
  ModelSpec,
} from "@/types";

const LOG = "[ViewerBridge]";
const BATCH_SIZE = 50;

// ── Region → PSet API URL ──

const REGION_PSET_URLS: Record<string, string> = {
  europe: "https://pset-api.eu-west-1.connect.trimble.com/v1",
  northAmerica: "https://pset-api.us-east-1.connect.trimble.com/v1",
  asia: "https://pset-api.ap-southeast-1.connect.trimble.com/v1",
  australia: "https://pset-api.ap-southeast-2.connect.trimble.com/v1",
};

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

// ── Mock data (dev mode) ──

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
    ],
  },
];

const MOCK_BBOXES: ObjectBoundingBox[] = [
  { runtimeId: 1, min: { x: 0, y: 0, z: 0 }, max: { x: 5.4, y: 0.2, z: 3 } },
];

// ── Normalize API responses ──

function normalizeObjectProperties(raw: unknown[]): ObjectProperties[] {
  return raw.map((item) => {
    const obj = convertBigInts(item) as Record<string, unknown>;
    const id = (obj.id ?? obj.runtimeId ?? 0) as number;

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

    const bbox = (obj.boundingBox ?? obj) as Record<string, unknown>;
    const min = bbox.min as ObjectBoundingBox["min"];
    const max = bbox.max as ObjectBoundingBox["max"];

    return { runtimeId, min, max };
  });
}

// ── Core API: Object Properties ──

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
      console.log(`${LOG} raw properties:`, safeStringify(props));
      const normalized = normalizeObjectProperties(props as unknown[]);
      console.log(`${LOG} parsed results: ${normalized.length} objects`);
      results.push(...normalized);
    } catch (err) {
      console.error(`${LOG} getObjectProperties batch failed:`, err);
    }
  }
  return results;
}

// ── Core API: Bounding Boxes ──

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

// ── Workspace API: Convert runtime IDs to persistent GUIDs ──

export async function fetchObjectGuids(
  api: TrimbleAPI,
  modelId: string,
  runtimeIds: number[],
): Promise<Map<number, string>> {
  try {
    const guids = await api.viewer.convertToObjectIds(modelId, runtimeIds);
    const map = new Map<number, string>();
    runtimeIds.forEach((rid, i) => {
      if (guids[i]) map.set(rid, guids[i]!);
    });
    console.log(`${LOG} Converted ${map.size} runtime IDs to GUIDs`);
    return map;
  } catch (err) {
    console.error(`${LOG} convertToObjectIds failed:`, err);
    return new Map();
  }
}

// ── Workspace API: Get model list ──

export async function fetchModelInfo(
  api: TrimbleAPI,
): Promise<ModelSpec[]> {
  try {
    const models = await api.viewer.getModels();
    console.log(`${LOG} Models:`, models.map((m) => `${m.id}: ${m.name}`));
    return models;
  } catch (err) {
    console.error(`${LOG} getModels failed:`, err);
    return [];
  }
}

// ── Proxy fetch (via Vercel Edge proxy to avoid CORS) ──

async function proxyFetch(
  targetUrl: string,
  token: string,
): Promise<Response> {
  const proxyUrl = `/api/pset-proxy?url=${encodeURIComponent(targetUrl)}`;
  return fetch(proxyUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}

// ── REST API: Service PSet (custom properties) ──

export async function fetchServicePsets(
  project: ConnectProject,
  token: string,
  objectGuids: string[],
): Promise<PropertySet[]> {
  const baseUrl = REGION_PSET_URLS[project.location] ?? REGION_PSET_URLS.europe!;

  if (objectGuids.length === 0) return [];

  try {
    // Step 1: Get pset definitions for the project
    const defsUrl = `${baseUrl}/projects/${project.id}/defs`;
    console.log(`${LOG} Fetching PSet defs: ${defsUrl}`);
    const defsResp = await proxyFetch(defsUrl, token);

    if (!defsResp.ok) {
      const body = await defsResp.text().catch(() => "");
      console.warn(`${LOG} PSet defs HTTP ${defsResp.status}: ${body.slice(0, 200)}`);
      return [];
    }

    const defs = (await defsResp.json()) as Array<{
      id: string;
      name?: string;
      description?: string;
      [key: string]: unknown;
    }>;
    console.log(`${LOG} PSet defs: ${defs.length} definitions found`, defs.map((d) => d.name));

    if (defs.length === 0) return [];

    // Step 2: For each definition, find instances linked to our objects
    const result: PropertySet[] = [];
    const guidSet = new Set(objectGuids.map((g) => g.toLowerCase()));

    for (const def of defs) {
      try {
        const instUrl = `${baseUrl}/projects/${project.id}/defs/${def.id}/instances`;
        const instResp = await proxyFetch(instUrl, token);

        if (!instResp.ok) {
          console.warn(`${LOG} PSet instances for "${def.name}" HTTP ${instResp.status}`);
          continue;
        }

        const instances = (await instResp.json()) as Array<{
          id: string;
          props?: Record<string, unknown>;
          links?: string[];
          [key: string]: unknown;
        }>;

        console.log(`${LOG} PSet "${def.name}": ${instances.length} instances, checking links for ${guidSet.size} GUIDs`);

        for (const inst of instances) {
          const links = inst.links ?? [];
          const isLinked = links.some((link) => {
            const lower = link.toLowerCase();
            return [...guidSet].some((guid) => lower.includes(guid));
          });

          if (isLinked && inst.props) {
            const properties = Object.entries(inst.props)
              .filter(([, v]) => v != null && v !== "")
              .map(([name, value]) => ({
                name,
                value: value as string | number,
                type: typeof value,
              }));

            if (properties.length > 0) {
              result.push({
                set: def.name ?? `PSet personnalisé (${def.id.slice(0, 8)})`,
                properties,
              });
            }
          }
        }
      } catch (err) {
        console.warn(`${LOG} PSet instances fetch error for "${def.name}":`, err);
      }
    }

    console.log(`${LOG} Service PSet: ${result.length} property sets matched`);
    return result;
  } catch (err) {
    console.error(`${LOG} fetchServicePsets failed:`, err);
    return [];
  }
}

// ── Enrichment: add GUIDs, model info, and service psets to ObjectProperties ──

export async function enrichObjectProperties(
  api: TrimbleAPI,
  project: ConnectProject | null,
  token: string | null,
  modelId: string,
  objects: ObjectProperties[],
  runtimeIds: number[],
): Promise<ObjectProperties[]> {
  if (objects.length === 0) return objects;

  // 1. Fetch GUIDs
  const guidMap = await fetchObjectGuids(api, modelId, runtimeIds);

  // 2. Fetch model info
  const models = await fetchModelInfo(api);
  const modelInfo = models.find((m) => m.id === modelId);

  // 3. Enrich each object with GUID, model info, and file format
  const enriched = objects.map((obj) => {
    const raw = { ...obj } as Record<string, unknown>;
    const guid = guidMap.get(obj.id);
    if (guid) raw.guid = guid;
    if (modelInfo?.name) {
      raw.fileName = modelInfo.name;
      const ext = modelInfo.name.split(".").pop();
      if (ext) raw.fileFormat = ext.toUpperCase();
    }
    return raw as ObjectProperties;
  });

  // 4. Fetch service psets if project + token available
  if (project && token && guidMap.size > 0) {
    try {
      const guids = [...guidMap.values()];
      const servicePsets = await fetchServicePsets(project, token, guids);

      if (servicePsets.length > 0) {
        for (const obj of enriched) {
          obj.properties = [...(obj.properties ?? []), ...servicePsets];
        }
        console.log(`${LOG} Enriched with ${servicePsets.length} service pset groups`);
      }
    } catch (err) {
      console.error(`${LOG} Service PSet enrichment failed:`, err);
    }
  }

  return enriched;
}
