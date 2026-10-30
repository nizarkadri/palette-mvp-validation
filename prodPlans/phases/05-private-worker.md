# Phase 05 — Private Durable Worker

- **Status:** Not started
- **Depends on:** Phases 01–03; Phase 02 security gate
- **Unblocks:** durable production analysis

## Goal

Execute every paid job through a private Cloud Tasks-invoked worker with bounded attempts, lease/fence ownership, checkpoint recovery, cancellation, and one canonical result.

## Related Codebase

Current routes combine HTTP streaming with generation, rendering, evaluation, correction, categorization, debug writes, and final response. Phase 01 must first expose these as processors. `browserPool.js` currently manages a singleton browser but not job lease/cancellation.

## Implementation

1. Add private Express worker app and `/internal/tasks/jobs/:jobId/run`.
2. Require Cloud Run IAM and exact Cloud Tasks OIDC audience/invoker.
3. Validate task path/body/schema/dispatch generation and expected queue headers.
4. Load authoritative job/options/input/revisions from Firestore.
5. Acquire transactionally fenced lease; return safely for terminal or stale deliveries.
6. Start heartbeat and cancellation monitor.
7. Instantiate the Phase 01 processor context with the authoritative server-
   owned model profile/revision, lease/fence-derived signal,
   `applicationDeadlineAt`, `absoluteJobDeadlineAt`, their earlier effective
   processor deadline, logger, transport-neutral progress/event ports, redacted
   diagnostics, and the Phase 03 durable artifact/checkpoint adapters.
8. Initialize a per-attempt provider ledger from the authoritative job-kind
   call/token/cost ceilings. Keep it separate from the job admission/cost
   reservation, which only protects user/global capacity.
9. Preserve causal event order within each concurrent variant and feed events to
   one progress aggregator; only that aggregator writes bounded monotonic job
   progress. Write create-only canonical attempt artifacts and immutable
   validated checkpoints with exact provenance.
10. Classify transient/permanent failures and return 204/503 according to the
    jobs contract.
11. Write immutable manifest then commit canonical pointer through current
    fence.
12. Release job admission reservations once on terminal state; never treat that
    release as provider-ledger reconciliation.
13. Handle SIGTERM within Cloud Run's 10-second grace.

## Likely Files

Create:

- `server/worker/app.js`
- `server/worker/index.js`
- `server/worker/runner.js`
- `server/worker/lease.js`
- `server/worker/cancellation.js`
- `server/worker/artifacts.js`
- `server/worker/processors/{analysis,categorization,improvement,customSwatch}.js`
- fault-injection tests under `server/worker/__tests__/`

## Tests

- unauthenticated/wrong OIDC audience/wrong invoker rejected;
- path/body/generation/queue mismatch handled permanently;
- duplicate simultaneous task delivery starts one valid attempt;
- active lease prevents another attempt;
- expired lease creates a higher fence;
- stale worker cannot progress/checkpoint/publish;
- heartbeat loss before/after every expensive await aborts local work;
- crash before provider, after provider response, after artifact, before
  checkpoint, after manifest, and before final response;
- lost task acknowledgement does not duplicate canonical result;
- transient provider/network/storage failure retries within limits;
- permanent/safety/schema/call-budget failure does not retry storm;
- cancellation during generation/render/publish cannot later succeed;
- cancellation, deadline, budget, lease/fence, and shutdown control-flow errors
  are never converted into fallback or partial success;
- exactly three stable indexed analysis outcomes are required before canonical
  success;
- process-wide provider/render semaphore queues abort using the effective
  remaining processor time and release permits on every path;
- `applicationDeadlineAt` and `absoluteJobDeadlineAt` produce the earlier
  effective processor deadline and preserve attempt/request/task ordering;
- job admission reservation remains separate from the per-attempt provider
  ledger;
- every provider request reserves one call and worst-case token/cost exposure
  before dispatch;
- trusted usage reconciles provider reservations, while missing usage or a
  request that may have reached the provider retains conservative exposure;
- SIGTERM cleans resources or safely leaves lease to expire;
- orphan attempt artifacts remain inaccessible and lifecycle-cleanable.

## Implementation Cautions

- Do not claim exactly-once provider execution or spend.
- Do not pass the job admission/cost reservation as a processor budget. The
  worker uses a separate per-attempt provider ledger and reconciles only trusted
  usage.
- Check fence before and after every external/paid stage, not only at final write.
- Firestore heartbeat failure must abort local work; do not continue optimistically.
- Do not clear a lease owned by another fence during cleanup.
- Do not return non-2xx before recording a permanent failure or Cloud Tasks will retry it.
- Keep Cloud Run concurrency 1, but also use the Phase 01 process-wide abort-
  aware provider/render semaphores around every provider and render call.
- Worker receives only job identity/version; never trust task-provided object
  paths or model IDs. Resolve the persisted profile revision from authoritative
  server configuration before processor invocation.
- Diagnostics are never canonical persistence; only the durable artifact/
  checkpoint ports may publish outputs or resumable stages.
- Cleanup failures are secondary and must not mask the primary processor/
  control-flow error.

## Completion Gate

- Fault-injection matrix proves at most one canonical manifest.
- Attempts/provider calls remain within configured bounds, per-attempt ledger
  reservations, and process-wide semaphore limits.
- Admission capacity and provider usage reconcile independently and
  conservatively.
- Cancellation, deadlines, lease/fence loss, and shutdown propagate
  deterministically without fallback conversion.
- Analysis cannot publish success without exactly three complete stable indexed
  outcomes.
- Private invocation and least-privilege assumptions pass in staging later.
- Full existing regression suite remains green.

## Rollback

Worker versions support N/N-1 job/task/manifest schemas. Pause queue, wait/abort active attempts or lease expiry, shift to previous revision, run one canary, then resume. Never delete queued tasks as routine rollback.
