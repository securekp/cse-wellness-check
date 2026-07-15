// Thin wrapper over the Cribl platform API. All calls go through the
// platform's fetch proxy (auth + scoping handled for us — see AGENTS.md).
//
// Group-scoped endpoints use the `/m/:groupId` prefix; system-wide endpoints
// (settings, version, certificates) are called directly.

import type {
  CriblInput,
  CriblOutput,
  DeploymentContext,
  AlertMonitor,
  LeaderHealth,
  LookupFile,
  MasterWorkerEntry,
  NodeVersion,
  Notification,
  Pipeline,
  ResourceMetrics,
  Route,
  SearchDataset,
  SearchDatatype,
  StatusEntry,
  SystemSettings,
  WorkerGroup,
  WorkerNode,
} from './types';

declare global {
  interface Window {
    CRIBL_API_URL?: string;
    CRIBL_BASE_PATH?: string;
  }
}

function apiUrl(): string {
  return window.CRIBL_API_URL || '/api/v1';
}

interface JsonResult {
  ok: boolean;
  status: number;
  data: unknown;
}

// Fetch + tolerant JSON/NDJSON parse. Never throws — callers decide how to
// handle a non-ok result (most checks degrade gracefully to "manual").
async function fetchJson(url: string, init?: RequestInit): Promise<JsonResult> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { ok: false, status: 0, data: null };
  }
  if (!res.ok) return { ok: false, status: res.status, data: null };

  const contentType = res.headers.get('content-type') ?? '';
  // Reject the Vite SPA fallback (HTML) served during local dev.
  if (contentType.includes('text/html')) return { ok: false, status: res.status, data: null };

  const text = await res.text();
  if (!text.trim()) return { ok: true, status: res.status, data: null };
  try {
    return { ok: true, status: res.status, data: JSON.parse(text) };
  } catch {
    const lines = text.split('\n').filter((l) => l.trim());
    try {
      return { ok: true, status: res.status, data: { items: lines.map((l) => JSON.parse(l)) } };
    } catch {
      return { ok: false, status: res.status, data: null };
    }
  }
}

function unwrapItems<T>(data: unknown): T[] {
  const d = data as { items?: T[] };
  if (Array.isArray(d?.items)) return d.items;
  if (Array.isArray(data)) return data as T[];
  return [];
}

function m(groupId: string, path: string): string {
  return `${apiUrl()}/m/${encodeURIComponent(groupId)}${path}`;
}

// --- Worker groups --------------------------------------------------------

export async function fetchWorkerGroups(): Promise<WorkerGroup[]> {
  const { ok, data } = await fetchJson(`${apiUrl()}/master/groups`);
  if (!ok || !data) throw new Error('Failed to fetch worker groups. Ensure the app has the /master/groups policy granted.');
  return unwrapItems<WorkerGroup>(data);
}

// A group is treated as Cribl-managed (Cloud) when it carries cloud provisioning
// metadata. On-prem-only checks are auto-marked N/A for Cloud groups.
export function isCloudGroup(g: WorkerGroup): boolean {
  const anyG = g as Record<string, unknown>;
  return Boolean(anyG.cloud || anyG.provisioned || anyG.isFleet === false && anyG.cloud);
}

// --- Per-group config -----------------------------------------------------

async function fetchInputs(groupId: string): Promise<CriblInput[]> {
  const { ok, data } = await fetchJson(m(groupId, '/system/inputs'));
  return ok ? unwrapItems<CriblInput>(data) : [];
}

async function fetchOutputs(groupId: string): Promise<CriblOutput[]> {
  const { ok, data } = await fetchJson(m(groupId, '/system/outputs'));
  return ok ? unwrapItems<CriblOutput>(data) : [];
}

async function fetchInputStatus(groupId: string): Promise<StatusEntry[]> {
  const { ok, data } = await fetchJson(m(groupId, '/system/status/inputs'));
  return ok ? unwrapItems<StatusEntry>(data) : [];
}

async function fetchOutputStatus(groupId: string): Promise<StatusEntry[]> {
  const { ok, data } = await fetchJson(m(groupId, '/system/status/outputs'));
  return ok ? unwrapItems<StatusEntry>(data) : [];
}

async function fetchRoutes(groupId: string): Promise<Route[]> {
  const { ok, data } = await fetchJson(m(groupId, '/routes'));
  if (!ok || !data) return [];
  // /routes returns a single RoutesConf object (or an items array containing it).
  const arr = unwrapItems<{ routes?: Route[] }>(data);
  if (arr.length && arr[0]?.routes) return arr[0].routes ?? [];
  const conf = data as { routes?: Route[] };
  return conf.routes ?? [];
}

async function fetchLookups(groupId: string): Promise<LookupFile[]> {
  const { ok, data } = await fetchJson(m(groupId, '/system/lookups'));
  return ok ? unwrapItems<LookupFile>(data) : [];
}

async function fetchNotifications(groupId: string): Promise<Notification[]> {
  // Notifications live at the group level in modern Stream; fall back to system.
  const grouped = await fetchJson(m(groupId, '/notifications'));
  if (grouped.ok && grouped.data) return unwrapItems<Notification>(grouped.data);
  const sys = await fetchJson(`${apiUrl()}/notifications`);
  return sys.ok ? unwrapItems<Notification>(sys.data) : [];
}

// Cribl Insights alert Monitors (org-level; not group-scoped). Returns null
// when the endpoint is unavailable (e.g. not present in this Cloud version),
// so the check can distinguish "no monitors" from "couldn't query monitors".
async function fetchAlertMonitors(): Promise<AlertMonitor[] | null> {
  const { ok, data } = await fetchJson(`${apiUrl()}/alert/monitors`);
  return ok ? unwrapItems<AlertMonitor>(data) : null;
}

async function fetchPacks(groupId: string): Promise<{ id: string }[]> {
  const { ok, data } = await fetchJson(m(groupId, '/packs'));
  return ok ? unwrapItems<{ id: string }>(data) : [];
}

// All pipelines in a group, including those bundled in packs (namespaced id).
async function fetchPipelines(groupId: string): Promise<Pipeline[]> {
  const pipelines: Pipeline[] = [];
  const { ok, data } = await fetchJson(m(groupId, '/pipelines'));
  if (ok && data) pipelines.push(...unwrapItems<Pipeline>(data).filter((p) => p.conf?.functions));

  for (const pack of await fetchPacks(groupId)) {
    const res = await fetchJson(m(groupId, `/p/${pack.id}/pipelines`));
    if (res.ok && res.data) {
      for (const p of unwrapItems<Pipeline>(res.data).filter((p) => p.conf?.functions)) {
        pipelines.push({ ...p, id: `${pack.id}:${p.id}`, _packId: pack.id });
      }
    }
  }
  return pipelines;
}

async function fetchSettings(groupId: string): Promise<SystemSettings | null> {
  const { ok, data } = await fetchJson(m(groupId, '/system/settings'));
  if (ok && data) return data as SystemSettings;
  const sys = await fetchJson(`${apiUrl()}/system/settings`);
  return sys.ok ? (sys.data as SystemSettings) : null;
}

// --- Cribl Search ---------------------------------------------------------

// Per the platform guide, all /search/* endpoints MUST be scoped to the
// `default_search` group. Search is org-wide (not per Stream worker group), so
// these are fetched once regardless of which group is under review.
async function fetchSearchDatasets(): Promise<SearchDataset[]> {
  const { ok, data } = await fetchJson(m('default_search', '/search/datasets'));
  return ok ? unwrapItems<SearchDataset>(data) : [];
}

async function fetchSearchDatatypes(): Promise<SearchDatatype[]> {
  const { ok, data } = await fetchJson(m('default_search', '/search/datatypes'));
  return ok ? unwrapItems<SearchDatatype>(data) : [];
}

// --- Versions -------------------------------------------------------------

// The Leader's running Cribl version, from /system/info (SystemInfo.version,
// falling back to BUILD.VERSION per the schema note).
async function fetchLeaderVersion(): Promise<string | null> {
  const { ok, data } = await fetchJson(`${apiUrl()}/system/info`);
  if (!ok || !data) return null;
  const item = unwrapItems<{ version?: string; BUILD?: { VERSION?: string } }>(data)[0]
    ?? (data as { version?: string; BUILD?: { VERSION?: string } });
  return item?.version ?? item?.BUILD?.VERSION ?? null;
}

// Raw /master/workers entries for the group under review. Fetched once and
// reused for both version and node-health checks.
async function fetchWorkerEntries(groupId: string): Promise<MasterWorkerEntry[]> {
  const { ok, data } = await fetchJson(`${apiUrl()}/master/workers`);
  if (!ok || !data) return [];
  return unwrapItems<MasterWorkerEntry>(data).filter((w) => w.group === groupId);
}

function toNodeVersions(entries: MasterWorkerEntry[]): NodeVersion[] {
  return entries.map((w) => ({
    id: w.id,
    hostname: w.info?.hostname,
    version: w.info?.cribl?.version ?? null,
  }));
}

// Interpret a node's textual health status. Returns null when unknown so
// callers can distinguish "reported unhealthy" from "not reported".
function nodeHealthy(status: string | undefined): boolean | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (['healthy', 'green', 'up', 'ok'].includes(s)) return true;
  if (['unhealthy', 'red', 'yellow', 'degraded', 'down', 'error'].includes(s)) return false;
  return null;
}

// A node is "connected" unless it explicitly reports disconnected. Some
// deployments also carry a textual status; treat an explicit disconnect flag
// as authoritative.
function toWorkerNodes(entries: MasterWorkerEntry[]): WorkerNode[] {
  return entries.map((w) => {
    // startTime is reported in ms on info; lastMsgTime on the entry is in seconds.
    const startMs = w.info?.startTime ?? w.info?.cribl?.startTime ?? null;
    const lastMsgMs = typeof w.lastMsgTime === 'number' ? w.lastMsgTime * 1000 : null;
    return {
      id: w.id,
      hostname: w.info?.hostname,
      version: w.info?.cribl?.version ?? null,
      connected: w.disconnected !== true,
      healthy: nodeHealthy(w.status),
      freeDiskBytes: typeof w.info?.freeDiskSpace === 'number' ? w.info.freeDiskSpace : null,
      cpus: typeof w.info?.cpus === 'number' ? w.info.cpus : null,
      lastMsgMs,
      startTimeMs: typeof startMs === 'number' ? startMs : null,
    };
  });
}

// Leader / workspace reachability, from /health. A non-200 or unreachable
// endpoint is itself the finding (the workspace UI/API may be down).
async function fetchLeaderHealth(): Promise<LeaderHealth> {
  const { ok, data } = await fetchJson(`${apiUrl()}/health`);
  if (!ok || !data) return { reachable: false, status: null, role: null };
  const h = unwrapItems<{ status?: string; role?: string }>(data)[0]
    ?? (data as { status?: string; role?: string });
  return { reachable: true, status: h?.status ?? null, role: h?.role ?? null };
}

// Best-effort: query the public Cribl release feed. Declared in proxies.yml.
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const res = await fetch('https://cdn.cribl.io/dl/latest-version');
    if (res.ok) {
      const t = (await res.text()).trim();
      // Response may be a bare version or JSON; take the first version-looking token.
      const match = t.match(/\d+\.\d+\.\d+/);
      return match ? match[0] : null;
    }
  } catch {
    /* offline / not declared — fall back to manual confirmation */
  }
  return null;
}

// --- Resource metrics (CPU / memory) --------------------------------------

// Query per-node CPU (load average) and memory usage over a recent window.
// Returns { available: false } when the endpoint can't be queried or returns
// no data, so the check degrades to `manual` instead of fabricating a verdict.
//
// Query shape is verified against real Cribl UI traffic (HAR capture):
//   POST /api/v1/system/metrics/query   (system-wide; NOT group-scoped — the
//     Worker Group is selected via the `where` clause, not the path)
//   body: { where, earliest: "<N>s", aggs: { aggregations, splitBys,
//           cumulative: true } }
// `cumulative: true` collapses the time series to ONE row per node (a
// timeWindowSeconds query instead returns one row per bucket per node).
//
// CPU: `system.load_avg` — the OS 1-min load average, NOT a percentage.
//   (`system.cpu_perc` is not populated on these workers; the UI always uses
//    load_avg.) The evaluator normalizes it to load-per-core using cpu counts.
// Memory: `system.free_mem` + `system.total_mem`; used% = (total-free)/total.
async function fetchResourceMetrics(groupId: string): Promise<ResourceMetrics> {
  const LOOKBACK_SEC = 30 * 60; // 30 minutes
  // Match the UI's filter: worker nodes in this group. Group id is single-quoted
  // (any embedded quote is escaped) exactly as the UI builds the expression.
  const gid = groupId.replace(/'/g, "\\'");
  const body = {
    where: `__dist_mode == 'worker' && __worker_group == '${gid}'`,
    earliest: `${LOOKBACK_SEC}s`,
    aggs: {
      aggregations: [
        'avg("system.load_avg").as("loadAvg")',
        'avg("system.free_mem").as("freeMem")',
        'avg("system.total_mem").as("totalMem")',
      ],
      splitBys: ['__worker_node'],
      cumulative: true,
    },
  };

  // System-wide endpoint (path is not group-scoped; the group is in `where`).
  const { ok, data } = await fetchJson(`${apiUrl()}/system/metrics/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!ok || !data) return { available: false, nodes: [] };

  // Response envelope: { results: [...] } (fall back to items/array).
  const d = data as { results?: unknown[]; items?: unknown[] };
  const rows = Array.isArray(d.results)
    ? d.results
    : Array.isArray(d.items)
      ? d.items
      : Array.isArray(data)
        ? (data as unknown[])
        : [];
  if (rows.length === 0) return { available: false, nodes: [] };

  const num = (v: unknown): number | null =>
    typeof v === 'number' && isFinite(v) ? v : null;

  const nodes = rows.map((raw) => {
    const r = raw as Record<string, unknown>;
    const loadAvg = num(r.loadAvg);
    const freeMem = num(r.freeMem);
    const totalMem = num(r.totalMem);
    // Node memory used %: (total - free) / total * 100 (Cribl UI's formula).
    const memPct =
      freeMem != null && totalMem != null && totalMem > 0
        ? ((totalMem - freeMem) / totalMem) * 100
        : null;
    return {
      node: String(r.__worker_node ?? r.host ?? 'unknown'),
      loadAvg,
      memPct,
    };
  });

  // If every node came back with no usable load or memory value, treat the
  // metrics as unavailable rather than reporting empty rows.
  const anyUsable = nodes.some((n) => n.loadAvg != null || n.memPct != null);
  return { available: anyUsable, nodes };
}

// --- Aggregate everything for a run ---------------------------------------

export async function loadDeploymentContext(group: WorkerGroup): Promise<DeploymentContext> {
  const gid = group.id;
  const [
    inputs,
    outputs,
    inputStatus,
    outputStatus,
    routes,
    pipelines,
    lookups,
    notifications,
    alertMonitors,
    settings,
    datasets,
    datatypes,
    leaderVersion,
    workerEntries,
    leaderHealth,
    latestVersion,
    resourceMetrics,
  ] = await Promise.all([
    fetchInputs(gid),
    fetchOutputs(gid),
    fetchInputStatus(gid),
    fetchOutputStatus(gid),
    fetchRoutes(gid),
    fetchPipelines(gid),
    fetchLookups(gid),
    fetchNotifications(gid),
    fetchAlertMonitors(),
    fetchSettings(gid),
    fetchSearchDatasets(),
    fetchSearchDatatypes(),
    fetchLeaderVersion(),
    fetchWorkerEntries(gid),
    fetchLeaderHealth(),
    fetchLatestVersion(),
    fetchResourceMetrics(gid),
  ]);

  return {
    group,
    isCloud: isCloudGroup(group),
    inputs,
    outputs,
    inputStatus,
    outputStatus,
    routes,
    pipelines,
    lookups,
    notifications,
    alertMonitors,
    settings,
    datasets,
    datatypes,
    leaderVersion,
    workerVersions: toNodeVersions(workerEntries),
    workerNodes: toWorkerNodes(workerEntries),
    leaderHealth,
    latestVersion,
    resourceMetrics,
  };
}
