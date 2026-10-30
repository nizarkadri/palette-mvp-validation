# Phase 08 — Security, Capacity, Cost, and Operations Validation

- **Status:** Not started
- **Depends on:** Complete staging vertical slice from Phases 01–07
- **Unblocks:** production canary

## Goal

Replace launch assumptions with measured evidence, exercise security and recovery controls, and freeze production quotas/capacity only after representative workloads.

## Validation Profiles

Define and approve before testing:

- representative screenshot sizes and complexity;
- expected users/day and jobs/user/day;
- peak submission burst;
- acceptable queue wait and completion time;
- selected OpenRouter models and token prices;
- provider RPM/TPM limits;
- production daily budget and emergency stop threshold.

## Required Validation

### Security

- complete Chromium SSRF corpus in exact production image;
- upload MIME/size/dimension/pixel/decompression/overwrite attacks;
- auth/ownership enumeration and direct Cloud Run URL tests;
- IAM positive/negative tests for every deployed identity;
- secret scan of source, Vite dist, Terraform plans/state exposure, build logs, image layers, and runtime logs;
- path traversal, malformed/oversized JSON, replay/idempotency abuse;
- public signup abuse decision and invite workflow.

### Durability

- duplicate Cloud Tasks delivery;
- lost acknowledgement;
- API crash between Firestore acceptance and enqueue;
- worker crash before/after every paid stage and publication step;
- lease expiry and stale fence;
- cancellation and success race;
- task retry exhaustion and absolute deadline;
- unsupported N/N-1 schema versions;
- queue pause/resume and manual redrive.

### Capacity and Cost

- 100 authenticated control-plane clients;
- 100 concurrent idempotency/quota create attempts;
- representative job burst at worker max `3`, then controlled test at `5` if justified;
- p50/p95/p99 queue, execution, and total completion times;
- peak/steady memory, CPU, cold start, browser crash/OOM;
- provider calls, input/output tokens, retries, and estimated dollars by job kind;
- artifact size/storage/egress and Firestore polling operations;
- admission rejection when queue or reserved-cost ceiling is reached.

### Operations and Recovery

- every critical alert reaches primary/backup;
- `ACCEPT_NEW_JOBS=false` while GET/cancel/artifacts remain available;
- queue pause/resume;
- provider outage and rate-limit response;
- secret rotation;
- user purge and logical expiry;
- API/worker rollback with queued jobs;
- Firestore backup/PITR or accepted restore mechanism;
- regional outage runbook and stated RPO/RTO.

## Tests and Evidence Artifacts

Produce a versioned report containing:

- exact image digests/config/revisions;
- dataset/profile description without user-sensitive content;
- commands and timestamps;
- latency/memory/call/token/cost tables;
- failures and remediations;
- final approved quotas, max instances, queue dispatch, and deadlines;
- operator sign-off and unresolved residual risks.

Synthetic tests must avoid accidental OpenRouter spend; real-provider tests use a bounded dedicated account/key and explicit budget.

## Implementation Cautions

- “100 users” is not a load profile; document concurrency and job frequency.
- Do not raise worker max instances to improve a test before validating provider and budget limits.
- Budget alerts do not stop spend. Exercise provider limits, admission, queue pause, and kill switch.
- Cloud Tasks' 30-minute request deadline must contain measured p99 plus cleanup margin.
- Do not use production user screenshots in load/security fixtures.
- A successful happy-path E2E does not replace fault injection.
- Record failures; do not tune tests to hide them.

## Completion Gate

- Worker p99 fits inside 1500-second application deadline with margin.
- No SSRF/sandbox/IAM/auth/upload blocker remains.
- One canonical result holds through duplicate/crash tests.
- Approved quota/capacity/cost values replace hypotheses.
- Alerts and runbooks are exercised by named operators.
- Rollback/restore evidence meets accepted RPO/RTO.

## Rollback

This phase changes configuration only after evidence. If a gate fails, keep staging, disable new paid jobs, pause unsafe queue execution, and return to the relevant implementation phase. Do not waive a blocker through configuration alone.
