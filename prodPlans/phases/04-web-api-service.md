# Phase 04 — Public Web and Control API Service

- **Status:** Not started
- **Depends on:** Phases 01 and 03
- **Unblocks:** frontend migration and deployed job creation

## Goal

Build the public Express 5 Cloud Run service that serves the Vite application and performs only short, authenticated control-plane work.

## Related Codebase

- `vite.config.js` and `server/plugin.js` currently host legacy API middleware.
- Existing route handlers manually read raw request streams.
- `src/lib/aiAnalysis.js` calls relative `/api/*` routes.
- The Vite build outputs hashed assets in `dist/assets` and a SPA `index.html`.
- ColorBrain uses multiple external providers and needs HTTPS/timeouts/schema bounds.

## Implementation

1. Add Express 5 application factory and production entry point.
2. Register `/healthz` and `/readyz`.
3. Register `/api/v1` router with scoped `express.json({ limit: "64kb" })`.
4. Register `/internal/reconcile` with separate GCP service-account OIDC middleware and bounded parser.
5. Keep legacy raw-stream routes outside parsed routers while compatibility is
   required; preserve the Phase 01 requirement that stream success needs
   terminal `complete` with exactly three complete indexed variants.
6. Add request IDs, redacted logging, security headers, safe errors, and graceful SIGTERM.
7. Verify Identity Platform bearer tokens and disabled/revoked users.
8. Enforce ownership, schemas, quotas, admission, idempotency, and kill switch.
9. Implement upload authorization/finalization, job create/get/cancel, artifact
   authorization, and ColorBrain. Job creation resolves allowed model-profile
   enums to immutable server-owned profiles/revisions, sets
   `absoluteJobDeadlineAt`, creates the job admission active/cost reservation,
   and rejects raw model IDs. It does not create or reconcile a provider ledger.
10. Enqueue deterministic tasks after durable Firestore acceptance; reconciliation repairs pending dispatch.
11. Serve immutable hashed assets, no-cache `index.html`, GET/HEAD SPA fallback, and JSON API/internal 404s.
12. Ensure public image/dependency tree has no Playwright browser and no OpenRouter secret.

## Likely Files

Create:

- `server/api/app.js`
- `server/api/index.js`
- `server/api/routes/{health,uploads,jobs,artifacts,colorbrain,reconcile}.js`
- `server/api/middleware/{identity,schedulerOidc,errors,requestContext,validation}.js`
- `server/api/static.js`

Modify:

- `package.json` scripts/dependencies;
- `vite.config.js` local proxy/development strategy;
- `server/routes/colorbrain.js` and color-source adapters;
- `server/plugin.js` only for temporary compatibility.

## Tests

- exact endpoint/status/header/error contract;
- analysis job acceptance preserves exactly-three outcome semantics and rejects
  raw or unknown model IDs;
- valid, expired, revoked, disabled, wrong-project Identity tokens;
- wrong-owner resource returns safe 404;
- valid/wrong-audience/wrong-service-account scheduler OIDC;
- scoped parser works and legacy raw body remains readable;
- malformed/oversized JSON returns deterministic 400/413;
- idempotent replay/conflict and Firestore-write/task-enqueue crash window;
- quota/admission and kill switch;
- job acceptance sets `absoluteJobDeadlineAt` and job admission reservation but
  no per-attempt provider-ledger usage;
- upload and artifact path/generation enforcement;
- GET/HEAD static caching, missing asset, path traversal, root and SPA fallback;
- unknown API/internal routes return JSON;
- ColorBrain HTTPS-only provider timeout/schema/fallback;
- SIGTERM stops accepting new requests and exits within grace;
- API container contains no Chromium or OpenRouter secret.

## Implementation Cautions

- Do not register global `express.json()` before legacy raw handlers.
- API service must never run paid analysis inline or reconcile provider usage.
  Its cost reservation is admission capacity only; worker attempts own provider
  ledgers.
- Never persist or dispatch a browser-provided model ID; resolve an allowed enum
  to the server-owned profile/revision before durable acceptance.
- Reconciliation uses Google service-account OIDC, not Identity Platform middleware.
- Origin/CORS is not authorization; direct Cloud Run URL must enforce identical auth/quotas.
- Do not proxy image bytes through Express.
- A Firestore-accepted job remains accepted even if initial task enqueue fails.
- Between this phase and Phase 07, staging is API-contract-only unless the legacy UI is explicitly disabled or protected.

## Completion Gate

- API integration suite passes against repositories/emulators.
- Static/SPA and API routing are exact.
- Identity/scheduler authentication boundaries pass positive and negative tests.
- API remains responsive under worker saturation simulation.
- Slim API image has no browser/provider secret.

## Rollback

Deploy additively beside legacy routes. Keep old UI flow disabled/protected until Phase 07. Roll back via Cloud Run revision without destructive schema changes.
