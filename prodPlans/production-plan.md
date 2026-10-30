# Production Plan

## Status and Authority

This document is the proposed canonical production plan for the Palette Explorer product.

It supersedes the production architecture in [`archive/cloud-run-api-migration-plan.md`](./archive/cloud-run-api-migration-plan.md). That older plan remains useful as a compatibility checklist for route behavior, static fallback behavior, environment handling, and tests, but its synchronous single-service deployment and its explicit deferral of authentication, durable jobs, Cloud Tasks, Firestore, and worker isolation are not suitable for the expected launch of roughly 100 users.

The owner approved the proposed defaults on 2026-07-21, so local implementation may proceed. Proposed numeric values remain launch hypotheses until validated by staging benchmarks, and concrete cloud identifiers, operator contacts, provider limits, hostname, and privacy/deletion details remain deployment inputs before their corresponding gates.

## Goal

Launch a reversible, all-Google-Cloud production system for approximately 100 initial users in which:

- Express 5 serves the built Vite application and short control-plane APIs from a public Cloud Run service;
- Identity Platform authenticates users;
- Cloud Storage receives direct, private uploads and stores immutable result artifacts;
- Firestore holds canonical job, lease, idempotency, quota, and result state;
- Cloud Tasks dispatches durable work to a private Cloud Run worker;
- the private worker runs Playwright/Chromium and calls OpenRouter;
- palette exploration remains local and makes no AI or backend calls;
- accepted work is recoverable across browser refreshes, disconnects, retries, and instance replacement;
- one canonical result is published even though exactly-once OpenRouter execution or billing cannot be promised.

## Fixed Decisions

1. Use Google Cloud rather than Firebase Hosting or a Firebase-managed deployment workflow.
2. Use Express 5 for the public web/control service and the private task worker HTTP boundary.
3. Serve the Vite `dist/` directory from the public Express service for the first 100-user launch.
4. Keep Chromium and the OpenRouter secret out of the public service.
5. Use Cloud Tasks, Firestore Native mode, Cloud Storage, Secret Manager, Identity Platform, Cloud Run, Artifact Registry, Cloud Build, Cloud Scheduler, Cloud Logging, and Cloud Monitoring.
6. Use a private worker with Cloud Run container concurrency `1`.
7. Keep MiniMax M3 through OpenRouter as the initial model profile unless the owner changes the provider/model decision.
8. Preserve the current three-variant product flow and stable output ordering.
9. Never expose raw model identifiers as a public client-controlled parameter.
10. Never describe the execution as exactly once. The system guarantees at most one canonical published result, not exactly-once external model calls or cost.

## Implementation Authorization

On 2026-07-21, the owner approved proceeding with the proposed defaults. They are now the implementation baseline and are recorded in [`adr/0001-production-architecture.md`](./adr/0001-production-architecture.md).

Local Phase 1 work is authorized. Concrete deployment inputs—GCP project IDs/billing linkage, final production hostname, Identity Platform authorized domains/invitation workflow, production OpenRouter prices/limits, operator contacts, and privacy/deletion support details—must be supplied before their corresponding staging or launch gates, but do not block local processor/build work.

## Owner Decisions and Deployment Inputs

| ID | Decision required | Proposed launch default | Why it blocks |
|---|---|---|---|
| PD-01 | GCP organization, billing account, staging project, production project, and deploy approvers | Separate staging and production projects | IAM, Terraform state, budgets, and deployment cannot be finalized without this. |
| PD-02 | Public hostname strategy | Use the Cloud Run URL for staging; choose either a custom-domain Cloud Run mapping or an external HTTPS load balancer/serverless NEG for production | Custom domain, TLS, Cloud Armor, and fixed baseline cost depend on this choice. |
| PD-03 | Region, data residency, RPO, and RTO | `us-central1`, single-region; proposed RPO 24h and RTO 8h | Firestore, Storage, Tasks, and Cloud Run should be colocated. Single-region failure must be consciously accepted. |
| PD-04 | Identity Platform providers and signup policy | Invite-only Google and email-link accounts for the first 100 users | Public signup materially increases multi-account and paid-API abuse risk. |
| PD-05 | OpenRouter model allowlist and provider governance | One server-owned default model profile, three variants | Token ceilings, provider RPM/TPM, data processing terms, job admission cost reservations, and provider-ledger ceilings depend on this. |
| PD-06 | Third-party data disclosure | Explicitly disclose that screenshots and generated content leave GCP for OpenRouter/model providers | The product is not wholly GCP-contained while OpenRouter processes user screenshots. |
| PD-07 | Data retention and deletion | Upload staging 1 day, validated input 2 days, artifacts 7 days, job metadata 30 days, idempotency 1 day | Privacy text, lifecycle rules, Firestore TTLs, backups, and purge procedures depend on this. |
| PD-08 | User and global quotas | Invite-only; 5 primary analyses/user/day, 20 follow-ups/user/day, 2 active jobs/user | Abuse prevention and cost admission must be explicit before launch. |
| PD-09 | Capacity and completion SLO | API acceptance p95 <2s; cancellation observation p95 <15s; worker p99 <25m; queue-wait target to be approved after benchmark | Cloud Tasks has a 30-minute HTTP task deadline and worker capacity must meet the user promise. |
| PD-10 | Infrastructure and delivery tooling | Terraform plus Cloud Build, manual production approval, immutable image digests | Required for reproducibility, IAM review, rollback, and operator ownership. |
| PD-11 | Operational ownership | Named primary and backup operator with billing, queue, worker, and security escalation paths | Alerts without an owner are not a production control. |
| PD-12 | Chromium sandbox exception policy | Non-root and sandbox enabled; `--no-sandbox` blocks launch unless explicitly accepted | Untrusted generated HTML is rendered inside the worker. |

## Current-State Findings and Gaps

1. **No production listener.** `vite.config.js`, `server/plugin.js`, and `package.json` expose backend routes through Vite development middleware. Express, a production `start` command, Docker images, and service entry points do not exist.
2. **The tracked Cloud Run plan is architecturally obsolete.** It explicitly excludes authentication, quotas, Cloud Tasks, Firestore jobs, polling, and a worker split.
3. **Paid work is synchronous and non-durable.** `server/routes/analyze-stream.js` runs all variants inside one browser request; `src/lib/aiAnalysis.js` treats NDJSON as the only progress/result channel.
4. **The frontend accepts truncated completion.** The stream client can return variants without requiring a `complete` event.
5. **OpenRouter work is only partially bounded.** `callOpenRouter()` now has a
   default 120-second request timeout and optional caller `AbortSignal`, and JSON
   repair accepts timeout/cancellation options. Routes and downstream stages do
   not yet propagate explicit `applicationDeadlineAt` and
   `absoluteJobDeadlineAt` values or their earlier effective deadline end to
   end, maintain a separate per-attempt provider ledger, classify retries
   consistently, or share a process-wide provider semaphore.
6. **Container concurrency does not bound internal concurrency.** The current stream route uses `Promise.allSettled` across variants, so worker concurrency `1` can still create several simultaneous OpenRouter and Chromium operations.
7. **Chromium can access untrusted resources.** `server/services/visualVerifier.js` renders with `networkidle` and no request interception. Improvement can render caller-provided HTML before a complete security boundary.
8. **Sensitive data is written to local disk.** `server/utils/debug.js` stores source images, generated HTML, screenshots, and model/debug material without production retention, cleanup, or privacy controls.
9. **Images and generated HTML are repeatedly transported as base64 JSON.** This increases API memory, duplication, localStorage pressure, and request-failure risk.
10. **Client-controlled model selection exists.** `server/routes/improve-variant.js` accepts `modelId` from the client.
11. **No production state model exists.** Current state/schema documents cover the palette UI, not ownership, uploads, job transitions, dispatch, leases, fencing, retries, cancellation, quotas, or artifact publication.
12. **Build authority is inconsistent.** `package.json` declares pnpm while `package-lock.json` and `pnpm-lock.yaml` disagree on Playwright and Vitest versions.
13. **Server tests are sparse.** Existing tests cover palette/ColorBrain logic and selected generation helpers but not authentication, uploads, idempotency, duplicate task delivery, cancellation, SSRF, IAM, containers, or deployed Cloud Tasks behavior.
14. **Planning documents are stale in places.** Some checklists say implementation has not started, while the progress log and repository show phases already implemented. The repository and passing tests are authoritative; stale documents must not drive production work.
15. **Existing export expectations conflict.** Older testing material refers to CSS/JSON export while later product decisions retain effective color/hex export. The later confirmed product behavior wins.

## Assumptions That Must Be Validated

- “100 users” means approximately 100 registered/active launch users, not 100 simultaneous 25-minute analysis jobs.
- A representative analysis can complete below a 25-minute application deadline after cold start, all three variants, correction/evaluation, artifact writes, and cleanup.
- OpenRouter permits the required call rate and token throughput for the chosen worker ceiling.
- Provider cancellation and retry behavior is measurable, but cancellation may not reverse billing.
- A three-worker launch can meet the approved queue-wait target; otherwise capacity must increase or admission must reject work before accepting an impossible SLA.
- Firestore singleton quota counters are sufficient for this scale; they must be load-tested before adding unnecessary sharding.
- Express static serving is sufficient for 100 users. A load balancer/CDN is optional until custom-domain, Cloud Armor, or traffic requirements justify it.
- The chosen Playwright image can launch Chromium non-root with sandbox enabled on Cloud Run.
- Identity Platform client/Admin SDKs may retain Firebase package names for compatibility, but the deployed architecture and billing remain Google Cloud services; this is not Firebase Hosting or a Firebase production plan dependency.

## Target Architecture

```text
Browser
  -> Public Cloud Run service: palette-web-api
       -> Express 5 serves Vite dist/
       -> Express 5 handles /api/v1/**
       -> verifies Identity Platform ID tokens
       -> Firestore: uploads, jobs, idempotency, quotas, leases, results
       -> Cloud Storage: signed upload/read operations
       -> Cloud Tasks: deterministic job dispatch

Cloud Tasks queue: palette-jobs
  -> OIDC-authenticated request
  -> Private Cloud Run service: palette-worker
       -> Firestore lease/fence/checkpoints
       -> validated, generation-pinned Cloud Storage inputs
       -> Playwright/Chromium with document network denied
       -> OpenRouter using worker-only Secret Manager injection
       -> immutable attempt artifacts and canonical manifest

Cloud Scheduler
  -> OIDC-authenticated reconciliation endpoint

Artifact Registry + Cloud Build + Terraform
  -> reproducible images, infrastructure, promotion, and rollback

Cloud Logging + Monitoring + Billing
  -> redacted telemetry, alerts, quotas, kill switch, and runbooks
```

### Public web/control service responsibilities

- Serve hashed Vite assets with `Cache-Control: public, max-age=31536000, immutable`.
- Serve `index.html` with `Cache-Control: no-cache`.
- Register exact `/api/**` routes before static serving and SPA fallback.
- Return JSON `404` for unknown `/api/**` paths; never return SPA HTML for an API miss.
- Authenticate users and enforce ownership, validation, quotas, idempotency, and admission.
- Authorize uploads and artifact downloads without proxying image bytes.
- Create and reconcile deterministic Cloud Tasks.
- Never contain Playwright/Chromium or the OpenRouter secret.

### Private worker responsibilities

- Accept only Cloud Tasks OIDC-authenticated requests.
- Reload authoritative job data from Firestore; trust no task body beyond version/job identity.
- Acquire a transactionally fenced lease before expensive work.
- Enforce cancellation, deadlines, call/token/cost budgets, and bounded internal concurrency.
- Read only validated, generation-pinned inputs.
- Publish one canonical immutable artifact manifest after all validation succeeds.
- Never serve browser traffic or accept public invocation.

### Data boundaries

- Browser access to Firestore is not required and should be denied.
- Cloud Storage public access prevention and uniform bucket-level access are mandatory.
- Browser upload/download access uses narrowly scoped, short-lived signed operations.
- Cloud Run local disk is temporary only and is deleted in `finally`.
- Firestore stores bounded metadata and pointers, not images, HTML, prompts, signed URLs, tokens, or raw provider responses.
- OpenRouter is the only approved runtime processor outside GCP. Rendered HTML is allowed no network access.

## Public API Contract

Base path: `/api/v1`.

All user-facing `/api/v1/**` endpoints except health/readiness require an Identity Platform bearer token. The internal reconciliation route uses a separate GCP service-account OIDC verifier with an exact audience and allowlisted scheduler service-account email; an Identity Platform token is not accepted there. Mutations require `Content-Type: application/json` and use `Cache-Control: no-store`. Every response includes `X-Request-Id`. Ownership violations return a safe `404` to avoid enumeration.

Express JSON parsing is router-scoped: mount `express.json({ limit: "64kb", type: "application/json" })` only on the new `/api/v1` control router and the bounded `/internal` router. Legacy `/api/analyze*` compatibility handlers remain outside those routers and keep ownership of their raw request streams until retirement. Static serving and SPA fallback are registered only after all API and legacy routes.

Standard error:

```json
{
  "error": {
    "code": "machine_readable_code",
    "message": "safe user-facing message",
    "retryable": false,
    "requestId": "req_...",
    "details": {}
  }
}
```

Status policy:

- `400`: schema validation;
- `401`: missing/invalid identity;
- `403`: account/policy denial;
- `404`: missing or wrong-owner resource;
- `409`: idempotency, generation, or state conflict;
- `410`: logically expired artifact;
- `413`: size limit;
- `415`: unsupported media type;
- `429`: user/global quota or admission capacity, with `Retry-After`;
- `503`: kill switch or failure before durable acceptance;
- `500`: unexpected failure only.

Never expose stack traces, object paths, prompts, HTML, model responses, tokens, signed URLs, or secrets.

### Endpoints

```text
POST /api/v1/uploads
POST /api/v1/uploads/:uploadId/complete
POST /api/v1/jobs
GET  /api/v1/jobs/:jobId
POST /api/v1/jobs/:jobId/cancel
GET  /api/v1/jobs/:jobId/artifacts/:logicalName
POST /api/v1/colorbrain/anchors
GET  /healthz
GET  /readyz
```

### Upload authorization

`POST /api/v1/uploads` accepts filename metadata, declared content type, declared byte size, and optional SHA-256. It returns a ten-minute V4 signed POST policy fixed to a server-owned staging object path and constrained by content type and `content-length-range`.

Launch limits:

- PNG, JPEG, or WebP only;
- maximum 10 MiB;
- maximum width/height 4096;
- maximum 16 megapixels;
- maximum three outstanding uploads/user;
- no SVG or animated formats at launch.

`POST /api/v1/uploads/:uploadId/complete`:

1. observes the exact staging generation;
2. copies it to a create-only validated path using source-generation and destination-generation preconditions;
3. validates magic bytes, decoded type, size, dimensions, pixel count, and SHA-256 with bounded `sharp` settings, while recording the generation and Cloud Storage-provided integrity metadata;
4. records the immutable validated generation;
5. invalidates and deletes/quarantines failures.

The worker reads only the validated generation. This closes the overwrite/time-of-check-to-time-of-use gap.

### Job creation

`POST /api/v1/jobs` requires `Idempotency-Key: <UUID>`.

Supported kinds:

- `analysis` references a ready `uploadId` and produces exactly three variants;
- `categorization` references an owned source job and variant;
- `improvement` references an owned source job and variant plus a server-owned model profile enum;
- `custom-swatch-analysis` references an owned source job/variant and bounded swatch/palette/element options.

Arbitrary HTML, base64, bucket paths, URLs, and raw model IDs are rejected.
The API resolves an allowed model-profile enum to an immutable server-owned
profile/revision before dispatch.

The analysis processor produces exactly three stable indexed outcomes. A job or
legacy stream succeeds only when all three are complete; partial outcomes may
remain attempt evidence but never become a canonical successful result. A
stream ending without terminal `complete`, or with missing, duplicate, failed,
or malformed variant indexes, is not success. Cancellation, deadline, budget,
lease/fence, and shutdown errors remain control flow and are never converted
into a partial successful result.

In one Firestore transaction, the API:

1. validates ownership and source lineage;
2. creates/replays the idempotency record;
3. claims the upload where applicable;
4. verifies user/global quota and admission capacity;
5. creates the job admission reservation for active-job and worst-case cost
   capacity;
6. creates the canonical queued job with `dispatch.status=pending`.

After commit, create deterministic task `job-<jobId>-d1`. `ALREADY_EXISTS` is success. If enqueue fails after Firestore commit, the accepted job remains durable and reconciliation repairs dispatch. Only failure before durable acceptance returns `503`.

Return `202` and `Location: /api/v1/jobs/:jobId`.

### Polling and artifacts

`GET /api/v1/jobs/:jobId` returns the bounded owner-visible projection and `ETag: <stateVersion>`. The client uses `If-None-Match`, polls initially at 2 seconds, backs off to 10 seconds, pauses while hidden/offline, resumes after refresh, and stops at a terminal state.

Success returns variant summaries and logical artifact names, never inline screenshots/HTML. Variants are sorted by stable index with deterministic tie-breaking.

`GET /api/v1/jobs/:jobId/artifacts/:logicalName` verifies ownership, logical expiry, and exact manifest membership, generation, checksum, type, and size. It returns a short-lived generation-pinned signed read URL. Slashes, `..`, bucket names, and arbitrary object paths are rejected.

### Cancellation

`POST /api/v1/jobs/:jobId/cancel` is idempotent.

- `queued -> cancelled`: release the job admission active/cost reservation once
  and best-effort delete the task.
- `running -> cancel_requested`: worker polling/stage checks abort work.
- already `cancel_requested`: return `202`.
- already `cancelled`: return `200`.
- `succeeded|failed|timed_out`: return `409 job_terminal`.

The success transaction requires the current fence, state `running`, no
cancellation, and positive time remaining before both `applicationDeadlineAt`
and `absoluteJobDeadlineAt`. Cancellation cannot guarantee reversal of already
accepted provider billing.

### ColorBrain and health

- Preserve `POST /api/v1/colorbrain/anchors` as short authenticated work with strict schemas, a short timeout, normalized output, safe provider handling, and per-user limits.
- Remove or replace plain-HTTP external sources before production.
- `/healthz` performs no dependency calls.
- `/readyz` verifies startup configuration only; it must not call OpenRouter, Chromium, Firestore, or Storage on each request.

## Internal Worker Contract

Cloud Tasks calls:

```text
POST /internal/tasks/jobs/:jobId/run
```

Body:

```json
{ "schemaVersion": 1, "jobId": "job_...", "dispatchGeneration": 1 }
```

Authentication:

- worker allows no unauthenticated invocation;
- dedicated task-invoker service account has `roles/run.invoker` only on the worker;
- Cloud Tasks attaches an OIDC token with exact worker URL audience;
- worker validates configured queue/project/location/task headers as defense in depth;
- Firestore remains authoritative for kind, options, input, processor revision, prompt revision, and model profile.

Response behavior:

- `204`: already terminal, success, cancellation, stale delivery, or permanently failed job recorded;
- `503`: retryable attempt failure or active valid lease;
- `500`: unexpected retryable failure after best-effort recording;
- malformed/unsupported valid task data is recorded as permanent and acknowledged to avoid retry storms.

Cloud Scheduler invokes `POST /internal/reconcile` on the public web/API service with a Google-issued service-account OIDC token. Route-specific middleware verifies the token signature, issuer, exact configured audience, and scheduler service-account email using `google-auth-library`; it does not run the Identity Platform verifier used by browser routes. The handler is bounded and can:

- enqueue `dispatch.pending` jobs;
- expire jobs beyond deadline when no valid publisher can win;
- finalize cancellation after lease expiry;
- release leaked job admission reservations;
- expire abandoned uploads;
- emit metrics.

Operator redrive increments `dispatchGeneration` and creates a new deterministic task only after verifying the prior task is absent/exhausted and the job remains nonterminal.

## Firestore Data Model

### `uploads/{uploadId}`

Contains ownership, state (`authorized|validating|ready|claimed|invalid|expired`), declared metadata, staging generation, validated generation/checksums/type/size/dimensions, upload quota reservation, timestamps, expiry, and safe error.

### `jobs/{jobId}`

Contains:

- schema, processor, prompt, and model-profile revisions;
- owner and kind;
- state and monotonic `stateVersion`;
- bounded progress;
- validated input references and option hash;
- dispatch generation/task/status;
- attempt count, current attempt, fence token, lease expiry, heartbeat;
- cancellation timestamps;
- canonical result manifest pointer/checksum and bounded public summary;
- safe error;
- exact user/global admission/cost reservation references;
- created, updated, `applicationDeadlineAt`, `absoluteJobDeadlineAt`, completed,
  artifact-expiry, and metadata-expiry timestamps.

No image, HTML, prompt, signed URL, auth token, provider response, or secret is stored in Firestore.

### Supporting collections

- `jobs/{jobId}/attempts/{attemptId}`: attempt, fence, task, timing, explicit
  deadline values, stage, per-attempt provider ledger/usage summary, safe
  outcome, and temporary cleanup result.
- `jobs/{jobId}/checkpoints/{provenanceHash_stageKey}`: immutable, completed, checksum-verified stages only.
- `idempotency/{uidHash_keyHash}`: hashed key, request hash, job ID, expiry.
- `quotaUsers/{uid}`: active jobs, reserved cost, outstanding uploads, reserved bytes.
- `quotaUsers/{uid}/days/{yyyyMMdd}`: immutable daily consumed counts.
- `quotaGlobal/current`: active jobs, reserved cost, admission kill switch.
- `quotaGlobal/days/{yyyyMMdd}`: daily global usage.

Use Firestore server timestamps. Store exact admission-reservation references on
every job so terminal release does not depend on the current UTC day. Required
indexes cover pending dispatch, state/absolute-job-deadline, and state/lease
expiry.

## State Machine

```text
none -> queued
queued -> running | cancelled | timed_out
running -> queued | cancel_requested | succeeded | failed | timed_out
cancel_requested -> cancelled
terminal: succeeded | failed | cancelled | timed_out
```

Rules:

- every externally visible change increments `stateVersion`;
- all transitions are Firestore transactions with expected prior state and fence;
- terminal states are immutable;
- job admission active/cost reservations release exactly once and remain
  separate from per-attempt provider ledgers;
- cancellation and success race through mutually exclusive transitions;
- stale workers cannot checkpoint or publish.

## Idempotency, Lease, Retry, Checkpoint, and Deadline Rules

1. Cloud Tasks and external AI calls may repeat. Publish at most one canonical manifest.
2. Task names are deterministic: `job-<jobId>-d<dispatchGeneration>`.
3. Lease acquisition transaction increments integer `fenceToken`, creates `attemptId`, and sets a 90-second lease using server time.
4. Heartbeat every 30 seconds. Failed renewal, fence mismatch, cancellation, or
   expiry of the earlier `applicationDeadlineAt`/`absoluteJobDeadlineAt` aborts
   the local controller immediately.
5. Check fence ownership before and after every paid/external stage.
6. Attempt artifacts use create-only, attempt-specific paths with generation preconditions.
7. Canonical publication writes an immutable manifest first, then
   transactionally stores its pointer if state/fence/cancellation and both
   explicit deadline fields still permit publication.
8. Reuse checkpoints only when input generation/checksum, source manifest, options hash, processor, prompt, model, stage version, and dependency checksums exactly match.
9. Never checkpoint a partial provider response or unvalidated HTML.
10. Retry only transient `408`, `429`, and `5xx` failures. Do not retry auth, schema, safety, unsupported-version, or other permanent failures.
11. Allow at most one bounded in-attempt transport retry and at most three Cloud Tasks attempts.
12. Job admission reserves user/global active and worst-case cost capacity; it
    is not the processor/provider ledger.
13. Before every provider request, the per-attempt ledger reserves one call and
    worst-case token/cost exposure. Trusted usage reconciles afterward; missing
    usage or possible provider receipt retains the conservative reservation.
14. Count every tool turn, repair, regeneration, evaluation, correction, and
    transport retry as its own provider-ledger entry.
15. Provider timeouts and provider/render semaphore waits use the positive
    remaining time before the earlier explicit deadline.
16. On SIGTERM, stop accepting tasks, abort active work, close page/context/
    browser, best-effort record retryable state, and exit within Cloud Run's
    10-second shutdown grace.
17. A lost provider response before durable checkpoint may be billed again. This
    is a documented residual risk and retains its conservative ledger exposure.

## Upload and Artifact Policy

- Separate private input and artifact buckets.
- Public access prevention and uniform bucket-level access are mandatory.
- Staging lifecycle: proposed 1 day.
- Validated input lifecycle: proposed 2 days.
- Artifact lifecycle: proposed 7 days.
- Production debug payload capture is off.
- Attempt artifacts are inaccessible unless referenced by the canonical manifest.
- Logical expiry is enforced by the API before asynchronous object deletion.
- Object versioning is off; generation-pinned create-only writes provide immutability without retained overwrite versions.
- Launch limits: source 10 MiB/4096x4096/16 MP; HTML 500 KiB; element/evaluation JSON 250 KiB; manifest 64 KiB; rendered PNG 5 MiB.
- A user purge procedure disables new work, cancels/waits, deletes bucket prefixes and Firestore records, and records only a non-sensitive audit result.

## Chromium and Generated-HTML Security

Before every render, including improvement input:

- sanitize HTML and CSS using explicit allowlists;
- remove scripts, frames, objects, embeds, links, base/meta redirects, forms/actions, event attributes, `srcdoc`, unsafe protocols, and external SVG references;
- parse CSS and remove `@import`, external `url()`, `image-set`, fonts, cursors, masks/filters, and encoded equivalents;
- create a fresh browser context and temporary directory;
- disable JavaScript, service workers, downloads, permissions, and persistent profiles;
- install request routing before content and abort all network requests except validated inline `data:`/required `blob:` resources;
- inject restrictive CSP as a second layer;
- replace `networkidle` with deterministic DOM/font readiness and a bounded delay;
- run one active render/page at a time;
- run pinned Chromium non-root with sandbox enabled;
- clean page, context, temporary files, and browser failures in `finally`.

The security corpus must cover HTTP(S), redirect chains, DNS rebinding assumptions, loopback, RFC1918, IPv6 local, `169.254.169.254`, `metadata.google.internal`, file, FTP, WebSocket, CSS, SVG, image, data, blob, and filesystem vectors with zero forbidden document requests.

Chromium still shares the worker network namespace and service identity with Node. Application request interception is not a hard process network boundary; worker IAM must therefore be minimal and any sandbox exception is launch blocking unless accepted.

## Authentication, IAM, Abuse, and Cost Controls

### Identity Platform

- Proposed first-100-user policy: invite-only Google and email-link accounts.
- Verify issuer/project/audience, expiry, revoked tokens, and disabled/deleted users.
- Do not store tokens in localStorage.
- Identity is not authorization: every upload, job, artifact, and cancellation checks ownership.
- If public signup is approved, add reCAPTCHA Enterprise/account-creation controls and explicitly accept multi-account abuse risk.

### IAM matrix

| Principal | Required access | Must not have |
|---|---|---|
| Browser | Public web service, Identity Platform public config, scoped signed Storage operations | Direct Firestore access, bucket listing, tasks, service-account keys, secrets |
| Public API runtime SA | Firestore job access, queue-scoped task enqueue, upload metadata/copy/delete, artifact metadata/read signing, task-invoker `actAs` only | OpenRouter secret, Chromium, arbitrary service invocation |
| Worker runtime SA | Firestore job access, validated input read, artifact create/read/delete, OpenRouter secret access | Task creation, public upload signing, public invocation |
| Task-invoker SA | `roles/run.invoker` on worker only | Data, task, storage, and secret permissions |
| Scheduler-invoker SA | `roles/run.invoker` on public service and accepted only by reconciliation route | General user/job mutation |
| Build/deployer SAs | Narrow build/push/deploy/Terraform permissions and scoped `actAs` | Runtime secret reads, broad Editor roles |

Test positive and negative permissions using deployed identities rather than reviewing Terraform alone.

### Proposed launch quotas

- 5 primary analyses/user/UTC day;
- 20 follow-ups/user/UTC day;
- 2 active nonterminal jobs/user across midnight;
- 10 upload authorizations/user/day;
- 100 MiB reserved upload bytes/user/day;
- 3 outstanding uploads/user;
- 500 primary analyses/global/day;
- 2,000 follow-ups/global/day;
- 50 accepted nonterminal jobs globally;
- global job-admission reserved-cost ceiling based on approved model prices and
  worst-case calls.

Daily consumed counts are not refunded because paid work may already have
occurred. Job-level admission active/cost reservations release exactly once at
terminal state. They are capacity controls, not provider usage accounting.
Each attempt maintains a separate provider ledger: reserve one call and worst-
case token/cost exposure before provider dispatch; reconcile only trusted usage;
retain the conservative reservation when usage is missing or the request may
have reached the provider.

`ACCEPT_NEW_JOBS=false` rejects new paid work while preserving authentication, polling, cancellation, artifacts, and reconciliation. Queue pause stops execution. Billing alerts do not cap spend; use provider spend limits when available.

## Configuration Hypotheses and Gates

| Setting | Proposed value | Gate |
|---|---:|---|
| Region | `us-central1` | PD-03 |
| API CPU/memory/concurrency | 1 CPU / 512 MiB / 40 | Control-plane load test |
| API min/max instances | 0 / 10 | Cold-start and cost review |
| Worker CPU/memory/concurrency | 2 CPU / 4 GiB / 1 | Real Playwright memory test |
| Worker min/max instances | 0 / 3 initially | Gate to 5/10 after cost/RPM/SLO evidence |
| Queue max dispatches/rate | 3 concurrent / 1 per second | Match worker ceiling |
| Lease/heartbeat | 90s / 30s | Event-loop delay and crash tests |
| Cancellation polling | 5s | p95 observation <=15s |
| OpenRouter call timeout | 120s | Real provider test |
| Application attempt deadline | 1500s | Representative p99 below deadline |
| Cloud Run worker timeout | 1650s | Cleanup/shutdown margin |
| Cloud Tasks dispatch deadline | 1800s | Platform maximum and boundary test |
| Absolute job deadline | proposed 120m including queue wait | PD-09 and saturation test |
| Cloud Tasks attempts | 3 | Duplicate/retry/failure tests |
| Upload JSON control limit | 64 KiB | Parser contract tests |
| Artifact retention | 7 days | PD-07 |
| Model prices/call/token ceilings | no fallback | Production startup fails until configured |

Admission must reject new jobs before accepting work that cannot meet the
approved queue deadline or global job-admission reserved-cost ceiling. Worker
attempts still
require their own provider-ledger reservations before each provider request.

## Observability and Runbooks

Structured logs include service/revision, request/trace ID, job ID, HMAC-hashed user ID, task/attempt/fence, stage, state transition, duration, queue age, safe error code, model profile/revision, provider status/latency/usage counts, browser outcome, and cancellation/timeout reason.

Never log request bodies, screenshots, HTML, prompts, provider response content, identity tokens, idempotency keys, signed URLs, object paths, or secrets.

Dashboards:

- API traffic, latency, 4xx/5xx, auth/quota/admission;
- pending dispatch age, queue depth, oldest task, retries;
- job queue/run/total duration and terminal states;
- lease expiry and reconciler actions;
- worker instances, CPU, memory, cold start, OOM, Chromium failures;
- OpenRouter status, latency, calls, tokens, and estimated cost;
- cancellation latency;
- Storage/Firestore errors and cleanup lag.

Blocking alerts:

- API 5xx >2% for 5 minutes;
- dispatch pending >5 minutes;
- oldest task beyond approved queue threshold;
- worker terminal failure >10% for 10 minutes;
- expired lease/stuck job;
- sustained max-instance saturation;
- provider 429/5xx >10% for 10 minutes;
- daily usage/job-admission reserved cost at 50%, 80%, and 100%;
- authenticated synthetic upload/job/polling failure.

Required runbooks:

- provider outage;
- queue pause/resume;
- pending dispatch reconciliation and manual redrive;
- stuck/expired lease;
- spend kill switch and quota override;
- secret rotation;
- API and worker rollback;
- user purge and artifact expiry;
- Chromium crash loop;
- IAM/security incident;
- regional outage and restore;
- billing alarm.

Each runbook identifies primary/backup owner, trigger, safe commands, verification, escalation, and recovery.

## Infrastructure and CI/CD

Use separate staging and production GCP projects.

Terraform provisions:

- enabled APIs;
- Artifact Registry;
- Firestore database, indexes, TTLs, and approved backup/PITR choice;
- private Storage buckets, lifecycle, CORS, and public access prevention;
- least-privilege service accounts and IAM;
- Cloud Tasks queue and retry/deadline settings;
- public web/API and private worker Cloud Run services;
- Secret Manager resources/references, not secret values;
- Cloud Scheduler reconciliation;
- dashboards, alert policies, and billing budgets;
- optional external HTTPS load balancer/serverless NEG only if PD-02 selects it.

Cloud Build:

1. `pnpm install --frozen-lockfile`;
2. lint/static/schema checks added during implementation;
3. unit, emulator, integration, security, and build tests;
4. separate web/API and worker image builds;
5. secret, dependency, and IaC checks; GCP container vulnerability scanning
   remains disabled under the documented owner risk acceptance;
6. SBOM/provenance and immutable image-digest recording;
7. deploy exact image digest to staging;
8. run deployed IAM, OIDC, Chromium, static routing, and real-provider E2E;
9. manual approval promotes the same digest/config-compatible revision to production.

Terraform state uses private versioned GCS backends per environment. Secret values stay out of Terraform state, `.tfvars`, plans, build arguments, layers, and logs.

Deployment order is additive: indexes/storage/IAM/queue, N/N-1-compatible worker, public web/API, then cohort enablement. Current and previous worker revisions must read current and previous task/job/manifest schema versions during rollback.

## Implementation Phases

The detailed phase documents under [`phases/`](./phases/) are the implementation trackers and contain codebase-specific goals, tests, cautions, completion gates, and rollback behavior:

1. [`00-foundation-decisions-contracts.md`](./phases/00-foundation-decisions-contracts.md)
2. [`01-runtime-and-processor-foundation.md`](./phases/01-runtime-and-processor-foundation.md)
3. [`02-chromium-security.md`](./phases/02-chromium-security.md)
4. [`03-domain-and-repositories.md`](./phases/03-domain-and-repositories.md)
5. [`04-web-api-service.md`](./phases/04-web-api-service.md)
6. [`05-private-worker.md`](./phases/05-private-worker.md)
7. [`06-staging-infrastructure.md`](./phases/06-staging-infrastructure.md)
8. [`07-frontend-migration.md`](./phases/07-frontend-migration.md)
9. [`08-production-validation.md`](./phases/08-production-validation.md)
10. [`09-rollout-and-retirement.md`](./phases/09-rollout-and-retirement.md)

The summaries below remain architectural context; phase files are authoritative for implementation progress.

### Phase 0 — Resolve decisions and freeze contracts

Likely files:

- this document;
- `adr/0001-production-architecture.md`;
- `contracts/api-v1.md`, `contracts/jobs-v1.md`, `contracts/artifacts-v1.md`;
- existing migration plan marked superseded;
- `README.md`.

Work:

- approve PD-01 through PD-12;
- freeze API, state, manifest, task, error, retention, quota, and cost contracts;
- document external OpenRouter processing;
- capture representative existing output fixtures;
- reconcile stale/conflicting planning documents.

Gate: no unresolved launch-blocking owner decision and no competing authoritative architecture.

### Phase 1 — Make the build reproducible and extract processors

Likely files:

- `package.json`, `pnpm-lock.yaml`, removal of `package-lock.json`, `.env.example`;
- `server/routes/*.js`;
- `server/services/openRouter.js`, `screenshotGenerator.js`, `visualVerifier.js`, `categorization.js`, `browserPool.js`;
- `server/utils/html.js`, `debug.js`;
- new `server/shared/**`, `server/pipeline/**`.

Work:

- pin Node and exact Playwright/browser image;
- characterize legacy route, NDJSON, partial/total failure, truncation, fallback,
  model-selection, debug, and out-of-order behavior before extraction;
- intentionally require exactly three complete stable indexed variants and a
  terminal `complete` event for legacy/client and production success;
- extract HTTP-independent processors with injected provider/browser/logger,
  `AbortSignal`, `applicationDeadlineAt`, `absoluteJobDeadlineAt`, their earlier
  effective deadline, a per-attempt provider ledger, transport-neutral progress/
  events, and distinct diagnostics, artifact, and checkpoint ports;
- preserve temporary legacy adapters for equivalence tests outside the approved
  terminal-success correction;
- add server-owned immutable model profiles, provider timeout/retry
  classification, usage capture, and shared abort-aware process-wide provider
  and render semaphores;
- keep admission reservation separate; reserve one call plus worst-case token/
  cost exposure in the attempt ledger before every provider request, reconcile
  only trusted usage, count all tool/repair/regeneration/evaluation/correction/
  retry calls, and never let cleanup mask a primary error;
- extract ColorBrain provider adapters with explicit HTTPS-only URLs, schemas, timeouts, response-size limits, and safe fallbacks; remove or replace the plain-HTTP Colormind path before production;
- make production debug metadata-only.

Gate: clean frozen install, existing tests/build, pre-extraction
characterization, all-three terminal semantics, causal per-variant events with
aggregated monotonic progress, create-only persistence ports, explicit effective
deadline handling, separate conservative provider ledgers, server-owned model
profiles, bounded process-wide provider/render work, and unswallowed control-
flow errors.

### Phase 2 — Harden generated HTML and Chromium

Work:

- sanitize every render input;
- add CSS allowlist parser;
- deny document network;
- disable JavaScript/service workers/downloads/permissions;
- fresh context/temp state per render;
- deterministic render readiness;
- non-root sandboxed worker image proof;
- SSRF and resource-exhaustion corpus.

Gate: zero forbidden browser requests, no `--no-sandbox`, bounded memory, and complete cleanup.

### Phase 3 — Implement domain state and cloud repositories

Likely files:

- new `server/config.js`, `server/logger.js`;
- new `server/domain/{schemas,jobState,quotas,idempotency,artifacts}.js`;
- new `server/repositories/{firestore,storage,tasks}.js`;
- `firestore.indexes.json` or Terraform equivalents.

Work:

- state transition transactions;
- cross-midnight quotas and exact job admission reservation release;
- generation-pinned upload finalization;
- immutable manifests/checkpoints;
- deterministic task naming and reconciliation seams;
- redacted logs and typed configuration.

Gate: emulator/fault tests cover concurrent creates, midnight, retries, generation races, illegal transitions, and manifest limits.

### Phase 4 — Build the public Express web/control service

Likely files:

- new `server/api/app.js`, `index.js`;
- new routes for health, uploads, jobs, artifacts, ColorBrain, reconciliation;
- new middleware for identity, errors, request context, validation;
- Vite build/static integration;
- `package.json` scripts.

Work:

- Express 5 exact routes and static/SPA behavior;
- Identity Platform verification and ownership;
- uploads/finalization;
- idempotent durable job creation;
- task enqueue/reconciliation;
- polling/ETag, artifacts, cancellation;
- health/readiness, JSON API 404, security headers, graceful shutdown.

Gate: API integration tests cover every status/header/error, Identity Platform and scheduler-OIDC positive/negative cases, auth/owner negatives, router-scoped parser behavior, legacy raw-stream compatibility, task crash window, path traversal, CORS, static caching/fallback, and SIGTERM. Public image contains no Playwright or OpenRouter secret. ColorBrain uses only approved HTTPS providers with bounded adapters.

Between Phase 4 and Phase 7, deployed staging is intentionally API-contract-only for the new production flow. Do not expose the current analysis UI as if it were production-ready. Either disable its analysis entry point or mount legacy adapters only in a separately protected compatibility profile. Full browser E2E against `/api/v1` begins in Phase 7.

### Phase 5 — Build the private durable worker

Likely files:

- new `server/worker/app.js`, `index.js`, `runner.js`, `lease.js`, `cancellation.js`, `artifacts.js`;
- new processors for analysis, categorization, improvement, custom swatch;
- shared pipeline/domain/repositories.

Work:

- OIDC-only task handling;
- lease/fence/heartbeat;
- attempt-specific immutable artifacts;
- checkpoint provenance;
- retry/deadline/call-budget enforcement;
- cancellation monitor;
- canonical manifest transaction;
- SIGTERM cleanup.

Gate: duplicate delivery, lost acknowledgement, expired lease, crash after each paid stage, stale publication, retry exhaustion, cancellation race, deadline, and SIGTERM expose at most one canonical result and bounded configured work.

### Phase 6 — Provision staging infrastructure

Likely files:

- new `infra/terraform/**`;
- new `Dockerfile`, `.dockerignore`, `cloudbuild.yaml`;
- new environment examples and deployment scripts.

Work:

- create staging resources, IAM, queue, buckets, Firestore, services, scheduler, monitoring, and budgets;
- build slim public image and exact Playwright worker image;
- verify private invocation and negative permissions;
- decide/implement hostname strategy.

Gate: Terraform validation/policy review, deployed-principal IAM tests, private-worker denial, Chromium smoke, and service-to-service OIDC pass.

### Phase 7 — Migrate the React client

Likely files:

- `src/main.jsx`, `src/App.jsx`, `src/lib/aiAnalysis.js`;
- `src/components/UploadZone.jsx`, `VariantPicker.jsx`;
- new `src/lib/identity.js`, `jobsApi.js`, `jobPolling.js`;
- new auth/progress/error components;
- `vite.config.js` local proxy behavior.

Work:

- Identity Platform sign-in/token refresh;
- direct upload/finalization;
- idempotent job create;
- ETag polling/resume/cancel;
- artifact retrieval and follow-up references;
- preserve three variants and existing palette semantics;
- remove screenshot/HTML/signed URL/token persistence from localStorage.

Gate: frontend tests cover auth, upload replay, dropped create response, refresh/resume, offline/hidden polling, all terminal states, stable variants, follow-ups, cancellation/quota/expiry, and zero API calls during palette cycling.

### Phase 8 — Security, capacity, cost, operations, and recovery

Work:

- real representative OpenRouter/Chromium jobs;
- worst-case calls/tokens/dollars per job kind and three attempts;
- 100 authenticated control-plane clients;
- concurrent quota/idempotency races;
- queue burst and drain measurement;
- worker memory/cold-start/cancellation;
- SSRF corpus;
- alert and runbook drills;
- secret rotation, purge, rollback, and restore.

Gate: PD-05/08/09 numeric values are approved, task p99 fits deadline, no sandbox/SSRF/IAM blocker, and operator/recovery evidence exists.

### Phase 9 — Canary rollout and legacy retirement

Work:

- deploy worker and `/api/v1` additively;
- enable staff, then 10%, 50%, and 100% cohorts;
- monitor full jobs and alert windows at each gate;
- retain a short authenticated legacy adapter only for rollback;
- after stability, return JSON `410 legacy_endpoint_removed` for expensive legacy routes;
- remove Vite API middleware and legacy transport separately.

Gate: each cohort completes the full product flow with healthy queue, error, security, and cost signals; API/worker rollback and queue pause/resume work without manual Firestore edits.

## Test Matrix and Blocking Launch Gates

| Area | Required evidence |
|---|---|
| Regression | Frozen install, current tests, Vite build, preserved palette/schema behavior, no AI during palette interaction |
| Domain | Exact state table, idempotency conflict/replay, quota midnight, exact job admission reservation release, conservative provider ledgers, retries, call budgets, progress monotonicity |
| Uploads | Signed policy, ownership, missing/overwritten object, generation mismatch, MIME spoof, checksum, dimensions, decompression bomb, expiry |
| API/Auth | Valid/expired/revoked/disabled/wrong-project identity, wrong owner, scheduler OIDC valid/wrong audience/wrong service account, direct service URL, router-scoped JSON limits, legacy raw-stream isolation, ETag, cancellation races, API 404, static fallback/cache |
| Worker | OIDC mismatch, duplicate task, lost acknowledgement, active/stale lease, heartbeat loss at every stage, crash after provider response, checkpoint provenance, stale publish, retry exhaustion, cancellation, deadline, SIGTERM |
| Chromium | HTML/CSS/SVG/redirect/private/metadata/file/WebSocket vectors, non-root sandbox, cleanup, browser crash, memory limit |
| IAM/IaC | Public worker/Firestore/Storage denial, API secret denial, worker task/signing denial, deployer `actAs`, Terraform policy review |
| Frontend | Sign-in, token refresh, upload, idempotent replay, refresh/resume, offline polling, all terminal states, artifact expiry, follow-ups, localStorage inspection |
| E2E | Upload -> three variants -> selection -> categorization -> improvement -> custom swatch -> local palette across service/browser restarts |
| Capacity/Cost | 100 API clients, representative burst, worker p50/p95/p99, queue wait/drain, provider RPM/TPM, memory, token/call/cost ceiling |
| Operations | Alerts, kill switch, queue pause/resume, redrive, secret rotation, purge, logical expiry, API/worker rollback, regional restore |

Launch is blocked until:

- all blocking owner decisions are recorded;
- the production task deadline has measured p99 margin;
- duplicate delivery and worker crashes cannot publish more than one canonical result;
- cancellation wins correctly and is observed within the approved SLO;
- rendered HTML produces zero forbidden network requests;
- all paid routes require authenticated ownership and quotas;
- only the task identity can invoke the worker;
- upload spoof/overwrite/bomb cases fail before paid work;
- secrets and sensitive payloads are absent from source, built assets, image layers, logs, Terraform state, and debug artifacts;
- cost and queue admission controls are active;
- rollback is proven with queued jobs remaining;
- named operators receive and drill critical alerts.

## Rollout and Rollback

1. Provision additive data/IAM/queue resources.
2. Deploy private worker with no queue traffic.
3. Deploy public `/api/v1` and static app without enabling the new UI flow.
4. Run deployed IAM, OIDC, SSRF, Chromium, and real-provider tests.
5. Enable internal staff.
6. Enable 10%, then 50%, then 100%, holding each cohort through representative full jobs and alert windows.
7. Do not advance with increasing queue age, provider errors, terminal failures, sensitive-data findings, or cost alarms.
8. Incident containment sets `ACCEPT_NEW_JOBS=false`; GET/cancel/artifact access remains.
9. Pause the queue only when execution is unsafe; preserve Firestore and reconcile after recovery.
10. API rollback shifts Cloud Run traffic to the previous immutable revision.
11. Worker rollback pauses dispatch, drains/aborts active work or waits for leases, shifts to an N/N-1-compatible revision, runs one canary task, then resumes.
12. Never delete the queue or destructively rewrite Firestore as routine rollback.
13. Keep schema migrations additive during launch. Unsupported versions fail safely and remain inspectable.

## Explicit Non-Goals for Launch

- Exactly-once OpenRouter/model execution, billing, or automatic refunds.
- Firebase Hosting, Firebase-managed deployment, or App Check as a required component.
- Kubernetes, service mesh, multi-region active/active, Pub/Sub, or Cloud Run Jobs.
- WebSockets or SSE; polling is canonical for launch.
- Cloud CDN, Cloud Armor, or an external load balancer unless PD-02 requires them.
- Arbitrary user-selected models or a multi-provider marketplace/failover layer.
- Organizations/teams/RBAC, subscriptions, billing UI, or admin analytics portal.
- Long-term project history, collaboration, public artifacts, or support payload capture.
- Cross-user result caching, a prompt experimentation platform, sharded counters, or broad OpenTelemetry deployment before evidence justifies them.
- Rewriting palette UX, adding Copy CSS, or causing palette interaction to invoke AI.

## Residual Risks

1. **Duplicate external spend:** a provider response can be billed again if a worker dies before durable checkpoint. Fencing protects publication, not external billing.
2. **External processing:** screenshots leave GCP for OpenRouter/model providers and are subject to third-party retention, routing, outage, training, residency, and deletion terms.
3. **Chromium boundary:** Chromium shares the worker service identity/network namespace with Node; application interception is not a hard process network boundary.
4. **Cooperative cancellation:** local abort may not cancel or refund a provider request already accepted upstream.
5. **Single-region outage:** all dynamic work pauses during an accepted regional outage; Cloud Tasks does not transparently fail over.
6. **Multi-account abuse:** Identity Platform does not guarantee one human per account; invite-only launch reduces but does not eliminate abuse.
7. **Unmeasured capacity and economics:** current code has no representative production duration, memory, token, call, or cost evidence.
8. **Firestore contention:** singleton global counters are appropriate for expected scale but may retry under artificial bursts.
9. **Custom-domain complexity:** choosing a load balancer/CDN/Cloud Armor adds fixed cost and operational surface; direct Cloud Run hosting is simpler but has fewer edge controls.
10. **Planning drift:** older implementation documents may conflict with this plan until Phase 0 marks them historical or updates them.

## Reference Sources

The implementation must re-check these official documents during Phase 0 because limits, pricing, and IAM guidance can change:

- [Cloud Run request timeouts](https://cloud.google.com/run/docs/configuring/request-timeout)
- [Cloud Run container runtime and shutdown contract](https://cloud.google.com/run/docs/container-contract)
- [Cloud Run concurrency](https://cloud.google.com/run/docs/about-concurrency)
- [Cloud Tasks HTTP targets and OIDC](https://cloud.google.com/tasks/docs/creating-http-target-tasks)
- [Cloud Tasks issues and limitations](https://cloud.google.com/tasks/docs/common-pitfalls)
- [Firestore transactions](https://cloud.google.com/firestore/docs/manage-data/transactions)
- [Firestore pricing and free quotas](https://cloud.google.com/firestore/pricing)
- [Cloud Storage pricing](https://cloud.google.com/storage/pricing)
- [Identity Platform pricing](https://cloud.google.com/identity-platform/pricing)
- [Identity Platform product comparison](https://cloud.google.com/identity-platform/docs/product-comparison)
- [Cloud Run pricing](https://cloud.google.com/run/pricing)
- [Cloud Tasks pricing](https://cloud.google.com/tasks/pricing)

## Breakdown Strategy for Implementation

After Phase 0 approval, break this plan into small reviewable tickets rather than assigning entire services at once:

1. ADRs, contracts, owner decisions, and compatibility fixtures.
2. Package/lockfile/runtime cleanup only.
3. Shared configuration, errors, schemas, and redacted logging.
4. Processor extraction one job kind at a time.
5. Chromium sanitizer/network-denial vertical slice.
6. Upload generation-pinning vertical slice.
7. Job/idempotency/quota transaction vertical slice.
8. Deterministic enqueue/reconciliation vertical slice.
9. Worker lease/fence/checkpoint vertical slice with fault injection.
10. One complete analysis job vertical slice, then each follow-up kind.
11. Identity Platform and ownership enforcement.
12. Frontend upload/create/poll/cancel flow behind a feature flag.
13. Terraform/IAM resources by security boundary.
14. Containers and Cloud Build promotion.
15. Security, capacity, cost, runbook, canary, and legacy-retirement tickets.

Every ticket must name:

- the contract/schema version it changes;
- prerequisites and owner decisions;
- implementation files;
- unit/integration/deployed validation;
- observability added;
- migration and rollback behavior;
- explicit completion gate.

The next step is not implementation. The next step is to resolve Phase 0 owner decisions, then convert Phase 1 into ordered tickets with acceptance tests and commit boundaries.
