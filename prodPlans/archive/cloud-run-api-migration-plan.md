# Cloud Run API Migration Plan

> **Superseded for production architecture.** Preserve this document as migration and compatibility evidence, but use [`production-plan.md`](../production-plan.md) and [`adr/0001-production-architecture.md`](../adr/0001-production-architecture.md) as the canonical production direction.

## Goal

Move the current Vite-dev-only `/api/*` backend into a real production Cloud Run service without changing the current frontend behavior or breaking local development.

This is the first production deployment step. It intentionally keeps the existing synchronous/streaming API design for now, while structuring the backend so a future job/queue architecture can be added later.

Assessment reference: [`cloud-run-api-migration-assessment-and-test-cases.md`](./cloud-run-api-migration-assessment-and-test-cases.md).

## Confirmed Deployment Decisions

- **Cloud provider:** Google Cloud
- **Region:** `us-central1`
- **Initial Cloud Run max instances:** `5`
- **Initial Cloud Run min instances:** `0`
- **Initial variant count:** `3`
- **Frontend + API hosting:** single Cloud Run service serves both the built React app and `/api/*`
- **Rendering approach:** keep current Playwright/Chromium server-side rendering
- **Queue/job system:** not part of this first migration

## Current API Surface To Preserve

The frontend should continue calling the same relative API paths:

```txt
POST /api/analyze-stream
POST /api/analyze
POST /api/categorize
POST /api/improve-variant
POST /api/custom-swatch/analyze
POST /api/colorbrain/anchors
```

No frontend API redesign should be required for this migration.

## High-Level Approach

Current state:

```txt
Vite dev server
  ├─ React app
  └─ Vite plugin mounts /api/* routes
```

Target state:

```txt
Cloud Run service
  ├─ serves built React dist/
  ├─ mounts the same /api/* routes
  ├─ uses server-side OpenRouter API key
  └─ uses Playwright/Chromium for visual rendering/evaluation
```

Local development should still work through Vite.

## Required Clarifications Before Implementation

### Production server strategy

Use **Express** for the production server unless implementation testing shows a strong reason to use native Node or Connect directly.

Add explicit production-server dependencies:

```bash
pnpm add express dotenv
```

`dotenv` is for local production-mode startup only. Cloud Run should use injected environment variables and Secret Manager.

Important body parsing rule:

- Do **not** register global `express.json()` or another body parser before the current API handlers.
- Existing route handlers already read the request stream through `readJsonBody(req)`.
- Consuming the body before those handlers would break `/api/*` routes.

Express is only responsible for:

- exact API route dispatch,
- `/healthz`,
- static `dist/` serving,
- SPA fallback,
- production listening.

### Static frontend and SPA fallback behavior

Production server must implement these exact behaviors:

```txt
GET /                         -> dist/index.html, text/html
GET /assets/...               -> built static assets with correct content type
GET /non-api/client-route     -> dist/index.html for SPA fallback
GET /api/unknown              -> JSON 404, not index.html
POST /api/unknown             -> JSON 404, not index.html
```

Unknown `/api/*` routes must never fall through to the React SPA fallback.

### API route matching and shadowing

The production route dispatcher must avoid route shadowing. In particular:

```txt
/api/custom-swatch/analyze must not be shadowed by any broader route
/api/analyze-stream must not be shadowed by /api/analyze
```

Preferred implementation:

- keep API routes in a shared route table,
- mount each path exactly,
- or use deterministic longest-prefix matching if exact mounting is not possible.

Add tests for `/api/analyze-stream` and `/api/analyze` compatibility.

### Environment loading

Local production mode should load root `.env` for:

```bash
PORT=8080 pnpm start
```

Cloud Run should rely on injected environment variables and Secret Manager.

Implementation should use a safe mechanism such as:

```txt
dotenv/config or loadServerEnv()
```

Requirements:

- local `.env` loading must not override Cloud Run-provided environment values,
- secrets must never be printed,
- missing optional OpenRouter env vars must not crash startup,
- missing `OPENROUTER_API_KEY` should only fail OpenRouter-backed endpoints when called.

### OpenRouter app headers

`server/services/openRouter.js` must stop hardcoding local app headers.

Use:

```txt
APP_PUBLIC_URL
OPENROUTER_APP_TITLE
```

Defaults:

```txt
APP_PUBLIC_URL=http://localhost:5173
OPENROUTER_APP_TITLE=UI Palette Explorer
```

The OpenRouter request headers should resolve to:

```txt
HTTP-Referer: APP_PUBLIC_URL or default
X-Title: OPENROUTER_APP_TITLE or default
```

### Health check definition

`GET /healthz` should be lightweight and must not require:

- OpenRouter,
- Playwright/Chromium,
- `dist/`,
- external network access.

Recommended response:

```json
{ "ok": true, "service": "ui-palette-explorer", "version": "0.1.0" }
```

### Docker image hygiene

`.dockerignore` must exclude at least:

```txt
.env
.git
node_modules
dist
coverage
Screenshots
implementation phases
*.log
```

Do not bake `OPENROUTER_API_KEY` into the Docker image, Docker build args, static assets, docs examples, or logs.

### Long synchronous request monitoring

A 900s Cloud Run timeout is acceptable for this first migration because the current API remains synchronous/streaming. After deployment, monitor:

- request duration,
- memory usage,
- Chromium launch failures,
- OpenRouter error rate,
- request timeout count,
- Cloud Run instance count,
- cost per analysis.

Also remember that Cloud Run container concurrency will be `1`, but `/api/analyze-stream` currently performs internal concurrent work for multiple variants inside a single request. That is acceptable for this first migration, but monitor Chromium memory pressure and OpenRouter parallelism carefully.

If these become problematic, move `/api/analyze-stream` toward the future job/queue architecture described below.

## Implementation Phases

### Phase 1 — Extract Shared API Route Mounting

Create a shared route registration module:

```txt
server/apiRoutes.js
```

Move the route table currently embedded in `server/plugin.js` into this shared file.

Preferred shape:

```js
export const API_ROUTES = [
  ["/api/colorbrain/anchors", createColorBrainRoute],
  ["/api/categorize", createCategorizeRoute],
  ["/api/improve-variant", createImproveVariantRoute],
  ["/api/custom-swatch/analyze", createCustomSwatchRoute],
  ["/api/analyze-stream", createAnalyzeStreamRoute],
  ["/api/analyze", createAnalyzeRoute],
];
```

Expected route mapping:

```txt
/api/colorbrain/anchors      -> createColorBrainRoute(env)
/api/categorize              -> createCategorizeRoute(env)
/api/improve-variant         -> createImproveVariantRoute(env)
/api/custom-swatch/analyze   -> createCustomSwatchRoute(env)
/api/analyze-stream          -> createAnalyzeStreamRoute(env)
/api/analyze                 -> createAnalyzeRoute(env)
```

Then update:

```txt
server/plugin.js
```

to reuse the shared route mounting for Vite dev.

Acceptance:

```bash
pnpm dev
```

still works exactly as before.

Additional acceptance:

- all six current API paths are registered once,
- Vite dev and production server use the same shared route table,
- `/api/analyze-stream` is not routed as `/api/analyze`,
- `/api/custom-swatch/analyze` is not shadowed.

### Phase 2 — Add Production Node Server

Create:

```txt
server/createServer.js
server/index.js
```

Recommended split:

```txt
server/createServer.js   # exports createServer(env, options) for tests
server/index.js          # loads env and calls listen()
```

`createServer` should accept a configurable static directory to make integration tests easier:

```js
createServer(env, { distDir })
```

This allows `staticServing.test.js` to use a temporary fixture directory instead of requiring a real `pnpm build` for every server test.

Responsibilities:

- load production env vars safely,
- mount existing `/api/*` handlers exactly,
- return JSON 404 for unknown `/api/*`,
- serve static frontend from `dist/`,
- support SPA fallback for non-API routes,
- expose `GET /healthz`,
- listen on `process.env.PORT || 8080`.

Add package script:

```json
"start": "node server/index.js"
```

Acceptance:

```bash
pnpm build
PORT=8080 pnpm start
```

Then verify:

```txt
http://localhost:8080/
http://localhost:8080/healthz
POST http://localhost:8080/api/colorbrain/anchors
GET http://localhost:8080/api/unknown
POST http://localhost:8080/api/unknown
```

Expected unknown API behavior:

```json
{ "error": "API route not found." }
```

or an equivalent JSON 404 error. It must not return `dist/index.html`.

### Phase 3 — Production Env Cleanup

Keep existing environment variables:

```txt
OPENROUTER_API_KEY
OPENROUTER_MODEL_ID
OPENROUTER_VARIANT_COUNT
OPENROUTER_VARIANT_MODELS
OPENROUTER_SECONDARY_MODEL_ID
```

Add optional production-friendly variables:

```txt
APP_PUBLIC_URL
OPENROUTER_APP_TITLE
```

Use these in OpenRouter headers instead of hardcoded local values:

```txt
HTTP-Referer: http://localhost:5173
X-Title: UI Palette Explorer
```

Recommended defaults:

```txt
APP_PUBLIC_URL=http://localhost:5173
OPENROUTER_APP_TITLE=UI Palette Explorer
```

Acceptance:

- defaults are used when env vars are absent,
- configured env vars override defaults,
- `OPENROUTER_API_KEY` remains server-only,
- missing API key returns controlled JSON errors from OpenRouter-backed endpoints.

### Phase 4 — Docker / Cloud Run Support

Add:

```txt
Dockerfile
.dockerignore
```

Because this backend uses Playwright/Chromium, prefer a Playwright-ready base image for the first production version to avoid missing Chromium/system dependency issues.

Pin the Playwright base image as closely as practical to the installed Playwright version.

Docker build strategy:

- `.dockerignore` should exclude local `dist/`.
- Therefore the Dockerfile must run `pnpm build` inside the image/build stage.
- Do not write a Dockerfile that depends on a locally prebuilt `dist/` being copied from the host.

Acceptance:

```bash
docker build -t palette-api .
docker run -p 8080:8080 --env-file .env palette-api
```

Then verify the same production server endpoints locally.

Additional Docker acceptance:

- image does not contain `.env`,
- image does not copy host `node_modules`,
- Chromium can launch in the container,
- the app honors `PORT`,
- static app and `/api/*` routes work inside the container.

### Phase 5 — Documentation

Update:

```txt
README.md
.env.example
```

Document:

- local dev command,
- production local command,
- required env vars,
- optional env vars,
- Cloud Run deployment settings,
- Secret Manager recommendation for `OPENROUTER_API_KEY`,
- Secret Manager command examples,
- recommended initial Cloud Run config,
- Docker build/run smoke commands,
- note that the current synchronous/streaming API is phase 1 and may later evolve into jobs/queues.

### Phase 6 — Verification

Before considering the migration complete, run:

```bash
pnpm test
pnpm build
PORT=8080 pnpm start
```

Smoke-test:

- React app loads from production server,
- `GET /healthz` returns healthy JSON,
- `GET /non-api/client-route` returns the React app,
- unknown `/api/*` returns JSON 404,
- `POST /api/colorbrain/anchors` works,
- full screenshot analysis works if `OPENROUTER_API_KEY` is available.

## Blocking Definition of Done

The migration is not complete until these pass:

```bash
pnpm test
pnpm build
PORT=8080 pnpm start
curl -f http://localhost:8080/healthz
curl -f http://localhost:8080/
curl -f -X POST http://localhost:8080/api/colorbrain/anchors \
  -H 'Content-Type: application/json' \
  -d '{"source":"mixed","count":2}'
docker build -t palette-api .
docker run --rm -p 8080:8080 --env-file .env palette-api
```

When a real OpenRouter key is available, also perform a manual browser test:

```txt
Upload screenshot -> variants stream -> categorize selected variant -> improve variant -> custom swatch analysis
```

## Initial Cloud Run Configuration

Use these initial settings:

```txt
region: us-central1
memory: 2GiB–4GiB
cpu: 2
timeout: 900s
container concurrency: 1
min instances: 0
max instances: 5
OPENROUTER_VARIANT_COUNT: 3
```

Reasoning:

- `concurrency: 1` keeps one heavy analysis per container and avoids Chromium memory contention.
- `max instances: 5` caps early production cost and OpenRouter usage.
- `min instances: 0` minimizes idle cost.
- `timeout: 900s` allows long analysis requests to complete.

## Google Cloud Prerequisites

Required:

1. Google Cloud project with billing enabled.
2. Cloud Run API enabled.
3. Artifact Registry enabled.
4. Secret Manager enabled.
5. `OPENROUTER_API_KEY` stored in Secret Manager.
6. Cloud Build enabled if deploying from source/build pipeline.
7. Target region: `us-central1`.

Recommended initial secret/env setup:

```txt
OPENROUTER_API_KEY      Secret Manager
OPENROUTER_MODEL_ID     env var, optional
OPENROUTER_VARIANT_COUNT=3
APP_PUBLIC_URL          production URL after domain is known
OPENROUTER_APP_TITLE=UI Palette Explorer
```

## Recommended Tests To Add During Implementation

Use the full test matrix in the assessment file as the comprehensive checklist. Blocking automated coverage should include at least:

```txt
server/__tests__/apiRoutes.test.js
server/__tests__/productionServer.test.js
server/__tests__/openRouterHeaders.test.js
server/__tests__/staticServing.test.js
```

Minimum automated assertions:

- all six API routes are registered through the shared route table,
- Vite plugin and production server use the same route list,
- `/healthz` returns JSON and needs no external services,
- unknown `/api/*` returns JSON 404,
- static root and assets serve from `dist/`,
- non-API client routes fall back to `index.html`,
- `/api/analyze-stream` is not shadowed by `/api/analyze`,
- OpenRouter header defaults and overrides work,
- no `OPENROUTER_API_KEY` appears in `src/` or built `dist/assets`.

## What This Migration Intentionally Does Not Include

Do not include these in the first Cloud Run migration:

- Cloud Tasks,
- Firestore job model,
- background worker split,
- polling API,
- new `/api/v1/analysis-jobs` API,
- frontend analysis flow redesign,
- auth/quota/rate limit system.

These remain future production-hardening steps.

## Future Production Evolution

Once the current API is running on Cloud Run and real usage is measured, consider moving the expensive analysis flow toward a job-based architecture:

```txt
POST /api/v1/analysis-jobs
  -> returns jobId immediately

GET /api/v1/analysis-jobs/:jobId
  -> canonical job status/result

GET /api/v1/analysis-jobs/:jobId/events
  -> optional SSE progress stream
```

Recommended eventual architecture:

```txt
Firebase Hosting or CDN
Cloud Run API service
Cloud Tasks
Cloud Run Worker service with Chromium
Firestore for job state
Cloud Storage for uploads/artifacts
Secret Manager for API keys
```

But this should be a later step, not part of the initial API extraction.

## Important Implementation Notes

- Preserve current local Vite behavior.
- Preserve all existing API paths.
- Use exact API route mounting or tested longest-prefix matching.
- Do not expose `OPENROUTER_API_KEY` to the browser.
- Keep frontend requests relative, e.g. `/api/analyze-stream`.
- Avoid hardcoding production URLs.
- Do not globally parse JSON before existing API route handlers.
- Keep server route handlers reusable so they can later be called by a worker/job system.
- Prefer small, verifiable commits.

## Suggested Commit Sequence

1. `server: extract shared api route mounting`
2. `server: add production node server for cloud run`
3. `server: make openrouter app headers configurable`
4. `infra: add dockerfile for cloud run deployment`
5. `docs: document cloud run api deployment`
6. `test: verify production server build and route compatibility`
