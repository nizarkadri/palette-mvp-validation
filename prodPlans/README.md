# Production Implementation Plans

This directory is the single source of truth for production architecture, contracts, phased implementation, validation, and rollout.

## Authority Order

1. [`adr/0001-production-architecture.md`](./adr/0001-production-architecture.md) — accepted architecture and defaults.
2. [`contracts/`](./contracts/) — versioned API, job, upload, and artifact contracts.
3. [`production-plan.md`](./production-plan.md) — complete architecture, security, operations, and launch plan.
4. [`phases/`](./phases/) — implementation breakdowns with goals, codebase impact, tests, cautions, and completion gates.
5. [`archive/`](./archive/) — superseded plans retained only for compatibility evidence.

If documents conflict, follow the highest item in this list and update the lower document in the same change.

## Phase Tracker

| Phase | Plan | Status | Primary outcome |
|---:|---|---|---|
| 00 | [Foundation, decisions, contracts](./phases/00-foundation-decisions-contracts.md) | Complete for local implementation; deployment inputs pending | Canonical decisions and contracts |
| 01 | [Runtime and processor foundation](./phases/01-runtime-and-processor-foundation.md) | In progress | Reproducible build and HTTP-independent cancellable processors |
| 02 | [Chromium and generated-content security](./phases/02-chromium-security.md) | Not started | Network-denied, bounded, sandboxed rendering |
| 03 | [Domain state and cloud repositories](./phases/03-domain-and-repositories.md) | Not started | Job state machine, quotas, uploads, persistence adapters |
| 04 | [Public web and control API](./phases/04-web-api-service.md) | Not started | Express 5 web/API service with Identity Platform |
| 05 | [Private durable worker](./phases/05-private-worker.md) | Not started | Cloud Tasks worker with lease/fence/checkpoint semantics |
| 06 | [Staging infrastructure and delivery](./phases/06-staging-infrastructure.md) | Not started | Terraform, IAM, containers, Cloud Build, staging environment |
| 07 | [Frontend durable-job migration](./phases/07-frontend-migration.md) | Not started | Authenticated direct upload, job polling, recovery, cancellation |
| 08 | [Security, capacity, cost, and operations](./phases/08-production-validation.md) | Not started | Evidence-based production settings and exercised runbooks |
| 09 | [Canary rollout and legacy retirement](./phases/09-rollout-and-retirement.md) | Not started | Reversible launch and removal of synchronous legacy APIs |

## Status Definitions

- **Not started:** no implementation from this phase should be assumed.
- **In progress:** only work explicitly marked complete in the phase file is complete.
- **Blocked:** a named decision, dependency, or failing gate prevents safe progress.
- **Complete for local implementation:** local contracts/work are complete, but cloud deployment inputs may remain.
- **Complete:** every phase gate and required test has passed.

## Codebase Invariants

Every phase must preserve these unless an ADR explicitly changes them:

- Palette cycling, role locks, custom swatches, and preview interaction remain local and make no AI calls.
- The product returns three stable variants sorted by variant index, not promise completion order.
- Generated output continues to support `{ html, elements }`, semantic role groups, grouped `selectors[]`, and legacy `selector` compatibility while migration is active.
- Unknown `/api/**` routes return JSON and never SPA HTML.
- Legacy handlers own their raw request streams until retired; new Express JSON parsing is router-scoped.
- User screenshots, HTML, prompts, provider payloads, signed URLs, and secrets are not logged.
- Canonical production data is never stored only on Cloud Run local disk.
- No public client controls an arbitrary OpenRouter model ID.
- Cloud Tasks and provider calls are treated as repeatable; only canonical publication is fenced.
- Existing tests and production build must stay green after every implementation ticket.

## Required Validation Per Ticket

Every ticket derived from these phases must document:

1. goal and non-goals;
2. files expected to change;
3. contract/schema version impact;
4. unit/integration/deployed tests;
5. security and data-handling impact;
6. observability added;
7. rollback or compatibility behavior;
8. completion gate.

Minimum local commands:

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
```

Run focused tests first, then the full suite. Run LSP/pi-lens diagnostics on touched source files before declaring completion.

## Inputs Needed Before Cloud Deployment

Local Phase 1–5 implementation can proceed without these values, but only in
the declared dependency order; this does not make the five phases independently
ready. Phase 6 or later requires:

- staging and production GCP project IDs with billing linkage;
- final hostname/custom-domain strategy;
- Identity Platform authorized domains and invitation administration;
- production OpenRouter model IDs, pricing, RPM/TPM, and spend limit;
- primary and backup alert recipients;
- privacy/deletion support contact and approved disclosure text.

Never place secrets in plan files, chat, Terraform variables, build arguments, or committed environment files.

## Archive

- [`archive/cloud-run-api-migration-plan.md`](./archive/cloud-run-api-migration-plan.md)
- [`archive/cloud-run-api-migration-assessment-and-test-cases.md`](./archive/cloud-run-api-migration-assessment-and-test-cases.md)

These documents describe the earlier synchronous migration approach. Use them only for route/static compatibility and historical test reasoning.
