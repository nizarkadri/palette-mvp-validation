# Cloud Run API Migration Assessment and Test Cases

Source plan assessed: [`cloud-run-api-migration-plan.md`](./cloud-run-api-migration-plan.md)

## Executive Assessment

The migration plan is directionally sound for a first production step: it preserves the current frontend contract, keeps local Vite development intact, serves frontend and API from one Cloud Run service, and explicitly defers the larger job/queue redesign.

The highest-risk areas are not the route extraction itself; they are production-server parity, Playwright/Chromium runtime reliability, OpenRouter header/env handling, and Cloud Run operational limits for long synchronous requests.

Recommended status: **approved with required test coverage and a few plan clarifications before implementation.**

## Strengths

- Preserves all existing relative frontend API paths:
  - `POST /api/analyze-stream`
  - `POST /api/analyze`
  - `POST /api/categorize`
  - `POST /api/improve-variant`
  - `POST /api/custom-swatch/analyze`
  - `POST /api/colorbrain/anchors`
- Keeps local Vite workflow unchanged.
- Correctly uses a server-side API key model.
- Uses a Playwright-ready Docker base image, which is the safest first production choice.
- Sets conservative Cloud Run `concurrency: 1` for Chromium-heavy work.
- Avoids prematurely adding Cloud Tasks, Firestore, polling, auth, or API redesign.

## Required Clarifications Before Implementation

### 1. Production server implementation strategy

The plan should specify whether `server/index.js` uses:

- native Node `http`,
- `connect`/`sirv`, or
- `express`.

The current route handlers are Connect-style `(req, res)` functions, so either native dispatch or Connect-style middleware is enough. If Express is chosen, add it explicitly to dependencies and test route behavior through Express.

### 2. Static frontend and SPA fallback behavior

Production server must define exact behavior for:

- `GET /` -> serves `dist/index.html`
- `GET /assets/...` -> serves built assets with correct content type
- `GET /some/client/route` -> serves `dist/index.html` for SPA fallback
- unknown `/api/*` -> returns JSON `404`, not `index.html`

This is a common migration bug and needs explicit tests.

### 3. API mount order

`/api/custom-swatch/analyze` and `/api/analyze-stream` must not be shadowed by broader route checks such as `/api/analyze`.

Production route dispatch must prefer exact path matching or longest-prefix matching with tests.

### 4. Environment loading

Local production mode should load `.env` for `PORT=8080 pnpm start`, but Cloud Run should rely on injected environment variables and Secret Manager.

The plan should specify the mechanism, for example:

- use `dotenv/config` only for local start, or
- implement a small `loadServerEnv()` helper that does not override Cloud Run-provided env vars.

### 5. OpenRouter app headers

`server/services/openRouter.js` currently hardcodes:

```txt
HTTP-Referer: http://localhost:5173
X-Title: UI Palette Explorer
```

The migration must make these configurable through:

```txt
APP_PUBLIC_URL
OPENROUTER_APP_TITLE
```

Tests should verify both defaults and overrides.

### 6. Health check definition

`GET /healthz` should be lightweight and not require OpenRouter, Playwright, or `dist/` to be available.

Recommended response:

```json
{ "ok": true, "service": "ui-palette-explorer", "version": "0.1.0" }
```

### 7. Docker image hygiene

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

Do not bake `OPENROUTER_API_KEY` into the image.

### 8. Cloud Run timeout tradeoff

A 900s timeout supports current synchronous/streaming behavior, but it increases cost exposure and user wait time. This is acceptable for the first migration only because the plan explicitly defers queue/job architecture.

Add a note that production monitoring should track:

- request duration,
- memory usage,
- Chromium launch failures,
- OpenRouter error rate,
- request timeout count,
- Cloud Run instance count,
- cost per analysis.

## Recommended Plan Amendments

Add these acceptance checks to the original plan:

1. Production server serves API JSON errors for unknown `/api/*` paths.
2. Production server supports SPA fallback for non-API routes.
3. All API routes are mounted through one shared helper used by both Vite and production server.
4. Route path matching is exact or tested against path-shadowing regressions.
5. `APP_PUBLIC_URL` and `OPENROUTER_APP_TITLE` override OpenRouter headers.
6. `OPENROUTER_API_KEY` is never included in frontend bundle, static assets, Docker build args, logs, or docs.
7. Docker run smoke test verifies Chromium can start, not only that the HTTP server boots.
8. Cloud Run deployment docs include Secret Manager command examples.

## Test Coverage Strategy

Use a layered test strategy:

1. **Unit tests** for pure route registration, env defaults, OpenRouter headers, and body parsing.
2. **Server integration tests** against `server/index.js` using local HTTP requests and mocked route handlers/services.
3. **Production build smoke tests** using `pnpm build` + `PORT=8080 pnpm start`.
4. **Docker smoke tests** using `docker build` + `docker run`.
5. **Cloud Run post-deploy smoke tests** against the deployed URL.
6. **Manual E2E checks** for the AI/Chromium-heavy paths when a real `OPENROUTER_API_KEY` is available.

## Proposed Automated Test Files

```txt
server/__tests__/apiRoutes.test.js
server/__tests__/productionServer.test.js
server/__tests__/openRouterHeaders.test.js
server/__tests__/staticServing.test.js
server/__tests__/routeCompatibility.test.js
server/routes/__tests__/routeMethodAndValidation.test.js
```

If implementation keeps `server/index.js` hard to import without listening, split app creation from process startup:

```txt
server/createServer.js   # exports createServer(env, options)
server/index.js          # loads env and calls listen()
```

This makes integration tests reliable.

## Full Coverage Test Cases

### A. Shared API route mounting

| ID | Case | Expected result |
| --- | --- | --- |
| A1 | `mountApiRoutes` registers all six current API paths | Exact paths are registered once each |
| A2 | Route registration order is stable | `custom-swatch/analyze` and `analyze-stream` are not shadowed by `/api/analyze` |
| A3 | `server/plugin.js` delegates to shared mounting helper | Vite dev behavior uses same route table as production |
| A4 | Shared helper passes the same `env` object to env-dependent routes | `createAnalyzeRoute`, `createCategorizeRoute`, etc. receive expected env |
| A5 | `createColorBrainRoute` is mounted without requiring env | ColorBrain endpoint still works without OpenRouter env |

### B. Production server boot and health

| ID | Case | Expected result |
| --- | --- | --- |
| B1 | `GET /healthz` | `200`, JSON body, no API key required |
| B2 | Server listens on `process.env.PORT` | Test with random/free port and explicit `PORT` |
| B3 | Server defaults to `8080` when `PORT` is absent | Startup uses fallback value |
| B4 | Startup does not crash when optional OpenRouter vars are absent | Server boots; OpenRouter endpoints fail only when called |
| B5 | Startup does not print secrets | Logs do not contain `OPENROUTER_API_KEY` value |

### C. Static frontend serving

| ID | Case | Expected result |
| --- | --- | --- |
| C1 | `GET /` after `pnpm build` | returns `dist/index.html` with `text/html` |
| C2 | `GET /assets/<built-js>` | returns JS asset with correct content type/cache-safe behavior |
| C3 | `GET /assets/<built-css>` | returns CSS asset with correct content type |
| C4 | `GET /non-api/client-route` | returns `index.html` for SPA fallback |
| C5 | `GET /favicon.ico` or missing static asset | returns static asset if present or sane 404, not API JSON error |
| C6 | `GET /api/unknown` | returns JSON `404`, not `index.html` |
| C7 | `POST /api/unknown` | returns JSON `404`, not `index.html` |

### D. API method validation parity

For every preserved API route:

```txt
/api/analyze-stream
/api/analyze
/api/categorize
/api/improve-variant
/api/custom-swatch/analyze
/api/colorbrain/anchors
```

| ID | Case | Expected result |
| --- | --- | --- |
| D1 | `GET` route | `405`, `Allow: POST`, JSON error |
| D2 | `PUT` route | `405`, `Allow: POST`, JSON error |
| D3 | `OPTIONS` route, if supported | deterministic response; document if unsupported |
| D4 | malformed JSON body | JSON error response; server remains alive |
| D5 | oversized body > 15 MB | JSON error or connection close without server crash |
| D6 | valid JSON body reaches the correct handler | Handler-specific response |

### E. API path compatibility

| ID | Case | Expected result |
| --- | --- | --- |
| E1 | Frontend code still uses relative `/api/...` paths | No hardcoded Cloud Run URL in `src/` |
| E2 | No `OPENROUTER_API_KEY` reference in `src/` or built `dist/assets` | Secret remains server-only |
| E3 | Production server accepts the same request shapes as Vite dev | No frontend API redesign required |
| E4 | Production and Vite route maps are identical | Same exact path list in tests |
| E5 | `/api/analyze-stream` is routed to streaming handler, not `/api/analyze` | NDJSON content type observed |

### F. OpenRouter env/header behavior

| ID | Case | Expected result |
| --- | --- | --- |
| F1 | No `APP_PUBLIC_URL` configured | `HTTP-Referer` defaults to `http://localhost:5173` |
| F2 | No `OPENROUTER_APP_TITLE` configured | `X-Title` defaults to `UI Palette Explorer` |
| F3 | Production `APP_PUBLIC_URL` configured | OpenRouter request uses configured referer |
| F4 | Production `OPENROUTER_APP_TITLE` configured | OpenRouter request uses configured title |
| F5 | Missing `OPENROUTER_API_KEY` on OpenRouter-backed endpoints | Endpoint returns JSON error and does not call OpenRouter |
| F6 | OpenRouter upstream returns non-JSON error | Endpoint returns meaningful error and server remains alive |
| F7 | OpenRouter upstream returns `finish_reason: error` | Error is propagated cleanly |
| F8 | OpenRouter response has text-array content | Text is extracted correctly |

### G. Endpoint-specific tests

#### `/api/colorbrain/anchors`

| ID | Case | Expected result |
| --- | --- | --- |
| G1 | valid `source: colormind`, `count: 2` | returns two anchor palettes |
| G2 | valid `source: mixed` with partial external failures | returns successful anchors and diagnostics |
| G3 | invalid source | `400`, allowed source list |
| G4 | external sources all fail | local fallback palettes and `fallbackUsed: true` |
| G5 | missing body | valid default mixed/fallback behavior |
| G6 | count below/above allowed bounds | count is clamped |

#### `/api/analyze-stream`

| ID | Case | Expected result |
| --- | --- | --- |
| G7 | missing API key | `500` JSON error before stream starts |
| G8 | missing `base64` | NDJSON `error` event then close |
| G9 | valid request with mocked candidate generation | NDJSON events include `progress`, `variant.generated`, `variant.evaluated`, `complete` |
| G10 | one variant fails but others succeed | emits `variant.failed` and final `complete` if at least one success |
| G11 | all variants fail | emits final error event or clear failure response |
| G12 | client can parse one event per line | content type is `application/x-ndjson; charset=utf-8` |

#### `/api/analyze`

| ID | Case | Expected result |
| --- | --- | --- |
| G13 | missing API key | JSON error |
| G14 | missing `base64` | JSON validation error |
| G15 | mocked successful screenshot generation/categorization | returns `html`, `elements`, debug metadata if expected |
| G16 | generated HTML has no usable body | error path is deterministic |
| G17 | visual evaluation failure | response behavior matches current route contract |

#### `/api/categorize`

| ID | Case | Expected result |
| --- | --- | --- |
| G18 | missing API key | JSON error |
| G19 | missing `html` | validation error |
| G20 | valid mocked categorization | returns `html` and normalized `elements` |
| G21 | model returns invalid JSON then repair succeeds | returns repaired parsed result |
| G22 | model returns invalid JSON and repair fails | clear JSON error |

#### `/api/improve-variant`

| ID | Case | Expected result |
| --- | --- | --- |
| G23 | missing API key | JSON error |
| G24 | missing `html` or `base64` | validation error |
| G25 | valid mocked improvement | returns improved public variant with `html` |
| G26 | custom `modelId` supplied | route uses supplied model safely |
| G27 | correction/evaluation fails | clear JSON error, no server crash |

#### `/api/custom-swatch/analyze`

| ID | Case | Expected result |
| --- | --- | --- |
| G28 | missing API key | JSON error |
| G29 | missing `swatch` | validation error |
| G30 | valid mocked visual result | returns normalized result |
| G31 | model omits optional fields | response fills safe defaults |
| G32 | model returns invalid JSON then repair succeeds | returns normalized repaired result |

### H. Local production command tests

| ID | Case | Expected result |
| --- | --- | --- |
| H1 | `pnpm build` | succeeds |
| H2 | `PORT=8080 pnpm start` | server starts |
| H3 | `curl /healthz` | `200` |
| H4 | `curl /` | frontend HTML |
| H5 | `curl POST /api/colorbrain/anchors` without OpenRouter key | works through fallback/external sources |
| H6 | `curl POST /api/analyze-stream` without OpenRouter key | controlled JSON error |
| H7 | stop server with SIGTERM | process exits cleanly |

### I. Docker tests

| ID | Case | Expected result |
| --- | --- | --- |
| I1 | `docker build -t palette-api .` | image builds |
| I2 | image does not contain `.env` | secret file absent |
| I3 | image does not contain local `node_modules` copy from host | dependencies installed inside image |
| I4 | `docker run -p 8080:8080 --env-file .env palette-api` | server starts |
| I5 | Docker `/healthz` | `200` |
| I6 | Docker `/` | frontend HTML |
| I7 | Docker `/api/colorbrain/anchors` | works |
| I8 | Docker Chromium smoke route or service test | Playwright can launch Chromium in container |
| I9 | container honors `PORT` env | non-8080 container port works internally |

### J. Cloud Run post-deploy smoke tests

Replace `$URL` with the Cloud Run service URL.

| ID | Case | Expected result |
| --- | --- | --- |
| J1 | `GET $URL/healthz` | `200` |
| J2 | `GET $URL/` | frontend loads |
| J3 | browser loads JS/CSS assets | no 404 asset failures |
| J4 | `POST $URL/api/colorbrain/anchors` | valid response |
| J5 | full screenshot analysis with real API key | completes within Cloud Run timeout |
| J6 | concurrent requests > 1 | Cloud Run queues/spawns instances; no Chromium memory crash |
| J7 | cold start request | completes or fails gracefully within acceptable latency |
| J8 | inspect Cloud Run logs | no API key or base64 payload leakage |

### K. Security and secret handling tests

| ID | Case | Expected result |
| --- | --- | --- |
| K1 | grep `src/` for `OPENROUTER_API_KEY` | no matches |
| K2 | grep built `dist/assets` for real key value | no matches |
| K3 | Docker image scan for `.env` and key value | no matches |
| K4 | route errors do not echo request base64 | no raw image data in response/logs |
| K5 | docs recommend Secret Manager for API key | documented |
| K6 | Cloud Run service uses secret env var | deployment config verified |

### L. Regression checks after implementation

| ID | Case | Expected result |
| --- | --- | --- |
| L1 | `pnpm test` | all existing tests still pass |
| L2 | `pnpm build` | production build succeeds |
| L3 | Vite dev server starts | local development preserved |
| L4 | existing ColorBrain tests pass unchanged | route extraction did not regress service logic |
| L5 | existing screenshot/visual verifier tests pass unchanged | Docker/server changes did not affect generation helpers |

## Suggested Vitest Test Names

```txt
server/__tests__/apiRoutes.test.js
  - registers the exact production API route table
  - passes env to all env-backed route factories
  - keeps Vite and production route tables identical

server/__tests__/productionServer.test.js
  - responds to GET /healthz without API env
  - returns JSON 404 for unknown API routes
  - returns 405 for non-POST API methods
  - dispatches analyze-stream before analyze

server/__tests__/staticServing.test.js
  - serves dist/index.html at root
  - serves built assets with content types
  - falls back to index.html for client-side routes
  - does not fallback API routes to index.html

server/__tests__/openRouterHeaders.test.js
  - uses localhost defaults for OpenRouter headers
  - uses APP_PUBLIC_URL and OPENROUTER_APP_TITLE overrides
  - does not include browser-exposed secrets
```

## Minimum Definition of Done

The migration should not be considered complete until all of these pass:

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

Plus, when a real OpenRouter key is available:

```bash
# Manual browser test
# Upload screenshot -> variants stream -> categorize selected variant -> improve variant -> custom swatch analysis
```

## Overall Recommendation

Proceed with the migration, but implement it in small commits matching the original plan and add tests alongside each phase. The most important coverage is production parity: the same API paths must behave the same in Vite dev, local production server, Docker, and Cloud Run.
