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

// Region name → PSet API region code (for FRN links)
const REGION_CODES: Record<string, string> = {
  europe: "eu-west-1",
  northAmerica: "us-east-1",
  asia: "ap-southeast-1",
  australia: "ap-southeast-2",
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

  // Use rootId from the workspace API if available (often already a UUID)
  if (project.rootId && project.rootId.length > 20) {
    console.log(`${LOG} [UUID] Using project.rootId: ${project.rootId}`);
    cachedProjectUuid = project.rootId;
    return project.rootId;
  }

  const tcBaseUrl = REGION_TC_API_URLS[project.location] ?? REGION_TC_API_URLS.europe!;
  const url = `${tcBaseUrl}/projects/${project.id}`;
  console.log(`${LOG} [UUID] Fetching project details: ${url}`);

  try {
    const resp = await proxyFetch(url, token);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`${LOG} [UUID] HTTP ${resp.status}: ${body.slice(0, 300)}`);
      return project.id;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    console.log(`${LOG} [UUID] Response keys:`, Object.keys(data));
    console.log(`${LOG} [UUID] id=${data.id}, rootId=${data.rootId}, projectId=${data.projectId}`);

    const candidates = [data.rootId, data.projectId, data.uuid, data.id];
    let uuid: string | null = null;
    for (const c of candidates) {
      if (typeof c === "string" && c.length > 20) {
        uuid = c;
        break;
      }
    }

    if (!uuid) uuid = data.id as string;

    console.log(`${LOG} [UUID] Resolved: ${uuid}`);
    cachedProjectUuid = uuid;
    return uuid;
  } catch (err) {
    console.error(`${LOG} [UUID] resolveProjectUuid failed:`, err);
    return project.id;
  }
}

// ── REST API: Service PSet (custom properties) ──
// Uses the official PSet API: /v1/libs/{libId}/defs, /v1/psets/{link}

export async function fetchServicePsets(
  project: ConnectProject,
  token: string,
  objectGuids: string[],
): Promise<PropertySet[]> {
  const psetBaseUrl = REGION_PSET_URLS[project.location] ?? REGION_PSET_URLS.europe!;
  const regionCode = REGION_CODES[project.location] ?? "eu-west-1";

  if (objectGuids.length === 0) return [];

  console.log(`${LOG} [PSet] Starting — GUIDs=[${objectGuids.join(", ")}], region=${regionCode}`);

  // ── Approach 1: Query PSets directly by link (FRN) for each object GUID ──
  const result: PropertySet[] = [];

  for (const guid of objectGuids) {
    const linksToTry = [
      guid,
      `tcps:${regionCode}:${project.id}:objects:${guid}`,
      `tcps:${regionCode}:${project.id}/objects/${guid}`,
    ];

    for (const link of linksToTry) {
      try {
        const url = `${psetBaseUrl}/psets/${encodeURIComponent(link)}`;
        console.log(`${LOG} [PSet] GET psets/${link.slice(0, 60)}`);
        const resp = await proxyFetch(url, token);
        const body = await resp.text();
        console.log(`${LOG} [PSet] psets/ → HTTP ${resp.status}: ${body.slice(0, 300)}`);

        if (resp.ok) {
          const data = JSON.parse(body) as {
            items?: Array<{
              link: string;
              libId: string;
              defId: string;
              props?: Record<string, unknown>;
              [key: string]: unknown;
            }>;
          };

          const items = data.items ?? (Array.isArray(data) ? data : []);
          if (items.length > 0) {
            console.log(`${LOG} [PSet] ✓ Found ${items.length} PSet(s) via link: ${link.slice(0, 60)}`);
            for (const inst of items) {
              if (inst.props) {
                const defName = await fetchDefName(psetBaseUrl, token, inst.libId, inst.defId);
                const properties = Object.entries(inst.props)
                  .filter(([, v]) => v != null && v !== "")
                  .map(([name, value]) => ({
                    name,
                    value: value as string | number,
                    type: typeof value,
                  }));
                if (properties.length > 0) {
                  result.push({ set: defName, properties });
                }
              }
            }
            break;
          }
        }
      } catch (err) {
        console.warn(`${LOG} [PSet] psets/ error:`, err);
      }
    }
  }

  if (result.length > 0) {
    console.log(`${LOG} [PSet] ✓ Result via psets/ link: ${result.length} property sets`);
    return result;
  }

  // ── Approach 2: List library definitions then query instances ──
  const projectUuid = await resolveProjectUuid(project, token);
  const libIdsToTry = [...new Set([projectUuid, project.rootId, project.id].filter(Boolean))] as string[];

  console.log(`${LOG} [PSet] psets/ approach returned 0, trying libs/ with IDs: [${libIdsToTry.join(", ")}]`);

  for (const libId of libIdsToTry) {
    try {
      const defsUrl = `${psetBaseUrl}/libs/${encodeURIComponent(libId)}/defs`;
      console.log(`${LOG} [PSet] GET libs/${libId}/defs`);
      const defsResp = await proxyFetch(defsUrl, token);
      const defsBody = await defsResp.text();
      console.log(`${LOG} [PSet] libs/${libId}/defs → HTTP ${defsResp.status}: ${defsBody.slice(0, 300)}`);

      if (!defsResp.ok) continue;

      const defsData = JSON.parse(defsBody) as {
        items?: Array<{ id: string; name?: string; libId?: string }>;
      };
      const defs = defsData.items ?? (Array.isArray(defsData) ? defsData : []);

      if (defs.length === 0) {
        console.log(`${LOG} [PSet] libs/${libId} has 0 definitions, trying next...`);
        continue;
      }

      console.log(`${LOG} [PSet] ✓ Found ${defs.length} definition(s) in library ${libId}`);
      const guidSet = new Set(objectGuids.map((g) => g.toLowerCase()));

      for (const def of defs) {
        try {
          const psetsUrl = `${psetBaseUrl}/libs/${encodeURIComponent(libId)}/defs/${encodeURIComponent(def.id)}/psets`;
          const psetsResp = await proxyFetch(psetsUrl, token);

          if (!psetsResp.ok) {
            console.warn(`${LOG} [PSet] psets for "${def.name}" → HTTP ${psetsResp.status}`);
            continue;
          }

          const psetsData = (await psetsResp.json()) as {
            items?: Array<{
              link: string;
              props?: Record<string, unknown>;
              [key: string]: unknown;
            }>;
          };
          const instances = psetsData.items ?? (Array.isArray(psetsData) ? psetsData : []);

          console.log(`${LOG} [PSet] "${def.name}": ${instances.length} instance(s)`);
          if (instances.length > 0) {
            console.log(`${LOG} [PSet] Sample link: ${instances[0]!.link}`);
          }

          for (const inst of instances) {
            const link = (inst.link ?? "").toLowerCase();
            const isLinked = [...guidSet].some((g) => link.includes(g));

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
                  set: def.name ?? `PSet (${def.id.slice(0, 8)})`,
                  properties,
                });
              }
            }
          }
        } catch (err) {
          console.warn(`${LOG} [PSet] Error for def "${def.name}":`, err);
        }
      }

      if (result.length > 0) break;
    } catch (err) {
      console.warn(`${LOG} [PSet] libs/${libId} error:`, err);
    }
  }

  // ── Approach 3: Try getLibrary to check if the ID is valid ──
  if (result.length === 0) {
    console.log(`${LOG} [PSet] libs/defs approach returned 0, trying GET libs/{id} diagnostic`);
    for (const libId of libIdsToTry) {
      try {
        const url = `${psetBaseUrl}/libs/${encodeURIComponent(libId)}`;
        console.log(`${LOG} [PSet] GET libs/${libId}`);
        const resp = await proxyFetch(url, token);
        const body = await resp.text();
        console.log(`${LOG} [PSet] libs/${libId} → HTTP ${resp.status}: ${body.slice(0, 300)}`);
      } catch (err) {
        console.warn(`${LOG} [PSet] libs/${libId} diagnostic error:`, err);
      }
    }
  }

  console.log(`${LOG} [PSet] Final result: ${result.length} property set(s)`);
  return result;
}

async function fetchDefName(
  psetBaseUrl: string,
  token: string,
  libId: string,
  defId: string,
): Promise<string> {
  try {
    const url = `${psetBaseUrl}/libs/${encodeURIComponent(libId)}/defs/${encodeURIComponent(defId)}`;
    const resp = await proxyFetch(url, token);
    if (resp.ok) {
      const data = (await resp.json()) as { name?: string };
      return data.name ?? `PSet (${defId.slice(0, 8)})`;
    }
  } catch { /* ignore */ }
  return `PSet (${defId.slice(0, 8)})`;
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
