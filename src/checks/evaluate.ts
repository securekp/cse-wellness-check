// Auto-evaluators. Each inspects the fetched DeploymentContext and returns a
// verdict. They never throw — on missing data they return `manual` so the
// reviewer can answer by hand (mirrors the Excel "how to check" fallback).

import type { CheckResult, DeploymentContext, SearchDataset, SearchDatatype, StatusEntry } from '../types';

// Cribl Search dataset types that read from object storage — "federated"
// datasets where partitioning determines how many objects a query must scan.
const OBJECT_STORE_DATASET_TYPES = new Set([
  's3',
  'gcs',
  'azure_blob',
  'amazon_security_lake',
]);

// Dataset types that require an associated datatype for event breaking / field
// extraction (federated providers). Lakehouse/native types auto-datatype.
const DATATYPE_REQUIRED_TYPES = new Set([
  's3',
  'gcs',
  'azure_blob',
  'amazon_security_lake',
  'cribl_lake',
  'cribl_edge',
]);

// Network source/destination types where plaintext transport is a real risk.
const NETWORK_TYPES = new Set([
  'syslog',
  'tcp',
  'tcpjson',
  'splunk',
  'splunk_hec',
  'cribl_http',
  'cribl_tcp',
  'http',
  'elastic',
  'kafka',
  'kinesis',
]);

// Push sources that benefit from Persistent Queues.
const PQ_SOURCE_TYPES = new Set([
  'syslog',
  'tcp',
  'tcpjson',
  'udp',
  'http',
  'splunk_hec',
  'cribl_http',
  'cribl_tcp',
  'kafka',
  'confluent_cloud',
  'websocket',
  'elastic',
]);

// Destinations that support (and benefit from) Persistent Queues.
const PQ_DEST_TYPES = new Set([
  'splunk_hec',
  'splunk',
  'syslog',
  'tcpjson',
  'kafka',
  'confluent_cloud',
  'cloudwatch',
  'elastic',
  'http',
  'webhook',
]);

// Volume-reducing functions that should appear early in a pipeline.
const REDUCING_FUNCS = new Set([
  'drop',
  'sampling',
  'dynamic_sampling',
  'suppress',
  'regex_filter',
  'aggregation',
  'rollup_metrics',
]);

// Expensive functions best placed AFTER volume reduction.
const EXPENSIVE_FUNCS = new Set([
  'lookup',
  'redis',
  'dns_lookup',
  'geoip',
  'code',
  'sensitive_data_scanner',
  'grok',
]);

function pass(summary: string, extra?: Partial<CheckResult>): CheckResult {
  return { status: 'pass', suggestedCustomerStatus: 'YES', evidence: { summary }, ...extra };
}
function fail(summary: string, items?: string[]): CheckResult {
  return { status: 'fail', suggestedCustomerStatus: 'NO', evidence: { summary, items } };
}
function warn(summary: string, items?: string[]): CheckResult {
  return { status: 'warn', suggestedCustomerStatus: 'NO', evidence: { summary, items } };
}
function manual(summary: string): CheckResult {
  return { status: 'manual', suggestedCustomerStatus: '', evidence: { summary } };
}
function na(summary: string): CheckResult {
  return { status: 'na', suggestedCustomerStatus: 'N/A', evidence: { summary } };
}

// Normalize a status entry's health into 'green' | 'yellow' | 'red' | 'unknown'.
// Cribl encodes health as 0=green, 1=yellow, 2=red (numeric) in various fields.
function healthOf(e: StatusEntry): 'green' | 'yellow' | 'red' | 'unknown' {
  const raw =
    (typeof e.health === 'object' && e.health ? e.health.status : e.health) ?? e.status;
  if (raw === 0 || raw === '0' || raw === 'green' || raw === 'healthy') return 'green';
  if (raw === 1 || raw === '1' || raw === 'yellow' || raw === 'degraded') return 'yellow';
  if (raw === 2 || raw === '2' || raw === 'red' || raw === 'unhealthy') return 'red';
  return 'unknown';
}

// --- Deploy ---------------------------------------------------------------

// Normalize a version string to its X.Y.Z core, or null if unparseable.
function coreVersion(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.match(/\d+\.\d+\.\d+/)?.[0] ?? null;
}

// CSE-DEPLOY-002: Leader and Workers on the latest version.
// Reads the Leader version (/system/info) and each Worker's self-reported
// version (/master/workers -> info.cribl.version) for this group. Verifies
// Leader/Workers agree, then compares to the latest GA release when available.
export function evalVersion(ctx: DeploymentContext): CheckResult {
  const leader = coreVersion(ctx.leaderVersion);
  const workers = ctx.workerVersions
    .map((w) => ({ ...w, core: coreVersion(w.version) }))
    .filter((w) => w.core);

  if (!leader && workers.length === 0) {
    return manual('Could not read Leader or Worker versions from the API.');
  }

  // Distinct versions across Leader + connected Workers.
  const all = new Set<string>();
  if (leader) all.add(leader);
  for (const w of workers) all.add(w.core as string);

  const latest = coreVersion(ctx.latestVersion);
  const parts: string[] = [];
  if (leader) parts.push(`Leader ${leader}`);
  if (workers.length) parts.push(`${workers.length} Worker(s)`);
  const measured = [...all].join(', ');

  // Report any Workers running a different version than the Leader.
  const mismatched = leader
    ? workers.filter((w) => w.core !== leader).map((w) => `${w.hostname ?? w.id}: ${w.core}`)
    : [];

  // 1. Version consistency across the group.
  if (all.size > 1) {
    return {
      ...warn(
        `Mixed versions across the deployment (${measured}). Align Leader and all Worker Nodes to the same release.`,
        mismatched.length ? mismatched : undefined,
      ),
      evidence: {
        summary: 'Leader and Worker versions are not aligned.',
        measured,
        items: mismatched.length ? mismatched : undefined,
      },
    };
  }

  // Single, consistent version across the deployment.
  const current = [...all][0];

  // 2. Compare to the latest GA release, if we could fetch it.
  if (!latest) {
    return {
      ...pass(`${parts.join(' and ')} on ${current} (consistent).`),
      evidence: {
        summary:
          'Leader and Workers are on a consistent version. Could not fetch the latest GA release to compare — verify against https://docs.cribl.io/stream/release-notes',
        measured: current,
      },
    };
  }
  if (current === latest) {
    return {
      ...pass(`On the latest version (${current}).`),
      evidence: { summary: 'Leader and all Workers are on the latest version.', measured: current },
    };
  }
  return {
    ...warn(`Running ${current}; latest GA is ${latest}. Upgrade the Leader first, then Workers.`),
    evidence: { summary: 'A newer release is available.', measured: `${current} → ${latest}` },
  };
}

// CSE-DEPLOY-002b: Leader / workspace reachability.
export function evalLeaderHealth(ctx: DeploymentContext): CheckResult {
  const h = ctx.leaderHealth;
  if (!h) return manual('Could not read the Leader health endpoint.');
  if (!h.reachable) {
    return fail(
      'The Leader health endpoint did not return a healthy response. The workspace UI/API may be unreachable and configuration changes cannot be pushed.',
    );
  }
  const role = h.role ? ` (role: ${h.role})` : '';
  if (h.status === 'healthy' || h.status === 'standby') {
    return { ...pass(`Leader is reachable and reports "${h.status}"${role}.`), evidence: { summary: 'Leader/workspace is reachable and healthy.', measured: `${h.status}${role}` } };
  }
  return {
    ...warn(`Leader is reachable but reports "${h.status ?? 'unknown'}"${role}.`),
    evidence: { summary: 'Leader is reachable but not in a healthy state.', measured: `${h.status ?? 'unknown'}${role}` },
  };
}

// CSE-DEPLOY-003: All Worker Nodes are reporting/connected to the Leader.
// Also flags stale heartbeats (health telemetry stopped = possible blind
// outage) and very recent restarts (churn / restart loops).
export function evalWorkersReporting(ctx: DeploymentContext): CheckResult {
  const nodes = ctx.workerNodes;
  if (nodes.length === 0) {
    return manual('No Worker Nodes were returned for this group by /master/workers.');
  }
  const now = Date.now();
  const STALE_MS = 5 * 60 * 1000; // heartbeat older than 5 min = stale
  const RECENT_START_MS = 15 * 60 * 1000; // started within 15 min = recently (re)started

  const disconnected = nodes.filter((n) => !n.connected).map((n) => n.hostname ?? n.id);
  const stale = nodes
    .filter((n) => n.connected && n.lastMsgMs != null && now - n.lastMsgMs > STALE_MS)
    .map((n) => `${n.hostname ?? n.id}: last heartbeat ${Math.round((now - (n.lastMsgMs as number)) / 60000)} min ago`);
  const recentlyStarted = nodes
    .filter((n) => n.startTimeMs != null && now - n.startTimeMs < RECENT_START_MS)
    .map((n) => `${n.hostname ?? n.id}: started ${Math.round((now - (n.startTimeMs as number)) / 60000)} min ago`);

  const measured = `${nodes.length - disconnected.length}/${nodes.length} connected`;

  if (disconnected.length > 0) {
    return {
      ...fail(`${disconnected.length} of ${nodes.length} Worker Node(s) are not reporting to the Leader.`, disconnected),
      evidence: { summary: 'Some Worker Nodes are disconnected.', measured, items: disconnected },
    };
  }
  if (stale.length > 0) {
    return {
      ...warn(`${stale.length} connected Worker Node(s) have stale heartbeats — health telemetry may have stopped, which can mask a real outage.`, stale),
      evidence: { summary: 'Connected nodes with stale heartbeats.', measured, items: stale },
    };
  }
  if (recentlyStarted.length > 0) {
    return {
      ...warn(`All ${nodes.length} Worker Node(s) are connected, but ${recentlyStarted.length} restarted recently — check for churn or a restart loop.`, recentlyStarted),
      evidence: { summary: 'All connected; recent restarts detected.', measured, items: recentlyStarted },
    };
  }
  return { ...pass(`All ${nodes.length} Worker Node(s) are reporting to the Leader.`), evidence: { summary: 'All Worker Nodes are connected with fresh heartbeats.', measured } };
}

// CSE-DEPLOY-003b: Every provisioned Worker Group has at least one healthy
// Worker. A group with zero healthy Workers stops processing/forwarding data.
export function evalWorkerCoverage(ctx: DeploymentContext): CheckResult {
  const nodes = ctx.workerNodes;
  // On Cribl.Cloud, a provisioned group with no workers is a real gap.
  if (nodes.length === 0) {
    if (ctx.isCloud && ctx.group.provisioned) {
      return fail('This provisioned Worker Group has no Worker Nodes — it cannot process or forward data.');
    }
    return manual('No Worker Nodes were returned for this group; confirm the group is expected to have Workers.');
  }
  // A node counts as healthy when connected and not reporting an unhealthy status.
  const healthy = nodes.filter((n) => n.connected && n.healthy !== false);
  const measured = `${healthy.length}/${nodes.length} healthy`;
  if (healthy.length === 0) {
    return {
      ...fail('This Worker Group has no healthy Workers — it will stop processing or forwarding data until a Worker recovers.'),
      evidence: { summary: 'No healthy Workers in the group.', measured },
    };
  }
  return { ...pass(`Worker Group has ${healthy.length} healthy Worker(s).`), evidence: { summary: 'Group has healthy Worker coverage.', measured } };
}

// CSE-DEPLOY-004: At least 5 GB free disk on each Worker Node.
export function evalWorkerDisk(ctx: DeploymentContext): CheckResult {
  const MIN = 5 * 1024 * 1024 * 1024; // 5 GB
  const withDisk = ctx.workerNodes.filter((n) => n.freeDiskBytes != null);
  if (withDisk.length === 0) {
    return manual(
      'Worker Nodes did not report free disk space. Verify each node has ≥5 GB free (Cribl.Cloud console, or `df -h` on hybrid nodes).',
    );
  }
  const low = withDisk
    .filter((n) => (n.freeDiskBytes as number) < MIN)
    .map((n) => `${n.hostname ?? n.id}: ${((n.freeDiskBytes as number) / 1024 ** 3).toFixed(1)} GB free`);
  if (low.length === 0) {
    return pass(`All ${withDisk.length} Worker Node(s) have at least 5 GB free disk.`);
  }
  return warn(`${low.length} of ${withDisk.length} Worker Node(s) have less than 5 GB free disk.`, low);
}

// CSE-DEPLOY-006: The stock "default" Worker Group is not used for production.
export function evalDefaultGroup(ctx: DeploymentContext): CheckResult {
  const id = ctx.group.id;
  const isDefault = id === 'default';
  const activeWorkers = ctx.workerNodes.filter((n) => n.connected).length;
  if (!isDefault) {
    return pass(`Running in a purpose-built Worker Group ("${ctx.group.name ?? id}"), not the stock default.`);
  }
  if (activeWorkers > 0) {
    return warn(
      `The stock "default" Worker Group has ${activeWorkers} active Worker(s). Use purpose-built Worker Groups so config is scoped and deployable per environment.`,
    );
  }
  return pass('The stock "default" Worker Group has no active Workers.');
}

// CSE-DEPLOY-005: TLS configured on network sources & destinations.
export function evalTls(ctx: DeploymentContext): CheckResult {
  const netInputs = ctx.inputs.filter((i) => NETWORK_TYPES.has(i.type) && !i.disabled);
  const netOutputs = ctx.outputs.filter((o) => NETWORK_TYPES.has(o.type) && !o.disabled);
  const offenders: string[] = [];
  for (const i of netInputs) {
    if (i.tls?.disabled === true || (!i.tls && i.type !== 'http')) {
      if (i.tls?.disabled === true) offenders.push(`source: ${i.id} (${i.type})`);
    }
  }
  for (const o of netOutputs) {
    if (o.tls?.disabled === true) offenders.push(`destination: ${o.id} (${o.type})`);
  }
  const total = netInputs.length + netOutputs.length;
  if (total === 0) return manual('No enabled network sources/destinations found to evaluate for TLS.');
  if (offenders.length === 0) {
    return pass(`All ${total} enabled network endpoints have TLS enabled (or defer to Cloud defaults).`);
  }
  return warn(
    `${offenders.length} of ${total} network endpoints have TLS explicitly disabled.`,
    offenders,
  );
}

// --- Debug ----------------------------------------------------------------

// CSE-DEBUG-001: Alerting configured — Stream Notifications and/or Cribl
// Insights alert Monitors. The Insights alert API is not available in every
// deployment; when it can't be queried we assess Stream Notifications alone.
export function evalNotifications(ctx: DeploymentContext): CheckResult {
  const notifications = ctx.notifications.filter((n) => !n.disabled).length;
  // null => Insights alerting API unavailable in this deployment.
  const monitorsAvailable = ctx.alertMonitors != null;
  const monitors = (ctx.alertMonitors ?? []).filter((m) => m.enabled !== false).length;

  const parts: string[] = [];
  if (notifications > 0) parts.push(`${notifications} Stream Notification(s)`);
  if (monitors > 0) parts.push(`${monitors} Insights alert Monitor(s)`);
  const measured = parts.length ? parts.join(' + ') : '0';

  // When we can't query Insights alerting, judge on Stream Notifications only.
  if (!monitorsAvailable) {
    if (notifications > 0) {
      return {
        ...pass(`${notifications} active Stream Notification(s) configured.`),
        evidence: { summary: 'Stream Notifications are active. (Cribl Insights alerting API is not available in this deployment.)', measured },
      };
    }
    return fail('No active Stream Notifications are configured. (Cribl Insights alerting API is not available in this deployment.)');
  }

  if (notifications > 0 && monitors > 0) {
    return { ...pass(`Alerting configured: ${measured}.`), evidence: { summary: 'Stream Notifications and Cribl Insights alerting are both active.', measured } };
  }
  if (notifications > 0 || monitors > 0) {
    const missing = notifications > 0 ? 'no Cribl Insights alert Monitors' : 'no Stream Notifications';
    return {
      ...warn(`Alerting partially configured (${measured}) — ${missing}. Cover both Stream Notifications and Cribl Insights alerting for full visibility.`),
      evidence: { summary: 'Only one alerting mechanism is active.', measured },
    };
  }
  return fail('No active alerting configured — set up Stream Notifications and/or Cribl Insights alert Monitors.');
}

// CSE-DEBUG-002 / 003: destinations / sources healthy.
function evalHealth(entries: StatusEntry[], kind: 'source' | 'destination'): CheckResult {
  if (entries.length === 0) return manual(`No ${kind} status data returned by the API.`);
  const unhealthy = entries
    .filter((e) => {
      const h = healthOf(e);
      return h === 'red' || h === 'yellow';
    })
    .map((e) => `${e.id ?? e.type ?? 'unknown'} (${healthOf(e)})`);
  if (unhealthy.length === 0) return pass(`All ${entries.length} ${kind}s report a healthy status.`);
  return fail(`${unhealthy.length} of ${entries.length} ${kind}s are degraded or unhealthy.`, unhealthy);
}
export function evalDestinationsHealthy(ctx: DeploymentContext): CheckResult {
  return evalHealth(ctx.outputStatus, 'destination');
}
export function evalSourcesHealthy(ctx: DeploymentContext): CheckResult {
  return evalHealth(ctx.inputStatus, 'source');
}

// CSE-DEBUG-004: CPU and memory utilization, from /system/metrics/query over a
// recent window (one cumulative row per Worker Node).
//
// CPU is reported by Cribl as `system.load_avg` (OS 1-min load average), NOT a
// percentage. We normalize it to load-per-core using each node's cpu count
// (from /master/workers): load/core ≈ 1.0 means the node is fully saturated.
// Warn at ≥ 0.8 load/core. Memory is a true percentage; warn at ≥ 85%.
// Degrades to `manual` when metrics are unavailable.
const LOAD_PER_CORE_WARN = 0.8;
const MEM_WARN_PCT = 85;
export function evalResourceUtilization(ctx: DeploymentContext): CheckResult {
  const rm = ctx.resourceMetrics;
  if (!rm.available || rm.nodes.length === 0) {
    return manual(
      'Could not read CPU/memory metrics from /system/metrics/query for this group. ' +
        'Review manually: Monitoring > Overview > CPU Load by Node (target load per core < 0.8) and Free Memory.',
    );
  }

  // Map node id -> cpu count so we can normalize load average per core.
  const cpusByNode = new Map<string, number>();
  for (const n of ctx.workerNodes) {
    if (n.cpus != null && n.cpus > 0) cpusByNode.set(n.id, n.cpus);
  }

  const pctFmt = (v: number | null): string => (v == null ? 'n/a' : `${v.toFixed(0)}%`);
  const hotCpu: string[] = [];
  const hotMem: string[] = [];
  const measuredParts: string[] = [];

  for (const n of rm.nodes) {
    const cpus = cpusByNode.get(n.node) ?? null;
    // Load per core, when we know the core count; otherwise report raw load.
    const perCore = n.loadAvg != null && cpus ? n.loadAvg / cpus : null;
    const cpuLabel =
      perCore != null
        ? `load/core ${perCore.toFixed(2)}`
        : n.loadAvg != null
          ? `load ${n.loadAvg.toFixed(2)}${cpus ? '' : ' (cores unknown)'}`
          : 'CPU n/a';
    measuredParts.push(`${n.node}: ${cpuLabel}, mem ${pctFmt(n.memPct)}`);

    if (perCore != null && perCore >= LOAD_PER_CORE_WARN) {
      hotCpu.push(`${n.node}: ${cpuLabel}${cpus ? ` (${cpus} cores)` : ''}`);
    }
    if (n.memPct != null && n.memPct >= MEM_WARN_PCT) {
      hotMem.push(`${n.node}: memory ${pctFmt(n.memPct)}`);
    }
  }

  const measured = measuredParts.join('; ');

  if (hotCpu.length === 0 && hotMem.length === 0) {
    return {
      ...pass(
        `All ${rm.nodes.length} Worker Node(s) are within limits (load per core < ${LOAD_PER_CORE_WARN}, memory < ${MEM_WARN_PCT}%).`,
      ),
      evidence: { summary: 'CPU (load per core) and memory utilization are within recommended limits.', measured },
    };
  }
  const parts: string[] = [];
  if (hotCpu.length) parts.push(`${hotCpu.length} node(s) at/over ${LOAD_PER_CORE_WARN} load per core`);
  if (hotMem.length) parts.push(`${hotMem.length} node(s) at/over ${MEM_WARN_PCT}% memory`);
  return {
    ...warn(`${parts.join(' and ')} — add capacity or reduce load.`, [...hotCpu, ...hotMem]),
    evidence: {
      summary: 'One or more Worker Nodes exceed the CPU/memory thresholds.',
      measured,
      items: [...hotCpu, ...hotMem],
    },
  };
}

// --- Develop --------------------------------------------------------------

// CSE-DEV-001: PQ enabled for critical push sources and destinations.
export function evalPersistentQueues(ctx: DeploymentContext): CheckResult {
  const pqSources = ctx.inputs.filter((i) => PQ_SOURCE_TYPES.has(i.type) && !i.disabled);
  const pqDests = ctx.outputs.filter((o) => PQ_DEST_TYPES.has(o.type) && !o.disabled);
  const missing: string[] = [];
  for (const i of pqSources) {
    if (!(i.pqEnabled || i.pq?.mode === 'always' || i.pq?.mode === 'smart')) {
      missing.push(`source: ${i.id} (${i.type})`);
    }
  }
  for (const o of pqDests) {
    if (!(o.pqEnabled || o.pq?.mode === 'always' || o.pq?.mode === 'smart')) {
      missing.push(`destination: ${o.id} (${o.type})`);
    }
  }
  const total = pqSources.length + pqDests.length;
  if (total === 0) return manual('No PQ-eligible push sources/destinations found.');
  if (missing.length === 0) return pass(`PQ is enabled on all ${total} eligible endpoints.`);
  return warn(
    `PQ is not enabled on ${missing.length} of ${total} eligible endpoints. Enable Persistent Queues on critical destinations where data loss is unacceptable — prefer durable PQ (dPQ) for guaranteed delivery, ensure the queue path has enough dedicated disk, and configure the drain rate so queued data flushes without overwhelming the destination.`,
    missing,
  );
}

// CSE-DEV-002: Filter fast and early.
export function evalFilterEarly(ctx: DeploymentContext): CheckResult {
  const offenders: string[] = [];
  for (const p of ctx.pipelines) {
    const fns = (p.conf?.functions ?? []).filter((f) => !f.disabled && f.id !== 'comment');
    const firstExpensive = fns.findIndex((f) => EXPENSIVE_FUNCS.has(f.id));
    if (firstExpensive === -1) continue;
    // Any volume-reducing function that appears AFTER the first expensive one.
    const lateReducer = fns.findIndex((f, idx) => idx > firstExpensive && REDUCING_FUNCS.has(f.id));
    if (lateReducer > -1) {
      offenders.push(`${p.id}: ${fns[lateReducer].id} runs after ${fns[firstExpensive].id}`);
    }
  }
  if (ctx.pipelines.length === 0) return manual('No pipelines with functions found to analyze.');
  if (offenders.length === 0) {
    return pass(`Reviewed ${ctx.pipelines.length} pipeline(s); volume reduction precedes expensive functions.`);
  }
  return warn(
    `${offenders.length} pipeline(s) run volume-reducing functions after expensive ones.`,
    offenders,
  );
}

// CSE-DEV-003: catchall Route (filter=true) at the end of the routes list.
export function evalCatchallRoute(ctx: DeploymentContext): CheckResult {
  const routes = ctx.routes.filter((r) => !r.disabled);
  if (routes.length === 0) return manual('No routes returned by the API.');
  const last = routes[routes.length - 1];
  const f = (last.filter ?? '').trim();
  if (f === 'true' || f === '1' || f === '') {
    return pass(`Last route "${last.name ?? last.id ?? ''}" is a catchall (filter = ${f || 'true'}).`);
  }
  return warn(
    `The final route "${last.name ?? last.id ?? ''}" has filter \`${f}\`, not a catchall. Unmatched events may be dropped.`,
  );
}

// CSE-DEV-007: Routing & pipeline efficiency. Flags a large route table (every
// event is tested against each route filter in order), disabled routes left in
// place, and pipelines heavy on per-event functions (code / regex-based).
export function evalRoutingEfficiency(ctx: DeploymentContext): CheckResult {
  const activeRoutes = ctx.routes.filter((r) => !r.disabled);
  if (ctx.routes.length === 0 && ctx.pipelines.length === 0) {
    return manual('No routes or pipelines returned by the API to analyze.');
  }
  const findings: string[] = [];

  // Large route tables add per-event filter evaluation cost.
  const MANY_ROUTES = 20;
  if (activeRoutes.length >= MANY_ROUTES) {
    findings.push(
      `${activeRoutes.length} active routes — order the most selective/highest-volume routes first and set Final where possible.`,
    );
  }

  // Disabled routes still clutter the table and hint at stale config.
  const disabledRoutes = ctx.routes.filter((r) => r.disabled).length;
  if (disabledRoutes > 0) {
    findings.push(`${disabledRoutes} disabled route(s) left in the table — remove if no longer needed.`);
  }

  // Pipelines dominated by expensive per-event functions (code, regex, grok).
  const HEAVY = new Set(['code', 'regex_extract', 'regex_filter', 'grok', 'mask']);
  for (const p of ctx.pipelines) {
    const fns = (p.conf?.functions ?? []).filter((f) => !f.disabled && f.id !== 'comment');
    if (fns.length === 0) continue;
    const heavy = fns.filter((f) => HEAVY.has(f.id)).length;
    const codeFns = fns.filter((f) => f.id === 'code').length;
    if (codeFns > 0 && heavy / fns.length >= 0.5) {
      findings.push(
        `${p.id}: ${heavy}/${fns.length} functions are regex/code-heavy — consider consolidating or moving to native functions.`,
      );
    }
  }

  if (findings.length === 0) {
    return pass(`Reviewed ${activeRoutes.length} route(s) and ${ctx.pipelines.length} pipeline(s); no efficiency concerns detected.`);
  }
  return warn('Routing/pipeline efficiency opportunities found.', findings);
}

// CSE-DEV-004: default Destination does not match any existing route.
export function evalDefaultDestOverlap(ctx: DeploymentContext): CheckResult {
  // The QuickConnect/default output path is only a duplication risk when a route
  // also targets it. Without route->output mapping certainty, flag for review.
  const routesWithOutputs = ctx.routes.filter((r) => !r.disabled && r.output).length;
  if (ctx.routes.length === 0) return manual('No routes returned by the API to compare against the default Destination.');
  return manual(
    `Confirm the default Destination is not also referenced by any of the ${routesWithOutputs} route(s) that set an explicit output, ` +
      'to avoid event duplication. See https://docs.cribl.io/stream/routes/#endroute',
  );
}

// CSE-DEV-005: all lookup files < 200MB.
export function evalLookupSize(ctx: DeploymentContext): CheckResult {
  const LIMIT = 200 * 1024 * 1024;
  const withSize = ctx.lookups
    .map((l) => ({ id: l.id, size: l.size ?? l.fileInfo?.size ?? 0 }))
    .filter((l) => l.size > 0);
  if (withSize.length === 0) return manual('No lookup file sizes returned by the API.');
  const large = withSize
    .filter((l) => l.size >= LIMIT)
    .map((l) => `${l.id} (${(l.size / 1024 / 1024).toFixed(0)} MB)`);
  if (large.length === 0) return pass(`All ${withSize.length} lookup file(s) are under 200 MB.`);
  return warn(`${large.length} lookup file(s) are 200 MB or larger.`, large);
}

// CSE-DEV-006: Aggregation/Suppress functions with time limits < 5 minutes.
export function evalAggWindows(ctx: DeploymentContext): CheckResult {
  const LIMIT = 300; // seconds
  const offenders: string[] = [];
  let checked = 0;
  for (const p of ctx.pipelines) {
    for (const fn of p.conf?.functions ?? []) {
      if (fn.disabled) continue;
      if (fn.id !== 'aggregation' && fn.id !== 'suppress') continue;
      checked++;
      const conf = fn.conf ?? {};
      // Aggregation uses `timeWindow` (e.g. "10m"/"30s"); Suppress uses `suppressPeriodSec`.
      const win =
        parseDuration(conf.timeWindow) ??
        (typeof conf.suppressPeriodSec === 'number' ? conf.suppressPeriodSec : null);
      if (win != null && win >= LIMIT) {
        offenders.push(`${p.id}: ${fn.id} window ${formatDuration(win)}`);
      }
    }
  }
  if (checked === 0) return manual('No Aggregation or Suppress functions found in any pipeline.');
  if (offenders.length === 0) return pass(`All ${checked} Aggregation/Suppress function(s) use windows under 5 minutes.`);
  return warn(`${offenders.length} Aggregation/Suppress function(s) use windows of 5 minutes or more.`, offenders);
}

// Parse a Cribl duration string ("30s", "10m", "1h") or number-of-seconds.
function parseDuration(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*([smh]?)$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  switch (m[2]) {
    case 'h':
      return n * 3600;
    case 'm':
      return n * 60;
    default:
      return n; // seconds (or unitless)
  }
}

function formatDuration(sec: number): string {
  if (sec % 3600 === 0) return `${sec / 3600}h`;
  if (sec % 60 === 0) return `${sec / 60}m`;
  return `${sec}s`;
}

// CSE-DEV-008: No hardcoded secrets in pipeline functions. Scans each active
// function's serialized conf for inline passwords / API keys / tokens / AWS
// keys. Ported from FDSE CRIBL-CFG-018. Recommend C.Secret.get() instead.
const SECRET_PATTERNS: RegExp[] = [
  /(?:password|passwd|pwd)\s*[:=]\s*['"][^'"]{4,}/i,
  /(?:api[_-]?key|apikey|secret[_-]?key)\s*[:=]\s*['"][^'"]{8,}/i,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /(?:bearer|token)\s+[A-Za-z0-9_\-.]{20,}/i,
];
export function evalHardcodedSecrets(ctx: DeploymentContext): CheckResult {
  if (ctx.pipelines.length === 0) return manual('No pipelines with functions found to analyze.');
  const offenders: string[] = [];
  for (const p of ctx.pipelines) {
    for (const fn of p.conf?.functions ?? []) {
      if (fn.disabled) continue;
      const serialized = JSON.stringify(fn.conf ?? {});
      if (SECRET_PATTERNS.some((re) => re.test(serialized))) {
        offenders.push(`${p.id}: ${fn.id}`);
      }
    }
  }
  if (offenders.length === 0) {
    return pass(`Scanned ${ctx.pipelines.length} pipeline(s); no hardcoded secrets detected in function configs.`);
  }
  return fail(
    `${offenders.length} pipeline function(s) appear to contain a hardcoded secret or credential. Move them to the secret store and reference via C.Secret.get().`,
    offenders,
  );
}

// CSE-DEV-009: No destinations with Persistent Queue set to drop on
// backpressure — that silently discards events even with PQ "enabled".
// Ported from FDSE CRIBL-CFG-003.
export function evalPqDropOnBackpressure(ctx: DeploymentContext): CheckResult {
  const offenders: string[] = [];
  let checked = 0;
  for (const o of ctx.outputs) {
    if (o.disabled) continue;
    const mode = o.pq?.mode ?? o.pqMode;
    const onBackpressure = o.pq?.onBackpressure ?? o.pqOnBackpressure;
    const pqActive = mode === 'backpressure' || mode === 'always' || mode === 'error';
    if (!pqActive) continue;
    checked++;
    if (onBackpressure === 'drop') offenders.push(`${o.id} (${o.type})`);
  }
  if (checked === 0) return manual('No destinations with Persistent Queue enabled were found.');
  if (offenders.length === 0) {
    return pass(`All ${checked} PQ-enabled destination(s) block or error on backpressure (no silent drops).`);
  }
  return warn(
    `${offenders.length} of ${checked} PQ-enabled destination(s) drop events when the queue backpressures — set pqOnBackpressure to "block" if data loss is unacceptable.`,
    offenders,
  );
}

// CSE-DEV-010: Configuration hygiene — orphaned sources/destinations (enabled
// but not referenced by any active route) and orphaned lookups (not used by any
// pipeline function). Ported from FDSE CRIBL-CFG-016/019/020.
export function evalConfigHygiene(ctx: DeploymentContext): CheckResult {
  const activeRoutes = ctx.routes.filter((r) => !r.disabled);
  const findings: string[] = [];

  // Build the reference sets the way FDSE does: route.input / route.output plus
  // any __inputId == 'x' comparisons embedded in route filters.
  const inputRefs = new Set<string>();
  const outputRefs = new Set<string>();
  let hasCatchAllRoute = false;
  for (const r of activeRoutes) {
    if (r.input) inputRefs.add(String(r.input));
    if (r.output) outputRefs.add(String(r.output));
    const f = (r.filter ?? '').trim();
    if (f === 'true' || (!f && !r.input)) hasCatchAllRoute = true;
    const matches = f.match(/__inputId\s*==\s*['"]([^'"]+)['"]/g);
    if (matches) {
      for (const seg of matches) {
        const id = seg.match(/['"]([^'"]+)['"]/)?.[1];
        if (id) inputRefs.add(id);
      }
    }
  }

  // A catchall route consumes every source, so source-orphan detection is moot.
  if (activeRoutes.length > 0 && !hasCatchAllRoute) {
    const orphanSources = ctx.inputs
      .filter((i) => !i.disabled && !inputRefs.has(i.id))
      .map((i) => `source: ${i.id} (${i.type})`);
    if (orphanSources.length > 0) findings.push(...orphanSources);
  }

  if (activeRoutes.length > 0) {
    const orphanDests = ctx.outputs
      .filter((o) => !o.disabled && !outputRefs.has(o.id))
      .map((o) => `destination: ${o.id} (${o.type})`);
    if (orphanDests.length > 0) findings.push(...orphanDests);
  }

  // Lookups referenced by any active function (filename / lookupFile / file).
  const lookupRefs = new Set<string>();
  for (const p of ctx.pipelines) {
    for (const fn of p.conf?.functions ?? []) {
      if (fn.disabled) continue;
      const c = fn.conf ?? {};
      for (const key of ['filename', 'lookupFile', 'file']) {
        const v = (c as Record<string, unknown>)[key];
        if (typeof v === 'string' && v) lookupRefs.add(v);
      }
    }
  }
  const orphanLookups = ctx.lookups
    .filter((l) => !lookupRefs.has(l.id))
    .map((l) => `lookup: ${l.id}`);
  if (ctx.pipelines.length > 0 && orphanLookups.length > 0) findings.push(...orphanLookups);

  if (ctx.routes.length === 0 && ctx.pipelines.length === 0) {
    return manual('No routes or pipelines returned by the API to analyze for orphaned config.');
  }
  if (findings.length === 0) {
    return pass('No orphaned sources, destinations, or lookups detected — every enabled resource is referenced.');
  }
  return warn(
    `${findings.length} configuration item(s) are enabled but unreferenced — remove or wire them up to reduce confusion and drift.`,
    findings,
  );
}

// CSE-DEV-012: No pipeline regex is prone to catastrophic backtracking, which
// can hang a Worker process on adversarial input (= stalls and data loss).
// Ported from FDSE CRIBL-CFG-023's pattern analyzer.

// Extract regex-looking literals from a function's conf, per function type.
function extractRegexes(fnId: string, conf: Record<string, unknown>, filter?: string): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.length > 2) out.push(v);
  };
  // /pattern/flags literals embedded in a string (filters, eval/code bodies).
  const fromCode = (s: unknown): void => {
    if (typeof s !== 'string') return;
    const re = /\/([^/\n]+)\/[gimsuy]*/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) if (m[1].length > 2) out.push(m[1]);
  };

  if (filter && filter !== 'true') fromCode(filter);

  if (fnId.includes('regex')) {
    push(conf.regex);
    if (Array.isArray(conf.regexList)) for (const r of conf.regexList) push((r as { regex?: unknown })?.regex);
  }
  if (fnId.includes('mask')) {
    if (Array.isArray(conf.rules)) {
      for (const r of conf.rules as { matchRegex?: unknown; regex?: unknown }[]) {
        push(r.matchRegex);
        push(r.regex);
      }
    }
  }
  if (fnId.includes('eval')) {
    if (Array.isArray(conf.add)) for (const a of conf.add as { value?: unknown }[]) fromCode(a.value);
    if (Array.isArray(conf.remove)) for (const r of conf.remove) fromCode(r);
  }
  if (fnId.includes('parser') || fnId === 'serde' || fnId.includes('serialize')) {
    push(conf.srcRegex);
    push(conf.delimRegex);
  }
  if (fnId.includes('code')) fromCode(conf.code);

  return [...new Set(out)];
}

// Heuristic risk classification for a single regex pattern.
function regexRisk(p: string): { risk: 'critical' | 'high' | 'moderate' | 'safe'; reason: string } {
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(p)) {
    return { risk: 'critical', reason: 'nested quantifiers — exponential backtracking risk' };
  }
  if (/\([^)]*\|[^)]*\)[+*{]/.test(p) && overlappingAlternation(p)) {
    return { risk: 'critical', reason: 'overlapping alternation with quantifier — exponential backtracking' };
  }
  const wildcards = (p.match(/\.\*|\.\+/g) || []).length;
  if (wildcards >= 3) {
    return { risk: 'high', reason: `${wildcards} greedy wildcards — polynomial backtracking on non-matching input` };
  }
  if (/\([^)]*[+*?][^)]*\)\*/.test(p) || /\([^)]*[+*?][^)]*\)\+/.test(p)) {
    return { risk: 'high', reason: 'quantifier applied to a group that already contains a quantifier — backtracking amplification' };
  }
  if (/\(\?[=!][^)]*[*+][^)]*\)/.test(p) && /[*+]/.test(p)) {
    return { risk: 'moderate', reason: 'lookahead combined with repetition — potential backtracking on failure' };
  }
  return { risk: 'safe', reason: '' };
}

function overlappingAlternation(p: string): boolean {
  const m = p.match(/\(([^)]+)\)[+*{]/);
  if (!m) return false;
  const alts = m[1].split('|');
  if (alts.length < 2) return false;
  if (alts.some((a) => /^[.*+]+$/.test(a.trim()))) return true;
  const firsts = alts.map((a) => a.trim()[0]).filter(Boolean);
  return firsts.length !== new Set(firsts).size;
}

export function evalDangerousRegex(ctx: DeploymentContext): CheckResult {
  if (ctx.pipelines.length === 0) return manual('No pipelines with functions found to analyze.');
  const offenders: string[] = [];
  for (const p of ctx.pipelines) {
    for (const fn of p.conf?.functions ?? []) {
      if (fn.disabled) continue;
      for (const pattern of extractRegexes(fn.id, fn.conf ?? {}, fn.filter)) {
        const { risk, reason } = regexRisk(pattern);
        if (risk !== 'safe') {
          const short = pattern.length > 48 ? `${pattern.slice(0, 48)}…` : pattern;
          offenders.push(`${p.id}: ${fn.id} [${risk}] /${short}/ — ${reason}`);
        }
      }
    }
  }
  if (offenders.length === 0) {
    return pass(`Analyzed regex across ${ctx.pipelines.length} pipeline(s); no catastrophic-backtracking risks found.`);
  }
  return warn(
    `${offenders.length} regex pattern(s) risk catastrophic backtracking, which can hang a Worker process on specific input. Rewrite to remove nested/overlapping quantifiers.`,
    offenders,
  );
}

// --- Search ---------------------------------------------------------------

// Does a dataset have a datatype (or its own event-breaking) configured?
// Federated datasets need a datatype for event breaking + field extraction;
// without one, raw input isn't parsed into queryable events.
function hasDatatype(d: SearchDataset): boolean {
  if (Array.isArray(d.datatypes) && d.datatypes.length > 0) return true;
  // Some datasets carry inline event-breaker rulesets instead of a named datatype.
  if (Array.isArray(d.breakerRulesets) && d.breakerRulesets.length > 0) return true;
  return false;
}

// CSE-SEARCH-001: Search datasets have datatypes set up.
export function evalSearchDatatypes(ctx: DeploymentContext): CheckResult {
  if (ctx.datasets.length === 0) {
    return manual('No Search datasets were returned by the API (Search may be unused or not accessible).');
  }
  // Only federated/object-store & lake/edge datasets require an explicit datatype;
  // native/lakehouse and API datasets parse structured responses automatically.
  const needing = ctx.datasets.filter((d) => DATATYPE_REQUIRED_TYPES.has(d.type));
  if (needing.length === 0) {
    return pass(`All ${ctx.datasets.length} dataset(s) use types that datatype automatically.`);
  }
  const missing = needing
    .filter((d) => !hasDatatype(d))
    .map((d) => `${d.id} (${d.type})`);
  if (missing.length === 0) {
    return pass(`All ${needing.length} datatype-eligible dataset(s) have a datatype or event-breaker configured.`);
  }
  return warn(
    `${missing.length} of ${needing.length} datatype-eligible dataset(s) have no datatype or event-breaker — events won’t be parsed into fields.`,
    missing,
  );
}

// CSE-SEARCH-002: Federated (object-store) datasets have partitioning set up.
export function evalSearchPartitioning(ctx: DeploymentContext): CheckResult {
  const federated = ctx.datasets.filter((d) => OBJECT_STORE_DATASET_TYPES.has(d.type));
  if (federated.length === 0) {
    return ctx.datasets.length === 0
      ? manual('No Search datasets were returned by the API.')
      : na('No federated (object-store) datasets found — partitioning not applicable.');
  }
  // A dataset is considered well-partitioned when it declares a partitioning
  // scheme OR narrows the objects scanned via a path filter expression.
  const unpartitioned = federated
    .filter((d) => {
      const hasScheme = typeof d.partitioningScheme === 'string' && d.partitioningScheme.length > 0;
      const hasFilter = typeof d.filter === 'string' && d.filter.trim() !== '' && d.filter.trim() !== 'true';
      return !hasScheme && !hasFilter;
    })
    .map((d) => `${d.id} (${d.type})`);
  if (unpartitioned.length === 0) {
    return pass(`All ${federated.length} federated dataset(s) declare a partitioning scheme or path filter.`);
  }
  return warn(
    `${unpartitioned.length} of ${federated.length} federated dataset(s) lack partitioning or a path filter — queries may scan the entire bucket, increasing latency and object-store cost.`,
    unpartitioned,
  );
}

// CSE-SEARCH-003: Prefer v2 Datatypes over the older v1 model.
// Per Cribl docs, v1 Datatypes are "gradually being replaced with the more
// efficient v2 Datatypes" (v2 is faster, works across all Search Sources, and
// supports Auto-Datatyping).
//
// Field semantics confirmed from a live /search/datatypes response: v2
// datatypes carry `searchVersion: "v2"`; v1 datatypes omit the field. Cribl
// ships ~190 stock datatypes (lib "cribl") that are almost all v1 today — those
// are Cribl's to migrate, not the customer's, so we only evaluate
// customer-authored datatypes (lib other than "cribl") to avoid flagging the
// entire stock library.
function isV2Datatype(d: SearchDatatype): boolean {
  return typeof d.searchVersion === 'string' && d.searchVersion.trim().toLowerCase() === 'v2';
}

// CSE-SEARCH-004: Acceleration enabled on federated (object-store) datasets.
// Acceleration backfills and refreshes dataset statistics so repeated searches
// prune objects and return faster; on federated object-store datasets (which
// otherwise list/scan the bucket on every query) it has the biggest payoff.
// Native/lakehouse datasets are already fast and don't expose this control, so
// only federated object-store datasets are evaluated. This is a recommendation
// (warn), not a hard failure — acceleration is a cost/benefit tradeoff and is
// most valuable on frequently searched datasets.
export function evalSearchAcceleration(ctx: DeploymentContext): CheckResult {
  const federated = ctx.datasets.filter((d) => OBJECT_STORE_DATASET_TYPES.has(d.type));
  if (federated.length === 0) {
    return ctx.datasets.length === 0
      ? manual('No Search datasets were returned by the API.')
      : na('No federated (object-store) datasets found — acceleration not applicable.');
  }
  const unaccelerated = federated
    .filter((d) => d.metadata?.enableAcceleration !== true)
    .map((d) => `${d.id} (${d.type})`);
  if (unaccelerated.length === 0) {
    return pass(`All ${federated.length} federated dataset(s) have acceleration enabled.`);
  }
  return warn(
    `${unaccelerated.length} of ${federated.length} federated dataset(s) do not have acceleration enabled — enable it on frequently searched datasets so repeated queries prune objects and run faster.`,
    unaccelerated,
  );
}

export function evalDatatypeVersion(ctx: DeploymentContext): CheckResult {
  if (ctx.datatypes.length === 0) {
    return manual('No Search datatypes were returned by the API (Search may be unused or not accessible).');
  }
  // Only customer-authored datatypes are in scope; stock Cribl datatypes are
  // excluded (Cribl owns their v1→v2 migration).
  const custom = ctx.datatypes.filter((d) => (d.lib ?? '').toLowerCase() !== 'cribl');
  if (custom.length === 0) {
    return na(
      `All ${ctx.datatypes.length} Search datatype(s) are Cribl stock datatypes — no customer-authored datatypes to evaluate for v1/v2.`,
    );
  }
  // Break out every customer-authored datatype with its model, so the reviewer
  // sees the full v1/v2 split (not just the v1 offenders).
  const v2 = custom.filter((d) => isV2Datatype(d));
  const v1 = custom.filter((d) => !isV2Datatype(d));
  const breakdown = [
    ...v1.map((d) => `${d.id} — v1`),
    ...v2.map((d) => `${d.id} — v2`),
  ];
  if (v1.length === 0) {
    return {
      ...pass(`All ${custom.length} customer-authored datatype(s) use the v2 model.`),
      evidence: {
        summary: 'All customer-authored Search datatypes are on the v2 model.',
        measured: `${v2.length} v2 / 0 v1`,
        items: breakdown,
      },
    };
  }
  return {
    ...warn(
      `${v1.length} of ${custom.length} customer-authored Search datatype(s) are not on the v2 model — migrate to v2 for better efficiency, broader Source support, and Auto-Datatyping.`,
      breakdown,
    ),
    evidence: {
      summary: 'Some customer-authored Search datatypes are still on the v1 model.',
      measured: `${v2.length} v2 / ${v1.length} v1`,
      items: breakdown,
    },
  };
}
