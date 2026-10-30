# ADR 0001: Production Architecture

- **Status:** Accepted
- **Date:** 2026-07-21
- **Owner approval:** Proceed with proposed defaults
- **Canonical plan:** [`production-plan.md`](../production-plan.md)

## Context

The current application runs its API only as Vite development middleware. Expensive OpenRouter and Chromium work is synchronous, tied to a browser connection, unauthenticated, non-durable, and written to local debug storage. The product expects approximately 100 initial users and must protect paid model usage and uploaded screenshots.

The earlier [`cloud-run-api-migration-plan.md`](../archive/cloud-run-api-migration-plan.md) preserves useful route/static compatibility requirements but intentionally defers authentication, quotas, Cloud Tasks, Firestore jobs, and worker isolation. It is therefore superseded as the production architecture.

## Decision

Use an all-Google-Cloud architecture:

```text
Browser
  -> public Cloud Run palette-web-api
       -> Express 5 serves Vite dist/
       -> Identity Platform authentication
       -> /api/v1 control APIs
       -> Firestore canonical state
       -> signed Cloud Storage operations
       -> Cloud Tasks dispatch

Cloud Tasks
  -> OIDC
  -> private Cloud Run palette-worker
       -> Firestore lease/fence/checkpoints
       -> generation-pinned Cloud Storage input
       -> Playwright/Chromium
       -> OpenRouter via Secret Manager
       -> immutable artifact manifest
```

### Accepted defaults

- Express 5 for both HTTP boundaries.
- Public web/control service serves the Vite build and does not contain Chromium or the OpenRouter secret.
- Identity Platform with invite-only Google and email-link users for the first 100 users.
- Cloud Tasks and a private worker with Cloud Run concurrency `1`.
- Firestore Native mode for job, idempotency, lease, quota, and result metadata.
- Private Cloud Storage buckets for uploads and artifacts.
- MiniMax M3 through OpenRouter as the initial server-owned model profile.
- Exactly three generated variants.
- No client-controlled raw model identifiers.
- Region `us-central1`, single-region launch.
- Proposed RPO 24 hours and RTO 8 hours.
- Terraform and Cloud Build with separate staging and production projects and manual production approval.
- Staging upload retention 1 day, validated input 2 days, artifacts 7 days, job metadata 30 days, idempotency 1 day.
- Five primary analyses/user/day, twenty follow-ups/user/day, two active jobs/user.
- Initial worker max instances `3`, gated to `5` or `10` only after capacity, provider, and cost evidence.
- At most one canonical published result; no exactly-once OpenRouter execution or billing promise.
- Chromium runs non-root with sandbox enabled; an unapproved `--no-sandbox` requirement blocks launch.
- Polling with ETags is canonical for launch; SSE/WebSockets are deferred.

## Data-processing disclosure

Infrastructure and canonical data are on GCP, but screenshots and generated/rendered content leave GCP when sent to OpenRouter and its routed model provider. Provider retention, routing, training, residency, and deletion terms are outside GCP guarantees and must be reflected in product privacy disclosures before launch.

## Authentication boundaries

- User-facing `/api/v1/**` routes verify Identity Platform tokens.
- `POST /internal/reconcile` verifies a GCP service-account OIDC token with exact audience and scheduler identity.
- The private worker is protected by Cloud Run IAM and accepts only the dedicated Cloud Tasks invoker identity.
- Identity is not authorization: every upload, job, artifact, and cancellation checks ownership.

## Delivery semantics

Cloud Tasks is at least once. The worker uses deterministic task names, Firestore leases, monotonic fencing tokens, immutable attempt artifacts, exact-provenance checkpoints, and a transactional canonical manifest pointer. A stale or duplicate attempt may consume provider resources but cannot publish over the canonical result.

## Consequences

### Benefits

- Browser disconnects and instance replacement do not lose accepted work.
- Paid work is authenticated, quota-controlled, cancellable, and observable.
- Chromium and model credentials are isolated from public traffic.
- Uploads and results have durable ownership and retention rules.
- Deployment and rollback become reproducible.

### Costs and complexity

- Two Cloud Run services, Firestore, Storage, Tasks, Identity Platform, Scheduler, IAM, and Terraform must be operated.
- Firestore transition/lease logic and duplicate-delivery testing are required.
- OpenRouter charges may repeat after a response-before-checkpoint crash.
- Single-region failure pauses dynamic work.

## Deferred decisions that do not block local implementation

These inputs are required before staging or production deployment, not before local Phase 1 work:

- GCP staging and production project IDs and linked billing account.
- Final public hostname strategy: direct Cloud Run/custom-domain mapping versus external HTTPS load balancer/serverless NEG.
- Authorized Identity Platform domains and invitation administration workflow.
- OpenRouter production model IDs, prices, RPM/TPM limits, and spend limit.
- Primary and backup operator contact/paging channel.
- Approved privacy-policy wording and data deletion support channel.

## Rejected alternatives

- **Firebase Hosting/App Check as required architecture:** unnecessary for the selected all-GCP deployment.
- **One synchronous concurrency-1 service:** couples static/API availability to long Chromium work and lacks durable recovery.
- **Fastify/Hono/NestJS rewrite:** does not solve the workload or durability problem and increases migration cost.
- **Native Node only:** requires unnecessary routing/static/error infrastructure.
- **Cloud Run Functions:** poor fit for long Chromium execution and shared browser lifecycle.
- **Cloud Run Jobs for launch:** Cloud Tasks fits if measured worker p99 remains below the 30-minute task deadline; jobs remain a fallback if it does not.

## Validation

This ADR is implemented only when the blocking launch gates in the canonical production plan pass. Approval of this ADR authorizes Phase 1 local implementation; it does not authorize production traffic.
