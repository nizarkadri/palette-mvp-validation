# Phase 03 — Domain State and Cloud Repositories

- **Status:** Not started
- **Depends on:** Phase 00 contracts; Phase 01 processor interfaces
- **Unblocks:** public API and private worker

## Goal

Encode the production job state machine, idempotency, quotas, leases, immutable uploads/artifacts, and cloud adapters with emulator/test seams before HTTP services depend on them.

## Related Codebase

The current repository has browser session state in `src/App.jsx`, `state model.md`, and `schema contracts.md`, but no production job model. Existing debug files are not canonical persistence. Current routes trust base64/HTML bodies and do not have ownership or idempotency.

## Implementation

1. Add fail-fast configuration parsing for limits, deadlines, revisions, environment, and model profiles.
2. Add stable error codes and redacted structured logging.
3. Implement job/upload/options schemas matching `contracts/`.
4. Implement the exact state transition table as pure functions plus Firestore transactions.
5. Implement monotonic `stateVersion`, attempt IDs, lease expiry, heartbeat, and fence preconditions.
6. Implement idempotency key hashing and canonical request hashing.
7. Implement non-daily job admission active/cost reservations and daily
   consumed quotas with exact reservation references.
8. Implement a separate durable per-attempt provider ledger: reserve one call
   plus worst-case token/cost exposure before provider dispatch, reconcile only
   trusted usage, and retain conservative exposure when usage is missing or the
   request may have reached the provider.
9. Persist `applicationDeadlineAt` and `absoluteJobDeadlineAt`; expose their
   earlier effective processor deadline to worker/processor adapters.
10. Implement signed upload authorization and generation-pinned finalization/
    copy.
11. Implement the durable Phase 01 ports separately: causally ordered variant
    event projection with one bounded monotonic progress aggregator, create-only
    canonical `artifactStore`, and immutable validated provenance-bound
    `checkpointStore`; diagnostics never substitute for these stores.
12. Implement immutable attempt objects, manifests, and logical artifact lookup
    over those ports.
13. Implement deterministic task naming/enqueue adapter and reconciliation query
    seams.
14. Keep Firestore/Storage/Tasks behind small repository interfaces with in-
    memory/emulator implementations.

## Likely Files

Create:

- `server/config.js`
- `server/logger.js`
- `server/domain/schemas.js`
- `server/domain/jobState.js`
- `server/domain/idempotency.js`
- `server/domain/quotas.js`
- `server/domain/artifacts.js`
- `server/repositories/firestore.js`
- `server/repositories/storage.js`
- `server/repositories/tasks.js`
- `server/repositories/memory/**`
- Firestore index definitions under Terraform or `firestore.indexes.json`

Reuse the exact processor context, event, diagnostics, artifact, and checkpoint
interfaces from Phase 01; do not redefine them or import Express into domain/
repository modules.

## Tests

- every allowed and forbidden state transition;
- terminal-state immutability;
- stale fence/attempt cannot update progress/checkpoint/result;
- progress projection is bounded and monotonic and rejects stale state versions;
- checkpoints reject partial/unvalidated values and provenance mismatches;
- diagnostics cannot publish or replace canonical artifacts/checkpoints;
- concurrent idempotent create returns one job;
- same key/different request returns conflict;
- 100 concurrent job admission reservations enforce limits;
- active admission quotas survive UTC midnight and release once;
- admission reservation cannot be spent/reconciled as provider usage;
- concurrent provider-ledger reservations cannot exceed call/token/cost limits;
- trusted usage reconciles exposure, while missing usage or possible provider
  receipt retains worst-case exposure;
- both explicit deadline fields persist and stale/expired effective deadlines
  reject work;
- task-create crash window remains reconcilable;
- deterministic task `ALREADY_EXISTS` is success;
- queued/running cancellation races with success correctly;
- staging object overwrite before/during/after finalization cannot change validated generation;
- MIME spoof, corrupt file, dimensions/pixel bomb, checksum, and expiry;
- attempt artifacts cannot become public without canonical manifest;
- logical name/path traversal rejected;
- Firestore documents and manifests remain under size limits;
- logs redact all sensitive fields.

## Implementation Cautions

- Firestore transaction callbacks may retry; never call OpenRouter, Storage copy, or Cloud Tasks from inside a transaction callback.
- Firestore server timestamps, not browser/worker clocks, decide leases and transitions.
- Firestore IAM is not collection-level authorization; repository ownership checks are mandatory.
- Do not store payloads near Firestore's document limit; HTML/images/results belong in Storage.
- Do not refund consumed daily usage automatically; only job admission active/
  cost reservations release. Provider-ledger entries reconcile independently
  and conservatively.
- Do not shard counters until measured contention requires it.
- A successful Storage write is not canonical publication until the fenced Firestore transaction commits.

## Completion Gate

- Domain tests cover every transition/race.
- Emulator tests prove idempotency, admission quotas, provider-ledger
  accounting, explicit deadline handling, generation pinning, and stale-fence
  rejection.
- Repositories implement the Phase 01 ports and are usable by both API and
  worker without HTTP coupling.
- No sensitive payload enters Firestore/logs.
- Required index queries are defined and tested.

## Rollback

Schemas are additive and versioned. Keep N/N-1 readers during rollout. Never roll back by deleting job documents or overwriting manifests.
