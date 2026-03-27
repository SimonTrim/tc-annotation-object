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

let cachedTcApiRootId: string | null = null;
let cachedTcApiAllIds: string[] = [];

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

// ── REST API: Resolve project IDs from TC API v2 ──

async function resolveProjectIds(
  project: ConnectProject,
  token: string,
): Promise<void> {
  if (cachedTcApiAllIds.length > 0) return;

  const tcBaseUrl = REGION_TC_API_URLS[project.location] ?? REGION_TC_API_URLS.europe!;
  const url = `${tcBaseUrl}/projects/${project.id}`;
  console.log(`${LOG} [UUID] Fetching project details: ${url}`);

  try {
    const resp = await proxyFetch(url, token);
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`${LOG} [UUID] HTTP ${resp.status}: ${body.slice(0, 300)}`);
      return;
    }

    const data = (await resp.json()) as Record<string, unknown>;
    console.log(`${LOG} [UUID] Response keys:`, Object.keys(data));

    // Log ALL string values to discover identifiers
    const stringFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === "string" && v.length > 0 && v.length < 100) {
        stringFields[k] = v;
      }
    }
    console.log(`${LOG} [UUID] String fields:`, JSON.stringify(stringFields));

    // Collect all unique IDs from known fields
    const idCandidates = [
      data.rootId,
      data.id,
      data.projectId,
      data.uuid,
      data.parentId,
      data.accountId,
      project.rootId,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);

    cachedTcApiAllIds = [...new Set(idCandidates)];
    cachedTcApiRootId = (data.rootId as string) ?? null;
    console.log(`${LOG} [UUID] rootId=${cachedTcApiRootId}, allIds=[${cachedTcApiAllIds.join(", ")}]`);
  } catch (err) {
    console.error(`${LOG} [UUID] resolveProjectIds failed:`, err);
  }
}

// ── REST API: Service PSet (custom properties) ──
// Uses the official PSet API: /v1/libs/{libId}/defs, /v1/psets/{link}

export async function fetchServicePsets(
  project: ConnectProject,
  token: string,
  objectGuids: string[],
  modelId?: string,
  versionId?: string,
): Promise<PropertySet[]> {
  const psetBaseUrl = REGION_PSET_URLS[project.location] ?? REGION_PSET_URLS.europe!;
  const regionCode = REGION_CODES[project.location] ?? "eu-west-1";

  if (objectGuids.length === 0) return [];

  // Resolve all project IDs from TC API
  await resolveProjectIds(project, token);

  console.log(`${LOG} [PSet] Starting — GUIDs=[${objectGuids.join(", ")}], region=${regionCode}`);

  // ── Approach 1: Query PSets directly by link (many FRN formats) ──
  const result: PropertySet[] = [];

  // Build all candidate project IDs
  const projectIds = [...new Set([
    project.id,
    cachedTcApiRootId,
    ...cachedTcApiAllIds,
  ].filter(Boolean))] as string[];

  for (const guid of objectGuids) {
    // Try many possible FRN link formats
    const linksToTry = [
      guid,
      ...projectIds.flatMap((pid) => [
        `tcps:${regionCode}:${pid}:objects:${guid}`,
        `tcps:${regionCode}:${pid}/objects/${guid}`,
      ]),
    ];

    // Also try with model/version context
    if (modelId) {
      projectIds.forEach((pid) => {
        linksToTry.push(`tcps:${regionCode}:${pid}:files:${modelId}:objects:${guid}`);
        linksToTry.push(`tcps:${regionCode}:${pid}/files/${modelId}/objects/${guid}`);
      });
      if (versionId) {
        projectIds.forEach((pid) => {
          linksToTry.push(`tcps:${regionCode}:${pid}:versions:${versionId}:objects:${guid}`);
        });
      }
    }

    for (const link of linksToTry) {
      try {
        const url = `${psetBaseUrl}/psets/${encodeURIComponent(link)}`;
        console.log(`${LOG} [PSet] GET psets/${link}`);
        const resp = await proxyFetch(url, token);
        const body = await resp.text();
        console.log(`${LOG} [PSet] psets/ → HTTP ${resp.status}: ${body.slice(0, 200)}`);

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
            console.log(`${LOG} [PSet] ✓ Found ${items.length} PSet(s) via link: ${link}`);
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

    if (result.length > 0) break;
  }

  if (result.length > 0) {
    console.log(`${LOG} [PSet] ✓ Result via psets/ link: ${result.length} property sets`);
    return result;
  }

  // ── Approach 2: List library definitions using all candidate IDs ──
  const libIdsToTry = projectIds;

  console.log(`${LOG} [PSet] psets/ returned 0. Trying libs/ with IDs: [${libIdsToTry.join(", ")}]`);

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
        console.log(`${LOG} [PSet] libs/${libId} has 0 definitions`);
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
            items?: Array<{ link: string; props?: Record<string, unknown> }>;
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

  // ── Approach 3: Diagnostic — check if any ID is a valid library ──
  if (result.length === 0) {
    console.log(`${LOG} [PSet] All approaches returned 0. Diagnostic GET libs/{id}:`);
    for (const libId of libIdsToTry) {
      try {
        const url = `${psetBaseUrl}/libs/${encodeURIComponent(libId)}`;
        const resp = await proxyFetch(url, token);
        const body = await resp.text();
        console.log(`${LOG} [PSet] libs/${libId} → HTTP ${resp.status}: ${body.slice(0, 200)}`);
      } catch { /* ignore */ }
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
      const servicePsets = await fetchServicePsets(
        project, token, guids, modelId, modelInfo?.versionId,
      );

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
