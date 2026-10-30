# Phase 09 — Canary Rollout and Legacy Retirement

- **Status:** Not started
- **Depends on:** Every Phase 08 launch gate
- **Unblocks:** general production availability

## Goal

Launch the durable production flow in reversible cohorts, prove rollback while jobs are queued, and remove the synchronous legacy API only after the recovery window.

## Pre-Launch Conditions

- production project/IAM/billing/hostname/Identity configuration complete;
- approved model/provider limits and spend controls active;
- privacy disclosure and deletion support published;
- staging and production images are the same tested digest with environment-specific config;
- N/N-1 API/worker/task/job/manifest compatibility confirmed;
- primary/backup operators available;
- all Phase 08 evidence signed.

## Rollout Sequence

1. Provision production data/IAM/queue resources additively.
2. Deploy private worker with queue paused/no traffic.
3. Deploy public web/API `/api/v1` without enabling new UI flow.
4. Run production-safe IAM, OIDC, static, health, upload, and bounded canary checks.
5. Enable internal staff cohort.
6. Hold through representative full jobs and alert windows.
7. Enable 10% invited cohort.
8. Hold and inspect queue age, errors, spend, cancellation, artifacts, and support reports.
9. Enable 50%, then 100%, repeating the same gates.
10. Keep the authenticated legacy adapter only for the defined rollback window.
11. Return JSON `410 legacy_endpoint_removed` from expensive legacy routes.
12. Remove Vite API middleware, legacy client transport, and compatibility adapters in a separate change after queue/recovery windows are clear.

## Go/No-Go Signals

Do not advance a cohort when any of these rise beyond approved thresholds:

- queue age or admission rejection;
- provider 429/5xx or call/token cost;
- job failure/timed-out/cancellation latency;
- worker OOM/browser crash/lease expiry;
- auth/ownership/SSRF/sensitive-data finding;
- artifact/Firestore/Storage errors;
- support incidents or unexplained usage.

## Tests

### Rollback before 100%

Before 100%:

- rollback public Cloud Run revision with active/queued jobs;
- pause queue, shift worker to prior N/N-1-compatible revision, run one canary, resume;
- restore previous web feature flag/revision;
- preserve polling/cancellation/artifact access during kill switch;
- reconcile pending dispatch after recovery;
- verify no manual Firestore edits are required.

### Legacy removal

- new client has no calls to `/api/analyze`, `/api/analyze-stream`, `/api/categorize`, `/api/improve-variant`, or `/api/custom-swatch/analyze`;
- legacy requests return stable JSON `410`, not SPA HTML;
- removing `server/plugin.js` production responsibility does not break local development strategy;
- raw request parser code removed only when no remaining caller uses it;
- debug filesystem paths are absent from response and production code paths;
- current palette/product regression suite remains green.

## Likely Files

- feature configuration in frontend/API;
- Terraform/Cloud Build promotion configuration;
- `server/plugin.js`;
- legacy `server/routes/*.js` adapters;
- `src/lib/aiAnalysis.js` legacy transport;
- README and runbooks;
- monitoring thresholds finalized from Phase 08.

## Implementation Cautions

- Do not combine cohort expansion and worker/schema migration in one change.
- Do not delete queues or Firestore data to roll back.
- Do not remove legacy compatibility until active old clients and rollback window are understood.
- Do not shift all traffic automatically on a timer; require evidence at each gate.
- Keep `ACCEPT_NEW_JOBS=false` independent from read/cancel/artifact availability.
- Unsupported schema versions fail safely and remain inspectable.

## Completion Gate

- 100% intended cohort uses the durable path with healthy SLO/cost/security signals.
- Rollback works while queued jobs exist.
- Legacy routes return 410, then are removed in an independent validated change.
- No production client depends on NDJSON/base64 synchronous transport.
- Final runbooks, dashboards, alerts, privacy, and support ownership are current.

## Post-Launch Follow-Up

Review actual usage after one week and one month before increasing quotas, worker instances, retention, or provider budgets. Add CDN/Cloud Armor/load balancer, SSE, Cloud Run Jobs, multi-region, or counter sharding only when measured requirements justify them.
