# Phase 06 — Staging Infrastructure and Delivery

- **Status:** Not started
- **Depends on:** Phases 03–05 implementation-ready services
- **Requires from owner:** staging project/billing, hostname choice, authorized domains, provider limits, alert contacts
- **Unblocks:** deployed E2E, capacity/security evidence

## Goal

Provision a reproducible least-privilege staging environment and immutable delivery pipeline matching the production topology.

## Security-hardening sequence

The staging security runbook splits Cloud Tasks IAM into two gates:

- H6-A reconciles the already-applied bindings, commits only their Terraform
  definitions, and records that deployed-principal validation remains pending.
- H6-B runs only after Phases 03–05 are implementation-ready and the minimum
  Phase 06 keyless execution paths exist.

H6-B is the sole exception to the runbook's pre-workload rule. It permits only
immutable exact-digest validation images satisfying the active H5 policy,
bounded validation-only revisions or jobs, synthetic non-sensitive data, no
cohort or user traffic, and predeclared cleanup and rollback boundaries. H7
remains blocked until H6-B passes. H5 currently uses the documented owner-
approved scanning-disabled risk-acceptance path; this removes only the scanning
prerequisite and does not authorize an image push, deployment, or H6-B workload.

## Infrastructure

Terraform provisions:

- required Google APIs;
- Artifact Registry;
- Firestore Native database, indexes, TTLs, and approved backup/PITR choice;
- private regional input/artifact buckets, CORS, lifecycle, and public-access prevention;
- Cloud Tasks queue with OIDC, retry, dispatch, and 1800-second deadline settings;
- public `palette-web-api` and private `palette-worker` Cloud Run services;
- separate runtime, task-invoker, scheduler, build, deploy, and Terraform identities;
- Secret Manager resource/reference for OpenRouter, value supplied out of band;
- Cloud Scheduler reconciliation;
- dashboards, alerts, and billing budgets;
- optional external HTTPS load balancer/serverless NEG only if hostname decision requires it;
- private versioned Terraform state bucket.

## Containers and Build

- One multi-stage Dockerfile with separate web/API and exact Playwright worker targets.
- API image contains Vite `dist`, Express runtime, and no Chromium layer.
- Worker image pins the exact Playwright/browser version and runs non-root.
- Both images use Node 24/pnpm 11 and frozen lockfile.
- `.dockerignore` excludes `.env`, debug data, screenshots, local artifacts, `.git`, and test outputs not required at runtime.
- Cloud Build creates images once, produces SBOM/provenance, records the active
  scanning-disabled risk acceptance, deploys exact digests to staging, and
  requires manual production promotion.

## IAM Tests

Run tests as deployed principals:

- public cannot invoke worker;
- browser cannot list/read Firestore or Storage directly;
- API cannot read OpenRouter secret or invoke worker directly unless explicitly required;
- worker cannot create tasks or sign public upload policies;
- task-invoker can invoke only worker;
- scheduler identity is accepted only by reconciliation route;
- build/deploy identities have only required `actAs` scope;
- no default Editor/Owner runtime accounts.

For executable identities, use actual Cloud Run, Cloud Build, or approved
keyless deployment credentials. Directly exercise read-only denials and use
identity-authenticated `testIamPermissions` for denied mutating permissions;
do not call task creation, pause, or purge as a negative test because
unexpected success would mutate the queue.

Task-invoker and scheduler-invoker are used only for OIDC in the Palette
architecture and are not attached to general test compute. Validate each
through its real service-mediated OIDC path, including exact issuer,
subject/email, audience, and target restrictions, and combine that with
effective-policy evidence of queue denial. Do not add keys, Token Creator
grants, federation bindings, or artificial Scheduler/Tasks jobs solely to
manufacture queue API credentials.

## Likely Files

- `infra/terraform/**`
- environment `.tfvars.example` files without secrets
- `Dockerfile`
- `.dockerignore`
- `cloudbuild.yaml`
- `.env.example`
- `scripts/smoke.mjs`
- `scripts/rollback.mjs`
- `scripts/redrive-job.mjs`
- `scripts/purge-user.mjs`
- `docs/runbooks/**` or `prodPlans/runbooks/**`

## Tests

- `terraform fmt`, `validate`, plan policy review;
- resource location and IAM assertions;
- queue settings/deadline/retry inspection;
- direct unauthenticated and wrong-identity worker invocation denial, plus a
  valid synthetic task OIDC invocation;
- exact worker image launches sandboxed Chromium;
- API image serves root/assets/SPA/API JSON 404 with correct cache headers;
- secret scan source, Terraform plan/state exposure, build args, image layers, and runtime env logs;
- staging upload/job/cancel/artifact smoke;
- Cloud Run SIGTERM behavior;
- rollback to previous digest;
- budget/monitoring alert delivery.

## Implementation Cautions

- Do not put secret values in Terraform state or Cloud Build substitutions.
- Free-tier limits are billing allowances, not safety controls.
- Keep API/worker minimum instances zero initially unless measured latency justifies cost.
- Match Tasks dispatch concurrency to worker max instances.
- Cloud Run and Tasks timeouts must remain ordered around the application deadline.
- Region changes after data creation are migration work; confirm before apply.
- Do not enable public worker invocation for convenience.
- Keep H6-B validation revisions inaccessible to cohort traffic and remove
  them only through the preapproved cleanup boundary after evidence is
  retained.

## Completion Gate

- Terraform can create/destroy staging reproducibly.
- IAM positive/negative tests pass using real identities.
- H6-A recovery is recorded and H6-B deployed-principal validation passes.
- Images are pinned, covered by the active H5 scan or scanning-disabled risk-
  acceptance path, non-root, secret-free, and deployed by digest.
- Staging smoke, OIDC, Chromium, static routing, and rollback pass.
- Alerts reach named recipients.

## Rollback

Infrastructure changes remain additive through launch. Roll back service revisions/digests, pause queue when execution is unsafe, and preserve Firestore/Storage state. Destructive Terraform plans require explicit approval.
