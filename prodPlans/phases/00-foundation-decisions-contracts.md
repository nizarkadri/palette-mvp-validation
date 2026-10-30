# Phase 00 — Foundation, Decisions, and Contracts

- **Status:** Complete for local implementation; deployment inputs pending
- **Depends on:** none
- **Unblocks:** every later phase

## Goal

Create one authoritative production direction and versioned contracts before code is split across web, worker, Firestore, Storage, and Cloud Tasks.

## Related Codebase

- Historical plans under `implementation phases/` contain useful product behavior but conflicting production assumptions.
- `vite.config.js` and `server/plugin.js` are currently the only API host.
- `src/lib/aiAnalysis.js` defines the existing browser transport contracts.
- `server/routes/*.js` define current method/error/response behavior.
- `implementation phases/schema contracts.md` and `state model.md` remain authoritative for palette/product models, not production jobs.

## Completed Work

- Accepted [`../adr/0001-production-architecture.md`](../adr/0001-production-architecture.md).
- Created [`../contracts/api-v1.md`](../contracts/api-v1.md).
- Created [`../contracts/jobs-v1.md`](../contracts/jobs-v1.md).
- Created [`../contracts/artifacts-v1.md`](../contracts/artifacts-v1.md).
- Created the canonical [`../production-plan.md`](../production-plan.md).
- Archived the superseded synchronous Cloud Run plan and assessment.
- Approved the proposed all-GCP defaults for local implementation.

## Remaining Deployment Inputs

These do not block Phase 01–05 local work:

- staging and production GCP project IDs/billing;
- production hostname strategy;
- Identity Platform authorized domains and invitation workflow;
- production model IDs/prices/provider limits;
- primary and backup operator contacts;
- approved privacy/deletion support wording.

## Tests and Checks

- All relative links under `prodPlans/` resolve.
- No two non-archive documents claim conflicting canonical architecture.
- API, jobs, and artifacts contracts agree on IDs, states, limits, expiry, auth, and status codes.
- Production plan and ADR agree on defaults and deferred inputs.
- Existing palette/product schema contracts remain explicitly preserved.

## Implementation Cautions

- Do not rewrite historical product decisions just to match the new infrastructure.
- Do not treat archived synchronous plans as current architecture.
- Do not turn proposed capacity numbers into promises before staging evidence.
- Do not put project IDs, credentials, billing account IDs, invite lists, or secrets into committed plans.
- Identity Platform SDK packages may retain Firebase-compatible names; that does not authorize reintroducing Firebase Hosting/App Check architecture.

## Completion Gate

Phase 00 is complete for local development when all contracts are linked, defaults are accepted, and no competing plan is authoritative. It becomes deployment-complete only when the listed GCP/provider/operator inputs are supplied.

## Rollback

Documentation-only. Reverting this phase would restore ambiguity and must not occur without replacing it with another accepted ADR and migrated contracts.
