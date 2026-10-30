# Jobs v1 Contract

- **Status:** Accepted baseline
- **Schema version:** 1
- **Architecture:** [ADR 0001](../adr/0001-production-architecture.md)

## Delivery Guarantee

Cloud Tasks delivery and OpenRouter execution may repeat. The system guarantees at most one canonical published result. It does not guarantee exactly-once external model execution, billing, or refunds.

## Job States

```text
none -> queued
queued -> running | cancelled | timed_out
running -> queued | cancel_requested | succeeded | failed | timed_out
cancel_requested -> cancelled
terminal: succeeded | failed | cancelled | timed_out
```

Rules:

- terminal states are immutable;
- every externally visible update increments monotonic `stateVersion`;
- transitions are Firestore transactions with expected prior state and fence;
- job admission active/cost reservations release exactly once;
- cancellation and success cannot both commit;
- stale workers cannot checkpoint or publish.

### Analysis success semantics

An analysis execution produces exactly three stable indexed outcomes with
indexes `0`, `1`, and `2`. Each outcome is either `complete` or `failed`.
Canonical job success requires all three outcomes to be present, uniquely
indexed, schema-valid, and `complete`.

Partial outcomes and failed variants may be retained as private attempt evidence,
but they cannot produce state `succeeded`, terminal stream `complete`, a
canonical manifest pointer, or a public result. A stream or worker execution
ending without the required terminal result is not success. Cancellation,
deadline, budget, lease/fence, and shutdown errors abort control flow rather
than becoming successful or partial canonical outcomes.

## Canonical Job Record

`jobs/{jobId}` contains:

```text
schemaVersion: 1
processorVersion
promptRevision
modelProfileRevision
jobId
ownerUid
ownerUidHash
kind
state
stateVersion
progress: { stage, percent, message }
input: bounded validated references and pinned generations
options: bounded server-owned enums/values
optionsHash
dispatch: {
  generation,
  taskName,
  status: pending|enqueued|exhausted,
  enqueuedAt?,
  lastErrorCode?
}
execution: {
  attemptCount,
  currentAttemptId?,
  fenceToken,
  leaseExpiresAt?,
  heartbeatAt?,
  startedAt?,
  lastAttemptAt?,
  applicationDeadlineAt?
}
cancellation: { requestedAt?, observedAt?, cancelledAt? }
result?: { manifest pointer/generation/checksum, public summary }
error?: { code, safeMessage, retryable, stage }
admissionReservation: exact user/global active/cost documents and day keys
createdAt
updatedAt
absoluteJobDeadlineAt
completedAt?
artifactsExpireAt
expiresAt
```

Do not store images, HTML, prompts, signed URLs, identity tokens, raw provider responses, or secrets.

## Attempts

`jobs/{jobId}/attempts/{attemptId}` records:

- task name and retry count;
- fence token;
- started, heartbeat, and ended timestamps;
- current/final stage;
- safe retry classification/error;
- provider call count and per-attempt provider-ledger summary;
- `applicationDeadlineAt`, `absoluteJobDeadlineAt`, and the effective processor
  deadline used by the attempt;
- artifact prefix;
- temporary cleanup result.

## Checkpoints

Checkpoint ID: `{provenanceHash}_{stageKey}`.

A reusable checkpoint is immutable and `completed`. Its provenance includes:

- input object generation and SHA-256;
- source manifest generation/checksum;
- options hash;
- processor, prompt, model-profile, and stage revisions;
- dependency artifact checksums;
- output artifact generations/checksums.

Never reuse partial provider responses, unvalidated HTML, or artifacts with mismatched provenance.

## Idempotent Creation

The API hashes the client idempotency key and canonical request body.

`idempotency/{uidHash_keyHash}` contains owner, key hash, request hash, job ID, creation, and expiry.

- missing record: create idempotency record and job in one transaction;
- same key and request hash: return existing job;
- same key and different hash: `409 idempotency_conflict`.

The same transaction claims the upload where applicable, verifies quotas/
admission, creates a job-level admission reservation for worst-case active and
cost capacity, increments daily consumption, and creates
`dispatch.status=pending`. This admission reservation controls whether the job
may enter the system; it is distinct from provider-call accounting inside each
worker attempt.

## Deterministic Dispatch

Task name:

```text
job-<jobId>-d<dispatchGeneration>
```

`ALREADY_EXISTS` means successful enqueue. A Firestore commit followed by enqueue failure leaves a durable pending job. Reconciliation recreates the deterministic task.

Manual redrive increments `dispatchGeneration` only after the prior task is absent/exhausted and the job remains nonterminal.

## Worker Invocation

```text
POST /internal/tasks/jobs/:jobId/run
```

```json
{ "schemaVersion": 1, "jobId": "job_...", "dispatchGeneration": 1 }
```

The task payload identifies work; Firestore is authoritative for job kind, input, options, and revisions.

The worker verifies Cloud Run IAM/OIDC plus expected audience, invoker identity, queue/project/location/task headers, path/body job ID, and dispatch generation.

## Lease and Fencing

1. Worker transaction returns immediately for terminal jobs.
2. A valid unexpired lease prevents another attempt from starting.
3. Acquisition increments integer `fenceToken`, creates `attemptId`, increments attempt count, and sets a 90-second lease using server time.
4. Heartbeat renews every 30 seconds.
5. Every progress, checkpoint, terminal, and canonical publication transaction verifies current attempt and fence.
6. Failed renewal, fence mismatch, cancellation, or deadline aborts the local controller.
7. Check fence ownership before and after every paid/external stage.
8. Stale attempt objects may remain for lifecycle cleanup but can never become public.

## Retry Classification

Retryable:

- OpenRouter/HTTP `408`, `429`, and `5xx`;
- selected transient network, Firestore, or Storage failures;
- Chromium process crash when resource/security limits were not violated.

Permanent:

- authentication/authorization failure;
- invalid schema/input/media;
- safety/sanitization rejection;
- unsupported schema/processor version;
- permanent provider `4xx`;
- call/token/cost budget exceeded;
- attempts exhausted;
- absolute deadline reached.

Allow at most one bounded transport retry inside an attempt and at most three
Cloud Tasks attempts. Every provider request, including a retry, uses the
per-attempt provider ledger described below.

Task response:

- `204`: terminal, success, cancellation, stale delivery, or permanent failure durably recorded;
- `503`: retryable failure or active valid lease;
- `500`: unexpected retryable failure after best-effort safe recording.

## Deadlines

Proposed launch values:

```text
OpenRouter call timeout:       120 seconds
Application attempt deadline: 1500 seconds
Cloud Run worker timeout:     1650 seconds
Cloud Tasks dispatch deadline:1800 seconds
Absolute job deadline:        120 minutes including queue wait
```

Ordering is mandatory:

```text
call < application attempt < Cloud Run request < Cloud Tasks dispatch
```

The persisted/processor deadline fields are:

- `applicationDeadlineAt`: the current attempt's application deadline;
- `absoluteJobDeadlineAt`: the job's final deadline including queue wait;
- effective processor deadline: the earlier of those two values.

Provider-call timeouts, provider/render semaphore waits, stage waits, artifact/
checkpoint writes, and cleanup use the effective remaining time. They must not
start when no positive effective time remains. The application must finish
cleanup before the Cloud Run/Tasks boundary. Staging must demonstrate worker
p99 below the application deadline. Otherwise split the pipeline or use Cloud
Run Jobs.

## Cancellation

- API cancellation of queued work commits terminal `cancelled`, releases the
  job admission reservation once, and best-effort deletes the task.
- Running cancellation commits `cancel_requested`.
- Worker checks at stage boundaries and at least every five seconds.
- One job-level `AbortSignal` reaches OpenRouter, Storage operations, image validation wrappers, browser work, and cleanup where supported.
- The final success transaction requires `running`, current fence, no cancellation, and valid deadline.
- Reconciler finalizes cancellation after lease expiry if a worker disappears.

Cancellation is cooperative and does not promise reversal of provider billing.

## Quotas, Admission Reservations, and Provider Ledgers

Non-daily user/global records track active jobs and job-level reserved worst-
case cost so midnight cannot reset active limits. Daily records track consumed
creation counts.

The job admission reservation is created before task dispatch. It protects user/
global active-job and worst-case cost capacity and is not the provider usage
ledger. Each job stores its exact reservation document IDs/day keys. Terminal
transitions set `releasedAt` and decrement active/reserved admission capacity
once. Daily consumed counts are not refunded.

Each worker attempt has a separate provider ledger bounded by the job kind's
call/token/cost ceilings. Before each provider request is dispatched, the ledger
must atomically reserve:

- one provider call; and
- that request's worst-case token and cost exposure.

After a response, reconcile only from trusted provider usage. If trusted usage
is missing, incomplete, or the request may have reached the provider, retain the
conservative worst-case reservation. Release a provider reservation only when
it is known the request was not dispatched. Tool turns, repair, regeneration,
evaluation, correction, and transport retry are separate provider requests and
separate ledger entries. No attempt may consume unreserved provider work.

Proposed launch limits:

- 5 primary jobs/user/day;
- 20 follow-ups/user/day;
- 2 active jobs/user;
- 500 primary jobs/global/day;
- 2,000 follow-ups/global/day;
- 50 accepted nonterminal jobs globally;
- global reserved-cost ceiling from approved model pricing.

`ACCEPT_NEW_JOBS=false` prevents new paid acceptance but preserves GET, cancellation, artifacts, and reconciliation.

## Stable Progress Stages

Each job kind defines a finite allowlist. Analysis initially uses:

```text
queued
validating-input
preparing
variant-1-generating
variant-1-rendering
variant-1-evaluating
variant-2-generating
variant-2-rendering
variant-2-evaluating
variant-3-generating
variant-3-rendering
variant-3-evaluating
selecting
publishing
complete
```

Each variant's events preserve causal order for that variant, for example
`generating -> generated -> rendering -> rendered -> evaluating -> evaluated`
or a terminal variant failure. Events from different variants may interleave.
Individual variant tasks never write global percent directly.

One progress aggregator consumes the variant events and emits global progress.
That aggregate percent must be monotonic, bounded `0..100`, and reach `100` only
with canonical terminal success. User-facing messages are bounded and contain no
provider/internal data.

## Reconciliation

A bounded scheduler job:

- enqueues `dispatch.pending` jobs;
- expires jobs beyond deadline when no valid publisher can win;
- finalizes cancellation after lease expiry;
- releases leaked job admission reservations;
- expires abandoned uploads;
- records metrics and safe errors.

Reconciliation never rewrites successful manifests and does not perform paid model work.
