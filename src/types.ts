// Core domain types for the CSE Wellness Check app.

export type Category = 'Deploy' | 'Debug' | 'Develop' | 'Search';

// The outcome of evaluating a single check.
// - pass / warn / fail: determined automatically from live Cribl APIs
// - manual: needs a human answer (host access or judgement); user toggles YES/NO/NA
// - na: not applicable to this deployment (e.g. on-prem-only checks in Cribl.Cloud)
// - error: the evaluator could not run (API failure)
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'manual' | 'na' | 'error';

// The customer-facing status recorded in the exported deliverable.
export type CustomerStatus = 'YES' | 'NO' | 'N/A' | '';

// How a check is answered.
export type CheckMode = 'auto' | 'manual';

export interface WorkerGroup {
  id: string;
  name?: string;
  description?: string;
  // Cribl Cloud groups carry a `cloud` block; on-prem groups do not.
  isFleet?: boolean;
  onPrem?: boolean;
  workerCount?: number;
  [key: string]: unknown;
}

// A piece of evidence an evaluator surfaces to justify its verdict, e.g.
// "3 of 8 network sources have TLS disabled" plus the offending item names.
export interface Evidence {
  summary: string;
  items?: string[];
  // Optional measured value shown inline (mirrors FDSE "measured: x = y").
  measured?: string;
}

// The result of running one check against one worker group.
export interface CheckResult {
  status: CheckStatus;
  evidence?: Evidence;
  // The status we suggest recording in the deliverable (YES=good, NO=needs work).
  suggestedCustomerStatus: CustomerStatus;
}

// The result plus any human overrides, as held in app state.
export interface CheckState {
  checkId: string;
  result: CheckResult;
  // User can override the auto verdict / set the manual answer.
  customerStatus: CustomerStatus;
  notes: string;
}

// An evaluator inspects fetched deployment data and returns a verdict.
// Manual checks have no evaluator.
export type Evaluator = (ctx: DeploymentContext) => CheckResult;

// A single wellness check, mirroring one row of the Excel "Step 3 Checklist".
export interface Check {
  id: string; // e.g. CSE-DEPLOY-001
  category: Category;
  mode: CheckMode;
  // The best-practice question, verbatim from the checklist.
  question: string;
  // "How to check" guidance from the Excel cell notes (manual verification steps).
  howTo?: string;
  // Best-practice description & implications, verbatim from the checklist.
  description?: string;
  // Docs links pulled out of the description for quick access.
  docsUrls?: string[];
  // Only present for on-prem deployments (auto-marked N/A on Cribl.Cloud).
  onPremOnly?: boolean;
  evaluator?: Evaluator;
}

// --- Live Cribl API shapes (only the fields we read) ----------------------

export interface CriblInput {
  id: string;
  type: string;
  disabled?: boolean;
  pqEnabled?: boolean;
  pq?: { mode?: string; commitFrequency?: number };
  tls?: { disabled?: boolean };
  [key: string]: unknown;
}

export interface CriblOutput {
  id: string;
  type: string;
  disabled?: boolean;
  pqEnabled?: boolean;
  // `onBackpressure` governs what happens when the queue fills: block | drop | error.
  pq?: { mode?: string; onBackpressure?: string };
  // Some deployments flatten the PQ fields onto the output.
  pqMode?: string;
  pqOnBackpressure?: string;
  tls?: { disabled?: boolean };
  [key: string]: unknown;
}

// /system/status/{inputs,outputs} entries carry health info.
export interface StatusEntry {
  id?: string;
  type?: string;
  health?: { status?: number | string } | number | string;
  status?: number | string;
  metrics?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Route {
  id?: string;
  name?: string;
  filter?: string;
  disabled?: boolean;
  final?: boolean;
  output?: string;
  pipeline?: string;
  [key: string]: unknown;
}

export interface RoutesConf {
  routes: Route[];
}

export interface PipelineFunction {
  id: string;
  disabled?: boolean;
  filter?: string;
  conf?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface Pipeline {
  id: string;
  conf?: { functions?: PipelineFunction[] };
  _packId?: string;
  [key: string]: unknown;
}

export interface LookupFile {
  id: string;
  size?: number; // bytes
  fileInfo?: { size?: number };
  [key: string]: unknown;
}

export interface Notification {
  id: string;
  disabled?: boolean;
  [key: string]: unknown;
}

// A Cribl Insights alert Monitor (from /alert/monitors).
export interface AlertMonitor {
  id: string;
  name?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

export interface WorkerProcess {
  id?: string;
  cpus?: number;
  cpuCount?: number;
  [key: string]: unknown;
}

// --- Cribl Search shapes (only the fields we read) ------------------------

export interface SearchDataset {
  id: string;
  // Discriminator: s3, gcs, azure_blob, amazon_security_lake, cribl_lake,
  // cribl_edge, cribl_search, api_*, clickhouse, snowflake, prometheus, etc.
  type: string;
  description?: string;
  provider?: string;
  // Object-store datasets locate objects via a partitioning scheme and/or a
  // path filter expression. Missing/empty => full-bucket scans on every query.
  partitioningScheme?: string | null;
  filter?: string;
  bucket?: string;
  extraPaths?: unknown[];
  // Datatype associations (v1 datasets reference datatypes for parsing).
  datatypes?: string[];
  breakerRulesets?: unknown[];
  [key: string]: unknown;
}

export interface SearchDatatype {
  id: string;
  description?: string;
  dataFormat?: string;
  // Datatype model version. Confirmed from a live /search/datatypes response:
  // v2 datatypes carry `searchVersion: "v2"`; v1 datatypes omit the field.
  searchVersion?: string;
  // Origin library: "cribl" for stock datatypes shipped by Cribl, or "custom"
  // (etc.) for customer-authored ones. Only customer datatypes are the
  // customer's to migrate, so stock datatypes are excluded from the v1/v2 check.
  lib?: string;
  [key: string]: unknown;
}

// A Worker Node's identity and reported Cribl version.
export interface NodeVersion {
  id: string;
  hostname?: string;
  version: string | null;
}

// /master/workers entry (only the fields we read). Nodes self-report their
// metadata under `info` on each heartbeat.
export interface MasterWorkerEntry {
  id: string;
  group?: string;
  disconnected?: boolean;
  status?: string;
  // Unix-time (seconds) of first/last heartbeat the Leader received.
  firstMsgTime?: number;
  lastMsgTime?: number;
  info?: {
    hostname?: string;
    cribl?: { version?: string; startTime?: number };
    freeDiskSpace?: number; // bytes
    totalDiskSpace?: number; // bytes
    cpus?: number;
    startTime?: number; // Unix time (ms) the process started
  };
  [key: string]: unknown;
}

// Normalized Worker Node view used by the health evaluators.
export interface WorkerNode {
  id: string;
  hostname?: string;
  version: string | null;
  connected: boolean;
  // Node health as reported to the Leader: green/healthy vs degraded/red.
  healthy: boolean | null;
  freeDiskBytes: number | null;
  cpus: number | null;
  // Unix-time (ms) of the last heartbeat, for stale/no-data detection.
  lastMsgMs: number | null;
  // Unix-time (ms) the Cribl process started, for churn/restart detection.
  startTimeMs: number | null;
}

// Per-node CPU/memory usage, aggregated from /system/metrics/query over a
// recent window (one cumulative row per node).
// - loadAvg: system.load_avg (OS 1-min load average; NOT a percentage). The
//   evaluator normalizes this to load-per-core using the node's cpu count.
// - memPct: (total_mem - free_mem) / total_mem * 100, i.e. 0–100.
export interface NodeResourceUsage {
  node: string;
  loadAvg: number | null;
  memPct: number | null;
}

// Outcome of the resource-metrics query: either usable rows, or a reason the
// query couldn't be evaluated (endpoint unavailable / no data), so the check
// can degrade to `manual` rather than fabricate a verdict.
export interface ResourceMetrics {
  available: boolean;
  nodes: NodeResourceUsage[];
}

// Leader / workspace reachability and role (from /health).
export interface LeaderHealth {
  reachable: boolean;
  status: string | null; // healthy | standby | shutting down
  role: string | null; // primary | standby
}

export interface SystemSettings {
  system?: {
    upgrade?: { mode?: string };
    telemetry?: { disabled?: boolean };
  };
  telemetry?: { disabled?: boolean };
  [key: string]: unknown;
}

// Everything an evaluator might need, fetched once per run.
export interface DeploymentContext {
  group: WorkerGroup;
  isCloud: boolean;
  inputs: CriblInput[];
  outputs: CriblOutput[];
  inputStatus: StatusEntry[];
  outputStatus: StatusEntry[];
  routes: Route[];
  pipelines: Pipeline[];
  lookups: LookupFile[];
  notifications: Notification[];
  // Cribl Insights alert Monitors (from /alert/monitors). null when the
  // endpoint is unavailable in this deployment.
  alertMonitors: AlertMonitor[] | null;
  settings: SystemSettings | null;
  // Cribl Search (fetched from the default_search group; empty if unavailable).
  datasets: SearchDataset[];
  datatypes: SearchDatatype[];
  // Running Cribl version of the Leader (from /system/info).
  leaderVersion: string | null;
  // Running Cribl version reported by each Worker Node in this group.
  workerVersions: NodeVersion[];
  // Normalized Worker Nodes (connection, disk, cpus) for this group.
  workerNodes: WorkerNode[];
  // Leader / workspace reachability (org-level).
  leaderHealth: LeaderHealth | null;
  latestVersion: string | null;
  // Per-node CPU/memory usage from /system/metrics/query (group-scoped).
  resourceMetrics: ResourceMetrics;
}

export interface RunReport {
  group: WorkerGroup;
  generatedAt: string;
  states: CheckState[];
}
