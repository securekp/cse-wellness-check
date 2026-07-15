// The wellness checks, mirroring the "Step 3 Checklist" of the Cribl Stream
// Wellness Review, adapted for Cribl Cloud. On-prem-only items and open-ended
// discussion questions (no technological answer) have been removed, and a
// Cribl Search section has been added. Question text and best-practice
// guidance track current Cribl documentation.

import type { Check } from '../types';
import {
  evalAggWindows,
  evalCatchallRoute,
  evalConfigHygiene,
  evalDangerousRegex,
  evalDatatypeVersion,
  evalDefaultDestOverlap,
  evalDefaultGroup,
  evalDestinationsHealthy,
  evalFilterEarly,
  evalHardcodedSecrets,
  evalLeaderHealth,
  evalLookupSize,
  evalNotifications,
  evalPersistentQueues,
  evalPqDropOnBackpressure,
  evalResourceUtilization,
  evalRoutingEfficiency,
  evalSearchAcceleration,
  evalSearchDatatypes,
  evalSearchPartitioning,
  evalSourcesHealthy,
  evalTls,
  evalVersion,
  evalWorkerCoverage,
  evalWorkerDisk,
  evalWorkersReporting,
} from './evaluate';

export const CHECKS: Check[] = [
  // ===== Deploy ===========================================================
  {
    id: 'CSE-DEPLOY-002',
    category: 'Deploy',
    mode: 'auto',
    question: 'Are Leader and Worker nodes on the latest version?',
    howTo:
      'Evaluated automatically: the Leader version comes from system info and each Worker Node self-reports its version. The check verifies Leader and Workers are aligned, then compares to the latest GA release. Upgrade the Leader first, then Workers.',
    description:
      'Keeping Cribl Stream on the latest version matters for:\n' +
      '- Security: patches for newly discovered vulnerabilities.\n' +
      '- Performance: processing and efficiency optimizations.\n' +
      '- New Features: access to the latest capabilities.\n' +
      '- Bug Fixes: stability and reliability improvements.\n' +
      '- Compatibility: reduced integration risk with connected tools.\n' +
      'Release notes: https://docs.cribl.io/stream/release-notes\n' +
      'Upgrade paths: https://docs.cribl.io/stream/upgrading/',
    docsUrls: ['https://docs.cribl.io/stream/release-notes', 'https://docs.cribl.io/stream/upgrading/'],
    evaluator: evalVersion,
  },
  {
    id: 'CSE-DEPLOY-003',
    category: 'Deploy',
    mode: 'auto',
    question: 'Is the Leader / workspace reachable and healthy?',
    howTo:
      'Evaluated automatically by probing the Leader health endpoint. A non-healthy or unreachable response indicates the workspace UI/API may be down.',
    description:
      'When the Leader is unhealthy or unreachable, the workspace UI and API can become unavailable and configuration changes cannot be pushed to Workers. The health endpoint returning "healthy" (or "standby" for a secondary Leader) confirms the control plane is operational. Alert if it stops returning a healthy response.',
    evaluator: evalLeaderHealth,
  },
  {
    id: 'CSE-DEPLOY-004',
    category: 'Deploy',
    mode: 'auto',
    question: 'Are all Worker Nodes reporting to the Leader?',
    howTo:
      'Evaluated automatically from /master/workers: flags disconnected nodes, stale heartbeats (health telemetry stopped), and recently restarted nodes (possible churn). In the UI, check Manage > Workers.',
    description:
      'A disconnected Worker Node is not processing deployed configuration and may be down or unable to reach the Leader. Stale heartbeats can mean the telemetry path is broken and a real outage is masked. Frequent restarts suggest a crash/restart loop. All expected nodes should be connected with fresh heartbeats and stable uptime.',
    evaluator: evalWorkersReporting,
  },
  {
    id: 'CSE-DEPLOY-005',
    category: 'Deploy',
    mode: 'auto',
    question: 'Does the Worker Group have at least one healthy Worker?',
    howTo:
      'Evaluated automatically: verifies the group has at least one connected, healthy Worker. A provisioned group with none cannot process data.',
    description:
      'Every provisioned Worker Group needs at least one healthy Worker to process and forward data. If a group drops to zero healthy Workers, all data flowing through it stops until a Worker recovers. This is one of the highest-impact conditions to catch.',
    evaluator: evalWorkerCoverage,
  },
  {
    id: 'CSE-DEPLOY-006',
    category: 'Deploy',
    mode: 'auto',
    question: 'Is there at least 5 GB of free disk space on each Worker Node?',
    howTo:
      'Evaluated automatically from each node’s reported free disk space. Also reviewable in the Cribl.Cloud console (or `df -h` on hybrid Worker Nodes).',
    description:
      'Insufficient disk space on Worker nodes can disrupt processing:\n\n' +
      '- Data Ingestion may stop if events cannot be stored.\n' +
      '- Persistent Queues cannot store data, risking event loss.\n' +
      '- System slowdown from disk I/O pressure.\n' +
      '- Processing failures and incorrect output.\n' +
      '- Logging of system events may fail, hindering troubleshooting.\n\n' +
      'For durable Persistent Queues, place the queue on a separate volume with dedicated headroom so queue growth cannot fill the system disk.',
    evaluator: evalWorkerDisk,
  },
  {
    id: 'CSE-DEPLOY-007',
    category: 'Deploy',
    mode: 'auto',
    question: 'TLS configured?',
    howTo:
      'To determine if TLS is configured:\n\n' +
      '1. Navigate to Data > Sources or Destinations.\n' +
      '2. Inspect each endpoint for TLS/SSL settings (enable TLS, certificates, keys).\n' +
      '3. Ensure TLS is enabled and certificate/key material is present.\n\n' +
      'NOTE: For Cribl-managed Cribl.Cloud Worker/Edge Nodes, ensure TLS is either disabled or enabled on BOTH the Cribl TCP Destination and the Cribl TCP Source. On Cribl.Cloud, the Cribl TCP Source ships with TLS enabled by default.',
    description:
      'Configuring TLS in Cribl Stream matters for:\n\n' +
      '- Data Encryption: protects data in transit from interception.\n' +
      '- Authentication: verifies the identity of communicating parties.\n' +
      '- Data Integrity: ensures data is not tampered with in transit.\n' +
      '- Compliance: many standards require encryption in transit.\n' +
      '- Preventing Eavesdropping: blocks third-party interception of the stream.',
    evaluator: evalTls,
  },
  {
    id: 'CSE-DEPLOY-008',
    category: 'Deploy',
    mode: 'auto',
    question: 'Is production traffic running in a purpose-built Worker Group (not the stock default)?',
    howTo:
      'Evaluated automatically: flags the stock "default" Worker Group when it has active Workers.',
    description:
      'The stock "default" Worker Group is a starting point, not a production target. Use purpose-built Worker Groups so configuration is scoped per environment/use case, is independently deployable, and follows least-privilege access. Running production workloads in the default group makes config management and isolation harder.',
    evaluator: evalDefaultGroup,
  },

  // ===== Debug ============================================================
  {
    id: 'CSE-DEBUG-001',
    category: 'Debug',
    mode: 'auto',
    question: 'Is alerting configured (Stream Notifications and Cribl Insights alert Monitors)?',
    howTo:
      'Evaluated automatically from Stream Notifications and Cribl Insights alert Monitors. In the UI, check the Notifications menu for Stream Notifications, and Cribl Insights > Alerting (alert Monitors) for metric/health-based alerts.',
    description:
      'Configure alerting so operational issues are surfaced proactively. Two complementary mechanisms:\n\n' +
      'Stream Notifications monitor conditions such as:\n' +
      '- High or Low Data Flow Rates\n' +
      '- No Data Flow\n' +
      '- Destinations Experiencing Backpressure\n' +
      '- Persistent Queue Threshold\n' +
      '- Destination Errors\n' +
      '- License-Expiration Notifications\n\n' +
      'Cribl Insights alert Monitors evaluate metrics/health queries on a schedule and alert on resource utilization, pipeline/destination degradation, and no-data conditions. Configure both for full coverage.',
    evaluator: evalNotifications,
  },
  {
    id: 'CSE-DEBUG-002',
    category: 'Debug',
    mode: 'auto',
    question: 'All destinations are in Healthy status?',
    howTo:
      'Navigate to the Monitoring > Data > Destinations report and look for any destinations with a status that is red or yellow.',
    evaluator: evalDestinationsHealthy,
  },
  {
    id: 'CSE-DEBUG-003',
    category: 'Debug',
    mode: 'auto',
    question: 'Are all sources in a Healthy status?',
    howTo:
      'Navigate to the Monitoring > Data > Sources report and look for any sources with a status that is red or yellow.',
    evaluator: evalSourcesHealthy,
  },
  {
    id: 'CSE-DEBUG-004',
    category: 'Debug',
    mode: 'auto',
    question: 'CPU and memory utilization level',
    howTo:
      'Evaluated automatically: per-Worker-Node CPU load average and memory are aggregated over the last 30 minutes from the metrics query API (system.load_avg, system.free_mem / system.total_mem), split by node. CPU load average is normalized to load-per-core using each node’s core count; nodes at/over 0.8 load per core or 85% memory are flagged. If metrics are unavailable, review manually under Monitoring > Overview > CPU Load by Node and Free Memory.',
    description:
      'High CPU or memory utilization can degrade performance and stability:\n\n' +
      'High CPU: increased latency, throttling/rate limiting, instability, connection issues.\n' +
      'High Memory: out-of-memory errors, swapping and slowness, crashes and data loss, inefficient resource use.\n\n' +
      'Continuously monitor CPU/memory and adjust resources to workload.',
    evaluator: evalResourceUtilization,
  },

  // ===== Develop ==========================================================
  {
    id: 'CSE-DEV-001',
    category: 'Develop',
    mode: 'auto',
    question: 'Are Persistent Queues (PQ) enabled for critical sources and destinations?',
    description:
      'Enable PQ based on criticality and behavior:\n\n' +
      'Sources — Enable PQ for Cribl push sources (Syslog, HTTP, TCP/UDP, Kafka, WebSocket). Do NOT enable for pull/collector sources (file-based, DB/API collect scripts).\n\n' +
      'Destinations — Enable PQ for critical destinations where data loss is unacceptable and backpressure must be buffered (HTTP-based e.g. CloudWatch Logs / Splunk HEC, Kafka, Syslog, TCP). Do NOT enable for less-critical destinations, those handling backpressure natively, or HTTP 4xx errors (fix the config instead).',
    evaluator: evalPersistentQueues,
  },
  {
    id: 'CSE-DEV-002',
    category: 'Develop',
    mode: 'auto',
    question: 'Filter fast and early',
    description:
      'Filtering early in your pipelines reduces the volume of data processed downstream:\n\n' +
      '- Resource Optimization: Less load on subsequent processing steps.\n' +
      '- Cost Efficiency: Reduced storage and processing costs.\n' +
      '- Enhanced Performance: Only relevant data reaches complex stages.\n' +
      '- Better Focus: Downstream functions operate on the most valuable data.\n\n' +
      'Use functions like Drop to filter at the earliest stages of your pipeline.',
    evaluator: evalFilterEarly,
  },
  {
    id: 'CSE-DEV-003',
    category: 'Develop',
    mode: 'auto',
    question:
      'Is there a catchall Route at the end of the routes list with a Filter = true to ensure no events fail to match a route filter?',
    description:
      'A catchall Route at the end of the routes list ensures no events fail to match a route filter. It serves as a fallback capturing events that do not match preceding filters. Without it, unmatched events might be dropped, causing incomplete processing and potential data loss.\n\n' +
      'To create a catchall Route, add a Route at the end of the Routes list with filter = true.',
    evaluator: evalCatchallRoute,
  },
  {
    id: 'CSE-DEV-004',
    category: 'Develop',
    mode: 'auto',
    question: 'Confirm default Destination does not match any existing route in table',
    howTo: 'See documentation: https://docs.cribl.io/stream/routes/#endroute',
    docsUrls: ['https://docs.cribl.io/stream/routes/#endroute'],
    description: 'Prevents potential event duplication caused by the default route.',
    evaluator: evalDefaultDestOverlap,
  },
  {
    id: 'CSE-DEV-005',
    category: 'Develop',
    mode: 'auto',
    question: 'Are all lookup files < 200MB?',
    howTo:
      'For each Worker Group, navigate to Processing > Knowledge > Lookups and refer to the Size column for each.',
    description:
      'There is no strict size limit for a "large" lookup, but files exceeding several hundred MB (e.g. 1 GB+) should be managed carefully to avoid performance issues. If a lookup approaches or exceeds these thresholds, add memory, index the lookup table, or consider alternatives like a Redis integration for faster lookups.',
    evaluator: evalLookupSize,
  },
  {
    id: 'CSE-DEV-006',
    category: 'Develop',
    mode: 'auto',
    question: 'Are all Aggregation/Suppress functions set with time limits less than 5 minutes?',
    description:
      'Longer durations for aggregation/suppress functions can lead to higher memory usage and resource issues.\n\n' +
      'Rule of Thumb: Aggregation windows beyond a few minutes (e.g. 5–10 minutes) can create noticeable memory and performance overhead, depending on data volume, aggregation complexity, and available resources.\n\n' +
      'Memory Impact: Longer aggregation periods keep more data in memory; high-velocity or large data can quickly consume significant memory.',
    evaluator: evalAggWindows,
  },
  {
    id: 'CSE-DEV-007',
    category: 'Develop',
    mode: 'auto',
    question: 'Are routes and pipelines structured efficiently?',
    howTo:
      'Evaluated automatically: flags large route tables, disabled routes left in place, and pipelines dominated by regex/code functions. Review route order in the Routes page and pipeline functions in the Pipelines page.',
    description:
      'Every event is evaluated against route filters in order, so keep the route table lean, order the most selective/highest-volume routes first, and use Final routes where appropriate. Within pipelines, minimize per-event cost: prefer native functions over Code, avoid catastrophic-backtracking regex, consolidate redundant functions, and reduce/drop data as early as possible in the path.',
    evaluator: evalRoutingEfficiency,
  },
  {
    id: 'CSE-DEV-008',
    category: 'Develop',
    mode: 'auto',
    question: 'Are all credentials stored securely, with no hardcoded secrets in pipeline functions?',
    howTo:
      'Evaluated automatically: each active function’s configuration is scanned for inline passwords, API keys, tokens, and AWS access keys. In the UI, review function configs and move any secrets into Cribl’s secret store, then reference them with C.Secret.get().',
    description:
      'Hardcoded secrets in pipeline function configs (passwords, API keys, bearer tokens, AWS access keys) are a security risk: they are stored in plaintext config, are visible to anyone with config access, get committed to version control, and cannot be rotated centrally. Store credentials in Cribl’s secret store and reference them with C.Secret.get() so they are encrypted at rest and rotatable.',
    docsUrls: ['https://docs.cribl.io/stream/securing-data/'],
    evaluator: evalHardcodedSecrets,
  },
  {
    id: 'CSE-DEV-009',
    category: 'Develop',
    mode: 'auto',
    question: 'Are Persistent Queues configured to avoid dropping events on backpressure?',
    howTo:
      'Evaluated automatically: destinations with PQ enabled are checked for pqOnBackpressure = "drop". In the UI, open each destination’s Persistent Queue settings and review the "When queue is full" behavior.',
    description:
      'A destination can have Persistent Queue enabled yet still be configured to drop events once the queue fills (pqOnBackpressure = "drop"). This silently discards data during a sustained outage or backpressure event — the opposite of what PQ is usually for. Where data loss is unacceptable, set the behavior to "block" (apply upstream backpressure) or "error" so the source can retry. Complements CSE-DEV-001, which verifies PQ is enabled in the first place.',
    docsUrls: ['https://docs.cribl.io/stream/persistent-queues/'],
    evaluator: evalPqDropOnBackpressure,
  },
  {
    id: 'CSE-DEV-010',
    category: 'Develop',
    mode: 'auto',
    question: 'Is the configuration free of orphaned sources, destinations, and lookups?',
    howTo:
      'Evaluated automatically: flags enabled sources/destinations not referenced by any active route, and lookup files not referenced by any active pipeline function. Review under Data > Sources/Destinations, Routing > Routes, and Processing > Knowledge > Lookups.',
    description:
      'Orphaned resources are configuration debt and a source of confusion:\n\n' +
      '- A source enabled but not consumed by any route may be receiving data that goes nowhere, or signal a broken route change.\n' +
      '- A destination not targeted by any route is dead config (or a route was accidentally edited to remove it).\n' +
      '- A lookup file not referenced by any pipeline function is unused weight on the Workers.\n\n' +
      'Remove unreferenced resources, or wire them into the intended route/pipeline. (Sources are only evaluated when no catchall route exists, since a catchall consumes everything.)',
    evaluator: evalConfigHygiene,
  },
  {
    id: 'CSE-DEV-012',
    category: 'Develop',
    mode: 'auto',
    question: 'Are pipeline regex patterns free of catastrophic-backtracking risk?',
    howTo:
      'Evaluated automatically: regex extracted from Regex/Mask/Eval/Code/Parser functions and route filters is analyzed for patterns known to backtrack pathologically (nested quantifiers, overlapping alternation, excessive greedy wildcards). Review flagged patterns and test them with adversarial input.',
    description:
      'A regex with catastrophic backtracking can take exponential time on specific (often malicious or malformed) input, hanging the Worker process that evaluates it. Because event processing stalls, backpressure propagates upstream and events can be lost. Common culprits are nested quantifiers ((a+)+), overlapping alternation ((a|a)*), and multiple unanchored .* / .+ wildcards. Rewrite to eliminate nested/overlapping quantifiers, anchor patterns where possible, and prefer specific character classes over greedy wildcards. Cribl 4.6.0+ adds regex execution-time limits as an additional safeguard.',
    evaluator: evalDangerousRegex,
  },

  // ===== Search ===========================================================
  {
    id: 'CSE-SEARCH-001',
    category: 'Search',
    mode: 'auto',
    question: 'Do Search datasets have datatypes (event breaking & field extraction) configured?',
    howTo:
      'In Cribl Search, open Data > Datasets and confirm each federated dataset references a datatype (or carries its own event-breaker rulesets). Review datatypes under Data > Datatypes.',
    description:
      'A datatype is a set of rules that defines how Cribl Search turns raw input into structured events — recognizing the format, breaking events, parsing fields, extracting the timestamp (_time), and enriching data. Without a datatype (or inline event breakers), a federated dataset’s raw input is not split into events or parsed into queryable fields, so searches are slower and return unstructured results.\n\n' +
      'Best practice: start from Cribl’s stock datatypes, prefer v2 Datatypes where available (more efficient, works across all sources), and use Auto-Datatyping when ingesting into a lakehouse engine. Native/lakehouse and API datasets datatype automatically.',
    docsUrls: ['https://docs.cribl.io/search/datatypes/'],
    evaluator: evalSearchDatatypes,
  },
  {
    id: 'CSE-SEARCH-002',
    category: 'Search',
    mode: 'auto',
    question: 'Is partitioning configured for federated (object-store) Search datasets?',
    howTo:
      'For each S3, GCS, Azure Blob, or Amazon Security Lake dataset, open the dataset configuration and confirm a partitioning scheme and/or a path filter expression that narrows objects by time/prefix. Datasets that don’t constrain the objects scanned will read the whole bucket on every query.',
    description:
      'Federated datasets read directly from object storage. Partitioning (a partitioning scheme such as ddss/smart_store, or a path filter that maps object prefixes to time/fields) lets Search prune to only the objects a query needs. Without partitioning, every query lists and scans the entire bucket path, dramatically increasing query latency and object-store request/egress cost. Configure partitioning to match how data is laid out in the bucket, and use time-based partition tokens so time-bounded searches skip irrelevant objects.',
    docsUrls: ['https://docs.cribl.io/search/datasets/'],
    evaluator: evalSearchPartitioning,
  },
  {
    id: 'CSE-SEARCH-003',
    category: 'Search',
    mode: 'auto',
    question: 'Are Search datatypes using the v2 model (not the older v1)?',
    howTo:
      'Evaluated automatically: each Search datatype’s version is read from the API and flagged if it uses the older v1 model. In Cribl Search, open Data > Datatypes and confirm each shows Type = v2.',
    description:
      'Cribl is gradually replacing the older v1 Datatypes with the more efficient v2 Datatypes. v2 works across all Cribl Search Sources (including high-speed lakehouse engines) rather than federated providers only, supports Auto-Datatyping so data is parsed automatically, and covers modern formats (JSON Newline Delimited, JSON Array, Parquet, XML, Delimited Text, Key-Value, Raw Text). Prefer v2 for new datatypes and migrate existing v1 Datatypes to v2 where possible.',
    docsUrls: ['https://docs.cribl.io/search/datatypes/', 'https://docs.cribl.io/search/datatypes-v2'],
    evaluator: evalDatatypeVersion,
  },
  {
    id: 'CSE-SEARCH-004',
    category: 'Search',
    mode: 'auto',
    question: 'Is acceleration enabled on frequently searched (federated object-store) datasets?',
    howTo:
      'Evaluated automatically: each federated (S3, GCS, Azure Blob, Amazon Security Lake) dataset’s acceleration setting is read from the API. In Cribl Search, open Data > Datasets, edit a dataset, and enable Acceleration (Dataset Acceleration) for datasets you search often.',
    description:
      'Dataset Acceleration backfills and periodically refreshes a dataset’s statistics so Cribl Search can prune to the objects a query actually needs instead of listing and scanning the whole bucket on every run. On federated object-store datasets — which otherwise pay a full-bucket scan per query — enabling acceleration on the datasets you search frequently substantially cuts query latency and object-store request/egress cost.\n\n' +
      'Acceleration has a cost/benefit tradeoff (it consumes credits to maintain the statistics), so enable it on frequently searched datasets rather than blanket-enabling it. Native/lakehouse datasets are already fast and don’t expose this control. Complements CSE-SEARCH-002 (partitioning), which determines how effectively acceleration can prune.',
    docsUrls: ['https://docs.cribl.io/search/datasets/'],
    evaluator: evalSearchAcceleration,
  },
];

export const CATEGORIES = ['Deploy', 'Debug', 'Develop', 'Search'] as const;
