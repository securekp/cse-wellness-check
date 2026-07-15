# CSE Wellness Check

A Cribl Cloud app that runs a **Cribl Cloud health & wellness review** against a
worker group and produces a customer-ready deliverable. It digitizes the CSE
"Cribl Stream Wellness Review Checklist" (Deploy / Debug / Develop / Search),
evaluating as many checks as possible automatically against the live Cribl APIs
and guiding the reviewer through the rest.

Tailored for Cribl Cloud: on-prem-only items (non-root install, start-on-boot,
Leader HA, telemetry) and open-ended discussion questions with no technological
answer have been removed, and a Cribl Search section has been added.

## How it works

1. Pick a worker group.
2. The app loads the group's inputs, outputs, source/destination health,
   routes, pipelines, lookups, notifications, settings, and version, then runs
   every check.
3. Each check lands in one of: **Pass / Warn / Fail / Manual / N/A / Error**.
   - **Automated** checks derive a verdict from the APIs.
   - **Manual** checks (host access or customer judgement) show the exact
     "how to check" steps from the checklist and expose YES / NO / N/A toggles.
   - On-prem-only checks are auto-marked **N/A** for Cribl.Cloud groups.
4. Adjust the customer status, add notes, then **Export** the review as
   Markdown or CSV (matching the source spreadsheet's columns).

## The checks

The 26 checks span four categories:

- **Deploy** — sizing (400 GB/day per core x86; 480 GB/day per vCPU ARM),
  version match (Leader + Workers vs latest GA), Leader/workspace reachability,
  Workers reporting to the Leader (incl. stale-heartbeat & restart-churn
  signals), healthy Worker coverage per group, ≥5GB free disk per node, TLS,
  not running in the stock default group.
- **Debug** — alerting configured (Stream Notifications + Cribl Insights alert
  Monitors), destination health, source health, CPU/memory levels.
- **Develop** — Persistent Queues (incl. dPQ guidance), filter-early, catchall
  route, default destination overlap, lookup sizes, aggregation/suppress
  windows, routing & pipeline efficiency.
- **Search** — federated datasets have datatypes (event breaking & field
  extraction), object-store datasets have partitioning configured, and
  acceleration enabled on frequently searched datasets.

Check definitions live in [src/checks/catalog.ts](src/checks/catalog.ts);
auto-evaluators in [src/checks/evaluate.ts](src/checks/evaluate.ts).

## Structure

| File | Purpose |
|---|---|
| `src/types.ts` | Domain + Cribl API types |
| `src/api.ts` | Read-only Cribl API access (via the platform fetch proxy) |
| `src/checks/catalog.ts` | The 26 checks (verbatim checklist text) |
| `src/checks/evaluate.ts` | Automated evaluators |
| `src/checks/run.ts` | Runs a review against a group |
| `src/report.ts` | Markdown / CSV export |
| `src/components/` | Group selector, summary bar, checklist UI |
| `config/policies.yml` | Declared (read-only) product API paths |
| `config/proxies.yml` | `cdn.cribl.io` for the latest-version check |

All Cribl API access is read-only.

## Installation

1. Log in to Cribl and then click on **Apps->View All**
2. Click **Add App->Import from Git**.
3. Paste the repo url and "latest" for the release tag.
4. Click **Import**.

## Development

Clone this repo. Install dependencies and start the app.

```sh
npm install
npm run dev
```

Log into Cribl Cloud. Go to **App Platform > Development > Live Preview**.

Other scripts:

```sh
npm run build     # type-check + production build
npm run lint      # oxlint
npm run package   # build + create the installable app archive
```

See `AGENTS.md` for the Cribl App Platform developer guide (fetch proxy, KV
store, policies/proxies config, navigation).

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for the
full text.
