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

// ── Region → API URLs ──

const REGION_PSET_URLS: Record<string, string> = {
  europe: "https://pset-api.eu-west-1.connect.trimble.com/v1",
  northAmerica: "https://pset-api.us-east-1.connect.trimble.com/v1",
  asia: "https://pset-api.ap-southeast-1.connect.trimble.com/v1",
  australia: "https://pset-api.ap-southeast-2.connect.trimble.com/v1",
};

const REGION_TC_API_URLS: Record<string, string> = {
  europe: "https://app21.connect.trimble.com/tc/api/2.0",
  northAmerica: "https://app.connect.trimble.com/tc/api/2.0",
  asia: "https://app31.connect.trimble.com/tc/api/2.0",
  australia: "https://app32.connect.trimble.com/tc/api/2.0",
};

let cachedProjectUuid: string | null = null;

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

// ── REST API: Resolve project UUID from TC API v2 ──

async function resolveProjectUuid(
  project: ConnectProject,
  token: string,
): Promise<string | null> {
  if (cachedProjectUuid) return cachedProjectUuid;

  const tcBaseUrl = REGION_TC_API_URLS[project.location] ?? REGION_TC_API_URLS.europe!;
  const url = `${tcBaseUrl}/projects/${project.id}`;
  console.log(`${LOG} [UUID] Fetching project details: ${url}`);

  try {
    const resp = await proxyFetch(url, token);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`${LOG} [UUID] Project resolve HTTP ${resp.status}: ${body.slice(0, 300)}`);
      return null;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    console.log(`${LOG} [UUID] Full project response keys:`, Object.keys(data));
    console.log(`${LOG} [UUID] id=${data.id}, rootId=${data.rootId}, projectId=${data.projectId}`);

    // Try different UUID fields — TC API might return UUID in various fields
    const candidates = [data.rootId, data.projectId, data.uuid, data.id];
    let uuid: string | null = null;
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 20) {
        uuid = c;
        break;
      }
    }

    // If no long UUID found, fallback to id
    if (!uuid) uuid = data.id as string;

    console.log(`${LOG} [UUID] Resolved: ${uuid}`);
    cachedProjectUuid = uuid;
    return uuid;
  } catch (err) {
    console.error(`${LOG} [UUID] resolveProjectUuid failed:`, err);
    return null;
  }
}

// ── REST API: Service PSet (custom properties) ──

export async function fetchServicePsets(
  project: ConnectProject,
  token: string,
  objectGuids: string[],
): Promise<PropertySet[]> {
  const psetBaseUrl = REGION_PSET_URLS[project.location] ?? REGION_PSET_URLS.europe!;

  if (objectGuids.length === 0) return [];

  // Resolve the project UUID
  const projectId = await resolveProjectUuid(project, token);
  if (!projectId) {
    console.warn(`${LOG} Cannot resolve project UUID, skipping service psets`);
    return [];
  }

  console.log(`${LOG} [PSet] Using projectId=${projectId}, GUIDs=[${objectGuids.join(", ")}]`);

  // Try multiple endpoint patterns since API structure is uncertain
  const endpointsToTry = [
    `${psetBaseUrl}/projects/${projectId}/defs`,
    `${psetBaseUrl}/projects/${projectId}/libs`,
    `${psetBaseUrl}/projects/${project.id}/defs`,
    `${psetBaseUrl}/projects/${project.id}/libs`,
  ];

  let defs: Array<{ id: string; name?: string; [key: string]: unknown }> = [];
  let workingBaseProjectUrl = "";

  for (const url of endpointsToTry) {
    console.log(`${LOG} [PSet] Trying: ${url}`);
    try {
      const resp = await proxyFetch(url, token);
      const body = await resp.text();
      console.log(`${LOG} [PSet] ${url} → HTTP ${resp.status}: ${body.slice(0, 300)}`);

      if (resp.ok) {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed) && parsed.length > 0) {
          defs = parsed;
          // Extract the working project URL pattern
          const urlParts = url.split("/");
          urlParts.pop(); // remove 'defs' or 'libs'
          workingBaseProjectUrl = urlParts.join("/");
          console.log(`${LOG} [PSet] SUCCESS! Found ${defs.length} entries at ${url}`);
          break;
        }
        // If array is empty, it might be valid but no defs — try next
        if (Array.isArray(parsed) && parsed.length === 0) {
          console.log(`${LOG} [PSet] Empty array at ${url}, trying next...`);
          // Still mark as working if endpoint is valid
          const urlParts = url.split("/");
          urlParts.pop();
          workingBaseProjectUrl = urlParts.join("/");
        }
      }
    } catch (err) {
      console.warn(`${LOG} [PSet] Error at ${url}:`, err);
    }
  }

  if (defs.length === 0) {
    console.warn(`${LOG} [PSet] No definitions found at any endpoint`);
    return [];
  }

  // Step 2: For each definition, find instances linked to our objects
  const result: PropertySet[] = [];
  const guidSet = new Set(objectGuids.map((g) => g.toLowerCase()));

  for (const def of defs) {
    try {
      const instUrl = `${workingBaseProjectUrl}/defs/${def.id}/instances`;
      const instResp = await proxyFetch(instUrl, token);

      if (!instResp.ok) {
        console.warn(`${LOG} [PSet] Instances for "${def.name}" HTTP ${instResp.status}`);
        continue;
      }

      const instances = (await instResp.json()) as Array<{
        id: string;
        props?: Record<string, unknown>;
        links?: string[];
        [key: string]: unknown;
      }>;

      console.log(`${LOG} [PSet] "${def.name}": ${instances.length} instances`);
      if (instances.length > 0) {
        console.log(`${LOG} [PSet] Sample instance keys:`, Object.keys(instances[0]!));
        console.log(`${LOG} [PSet] Sample links:`, instances[0]!.links?.slice(0, 3));
      }

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
      console.warn(`${LOG} [PSet] Error for "${def.name}":`, err);
    }
  }

  console.log(`${LOG} [PSet] Final result: ${result.length} property sets matched for ${guidSet.size} objects`);
  return result;
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
