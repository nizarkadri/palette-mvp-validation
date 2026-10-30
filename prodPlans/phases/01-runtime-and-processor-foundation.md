# Phase 01 — Runtime and Processor Foundation

- **Status:** In progress
- **Depends on:** Phase 00
- **Unblocks:** Chromium hardening, API service, worker

## Goal

Make builds reproducible and separate AI/render orchestration from Vite/raw HTTP
handlers. Preserve observable behavior except for the explicitly approved
three-variant terminal-success correction below. Every expensive operation must
accept cancellation, deadlines, call budgets, progress/event reporting,
logging, canonical artifact storage, and checkpoint seams.

## Current Codebase Context

- `server/plugin.js` mounts six raw Node handlers into Vite Connect middleware.
- `server/routes/analyze-stream.js` owns NDJSON and starts three variants with `Promise.allSettled`.
- `server/routes/analyze.js`, `categorize.js`, `improve-variant.js`, and `custom-swatch.js` mix HTTP concerns with orchestration and debug persistence.
- `server/services/openRouter.js` is the central provider boundary.
- `server/services/screenshotGenerator.js`, `visualVerifier.js`, and `categorization.js` contain reusable domain work but depend on process-global provider/browser/debug behavior.
- `server/utils/debug.js` writes sensitive local artifacts.
- Current routes manually consume request streams through `server/utils/stream.js`; do not place them behind Express JSON parsing.
- `/api/analyze-stream` now emits `complete` only after exactly three stable,
  evaluated variants; partial or total variant failure ends with a safe error.
- `src/lib/aiAnalysis.js` now rejects truncated, partial, duplicate-indexed,
  malformed, or otherwise incomplete terminal streams.
- Categorization and visual verification currently convert broad error classes
  into fallback results, including errors that will become control flow.
- The improvement route currently accepts a browser-provided raw model ID.

## Completed in This Phase

- pnpm is authoritative; `package-lock.json` removed.
- Node 24 and pnpm 11 engines declared.
- Playwright pinned to resolved `1.61.1`.
- Frozen pnpm install verified.
- `callOpenRouter()` now has a default 120-second timeout and optional caller `AbortSignal`.
- JSON repair accepts timeout/cancellation options.
- OpenRouter request-shape, default/configured timeout, cancellation, and repair
  propagation tests added without wall-clock timing.
- Pre-extraction fixtures cover raw route method/status/header/input behavior,
  NDJSON causality and failures, client chunking/terminal validation,
  categorization fallback, improvement model precedence, custom-swatch schema,
  and development debug filesystem compatibility.
- The approved all-three terminal correction is active in streaming analysis,
  legacy `generateVerifiedHtml()`/`/api/analyze`, and the frontend stream client;
  non-three variant-count configuration fails before provider dispatch.
- Variant and unexpected route failures expose safe public messages while
  available development diagnostics retain detailed causes.
- Client completion fires only after a last-event terminal contract validates;
  evaluation-before-generation and post-complete events fail.
- Equal-score selection, final results, and incremental UI state resolve by
  stable variant index rather than concurrent completion order.
- Partial Steps 1/4/6 foundation now exists under `server/shared/`: stable
  control-flow errors, explicit/effective deadline helpers, immutable processor
  context validation, process-wide FIFO abort/deadline-aware semaphores, an
  attempt-bound conservative in-memory provider ledger, and a provider request
  coordinator with non-masking cleanup.
- The coordinator propagates both explicit deadlines, their effective earlier
  value, the capped timeout, signal, and pinned frozen model-profile data.
- These primitives are not wired into production routes/services yet. Events,
  progress aggregation, concrete diagnostics/artifact/checkpoint ports,
  server-owned model-profile allowlisting, and processor extraction remain.

## Remaining Implementation

### 0. Characterize behavior and correct terminal semantics

> **Characterization/terminal gate completed 2026-07-29.** The control-flow
> error taxonomy referenced below remains part of Steps 1–3 and must be in place
> before processor extraction is considered complete.

Before moving orchestration, freeze the current route/client behavior with
fixtures covering:

- method, status, header, and safe-error behavior;
- NDJSON event order and generation, evaluation, failure, and completion events;
- one/two variant failures and total variant failure;
- a stream ending without a terminal event;
- categorization fallback;
- improvement model selection;
- development debug output compatibility;
- stable indexing when variants finish out of order.

After characterization, intentionally correct the legacy analysis contract:

- every non-control-flow processor result contains exactly three outcomes with
  stable indexes `0`, `1`, and `2` and status `complete` or `failed`;
- production and the legacy route count analysis as successful only when all
  three outcomes are complete;
- the route emits terminal `complete` only after all three complete outcomes
  exist; any variant failure produces a terminal safe error after the indexed
  failure events are emitted;
- the client must observe terminal `complete` with exactly three complete,
  uniquely indexed variants; EOF/truncation without it is an error;
- cancellation, deadline, budget, lease/fence, and shutdown errors abort by
  throwing rather than being converted into variant outcomes.

This is an intentional compatibility change required by the production
contract. Preserve all other characterized route behavior. Tightening terminal
validation in `src/lib/aiAnalysis.js` is allowed; a broader frontend transport
rewrite is not.

### 1. Define the processor context and transport-neutral ports

> **Status: partial.** Execution-control context, deadlines, errors, semaphores,
> and the attempt-local provider ledger/coordinator are implemented and tested.
> Transport-neutral events/progress and concrete diagnostics, artifact, and
> checkpoint ports remain before this step is complete.

Add a small immutable shared context contract, preferably JSDoc-backed
JavaScript first:

```text
job/attempt identity
AbortSignal
applicationDeadlineAt
absoluteJobDeadlineAt
effective processor deadline = earlier of those values
per-attempt provider ledger and configured call/token/cost ceilings
server-owned model profile/revision
logger
reportProgress(stage, percent, safeMessage)
emitProcessorEvent(event)
diagnostics
artifactStore
checkpointStore
clock
```

`emitProcessorEvent` carries versioned generation, evaluation, failure, and
completion events without knowledge of NDJSON, Express, Firestore, or Cloud
Tasks. Concurrent variants preserve causal ordering within each variant, while
events from different variants may interleave. Individual variants never emit
global percent directly.

One progress aggregator consumes processor events and calls `reportProgress`.
Only that aggregator emits bounded, monotonic, non-sensitive global progress.
Legacy routes map processor events to NDJSON; the future worker maps aggregated
progress to the job record and writes only validated resumable stages as
checkpoints.

Keep three separate persistence ports:

- `diagnostics`: optional redacted diagnostics; local development may write
  files while production is no-op or metadata-only;
- `artifactStore`: canonical HTML, screenshots, evaluations, manifests, and
  other processor outputs;
- `checkpointStore`: immutable, validated, provenance-bound checkpoints only.

Phase 01 may provide no-op `diagnostics`. Whenever `artifactStore` or
`checkpointStore` is exercised, Phase 01 must use create-only in-memory
implementations that reject duplicate writes; `checkpointStore` must also reject
partial, unvalidated, or provenance-mismatched checkpoints. Phase 03 supplies
the durable Firestore/Storage implementations. Diagnostics must never discard
or stand in for a canonical artifact or checkpoint.

### 2. Extract processors by job kind

Create HTTP-independent modules under `server/pipeline/`:

- `processAnalysis`
- `processCategorization`
- `processImprovement`
- `processCustomSwatchAnalysis`

Routes become adapters that parse input, create a local context, map processor
events to the existing response transport, and format the final result.
Processors must not import HTTP request/response types or write NDJSON.

### 3. Propagate context and preserve control-flow errors

Pass `AbortSignal`, `applicationDeadlineAt`, `absoluteJobDeadlineAt`, and the
effective processor deadline (the earlier timestamp) through:

- every `callOpenRouter()` call;
- JSON repair;
- generation, regeneration, and tool loops;
- visual evaluation and correction;
- categorization;
- browser launch, page, render, and screenshot waits;
- artifact/checkpoint writes and cleanup where supported.

Use effective remaining time for every semaphore wait, provider timeout, stage
wait, artifact/checkpoint write, and supported cleanup operation. Check
cancellation/deadline before and after every expensive `await`. Define a
shared control-flow error taxonomy for cancellation, deadline, budget,
lease/fence loss, and shutdown. These errors are always rethrown through routes,
processors, categorization, rendering, evaluation, and cleanup. Only named,
explicitly degradable provider/render failures may use a documented fallback.

### 4. Make model selection and provider budgets server-owned

- Processors receive an immutable server-owned model-profile object and
  revision, never a request-provided model-ID string.
- The legacy improvement adapter may map known existing IDs through an exact
  server allowlist; unknown IDs fail safely and are never passed through.
- Keep the job admission/cost reservation separate from provider accounting.
  Admission reserves user/global active-job and worst-case cost capacity before
  task dispatch; processors do not spend or reconcile that reservation.
- Give each worker attempt its own provider ledger bounded by the job kind's
  call/token/cost ceilings.
- Before every provider request is dispatched, atomically reserve one call plus
  that request's worst-case token/cost exposure in the attempt ledger.
- Reconcile afterward only from trusted usage. Retain the conservative worst-
  case reservation when usage is missing/incomplete or the request may have
  reached the provider; release only when it is known the request was not
  dispatched.
- Count every generation, tool turn, repair, regeneration, evaluation,
  correction, and transport retry as a separate ledger entry.
- Bound each provider-call timeout by the smaller of its configured timeout and
  the effective remaining processor time.
- Make OpenRouter referer/title configurable from validated server config later;
  do not allow request-controlled provider URLs.
- Classify provider errors without logging raw payloads.

### 5. Separate diagnostics, artifacts, and checkpoints

Replace direct `process.cwd()/debug` coupling with the three ports above.
Canonical HTML, screenshots, evaluations, and manifests always use
`artifactStore`; validated resumable stages use `checkpointStore`; optional
redacted development traces use `diagnostics`. Cleanup executes in `finally`.
If primary work and cleanup both fail, retain/rethrow the primary error and log
the cleanup failure as secondary; cleanup must never mask the primary error.

### 6. Bound all provider and render concurrency

- Use one process-wide, abort-aware provider semaphore, initially limit `2`,
  around every provider call, including generation, tools, repair,
  regeneration, evaluation, correction, and transport retry.
- Use one process-wide, abort-aware render semaphore, initially limit `1`,
  around browser/page/render/screenshot work.
- Queued acquisition must observe cancellation and the effective remaining
  processor time derived from both deadline fields.
- After acquisition, reserve budget immediately before the provider attempt;
  release every permit in `finally`, including when reservation fails.
- Preserve exactly three stable variant indexes and deterministic tie-breaking.
- Do not assume Cloud Run concurrency `1` bounds work inside one process.

## Likely Files

Modify:

- `server/routes/analyze-stream.js`
- `server/routes/analyze.js`
- `server/routes/categorize.js`
- `server/routes/improve-variant.js`
- `server/routes/custom-swatch.js`
- `server/services/openRouter.js`
- `server/services/screenshotGenerator.js`
- `server/services/visualVerifier.js`
- `server/services/categorization.js`
- `server/services/browserPool.js`
- `server/utils/debug.js`
- `server/constants.js`
- `src/lib/aiAnalysis.js`

Create:

- `server/shared/processorContext.js`
- `server/shared/errors.js`
- `server/shared/deadlines.js`
- `server/shared/controlFlow.js`
- `server/shared/semaphore.js`
- `server/shared/modelProfiles.js`
- `server/pipeline/events.js`
- `server/pipeline/ports.js`
- `server/pipeline/analysis.js`
- `server/pipeline/categorization.js`
- `server/pipeline/improvement.js`
- `server/pipeline/customSwatch.js`
- `server/pipeline/artifacts.js`
- focused tests under `server/pipeline/__tests__/`

## Tests

### Characterization tests before extraction

- legacy route method/status/header/safe-error behavior;
- exact NDJSON event order and terminal-event requirements;
- current partial and total variant failure behavior;
- stream truncation before `complete`;
- categorization fallback boundaries;
- exact improvement model-selection behavior;
- development debug compatibility;
- out-of-order variant completion with stable indexes.

### Required unit tests

- processor returns exactly three stable indexed outcomes;
- all-three success, one/two failures, and total failure terminal semantics;
- EOF without `complete` and malformed/duplicate/missing variant indexes fail;
- per-variant event order is causal while cross-variant events may interleave;
- only the progress aggregator emits bounded, monotonic, redacted global
  progress;
- event mapping preserves generation/evaluation/failure/completion order per
  variant;
- timeout and external cancellation at every provider/browser boundary;
- control-flow errors are rethrown through every fallback site;
- explicitly degradable provider/render failures alone use fallback behavior;
- admission reservation and per-attempt provider ledger remain separate;
- each provider request reserves one call plus worst-case token/cost exposure
  before dispatch and prevents an extra generation, tool, repair, regeneration,
  evaluation, correction, or retry;
- trusted usage reconciles the ledger, while missing usage or possible provider
  receipt retains the conservative reservation;
- `applicationDeadlineAt` and `absoluteJobDeadlineAt` are both propagated, and
  each call timeout/semaphore wait is capped by their effective remaining time;
- unknown browser-provided model IDs are rejected; known IDs map to immutable
  server-owned profiles;
- stable variant ordering when promises complete out of order;
- deterministic tie-breaking;
- queued semaphore acquisition aborts on cancellation/deadline;
- every provider call shares the configured process-wide limit;
- every render operation shares the process-wide limit of one;
- permits release after success and every failure path;
- cleanup runs after success, cancellation, provider failure, and browser
  failure without masking the primary error;
- diagnostics cannot replace canonical artifacts/checkpoints;
- diagnostics may be no-op, but exercised in-memory artifact/checkpoint stores
  are create-only and reject duplicate writes;
- in-memory checkpoints reject partial, unvalidated, or provenance-mismatched
  values;
- production diagnostics write no sensitive payload while canonical memory
  adapters retain required outputs.

### Compatibility tests

- legacy route method/status/error behavior remains stable except for the
  intentional all-three terminal-success correction;
- `/api/analyze-stream` emits parseable NDJSON and terminal `complete` only for
  exactly three complete indexed variants;
- truncated streams and partial variant results never count as client success;
- categorization, improvement, and custom-swatch schemas remain compatible;
- palette interaction tests prove no AI calls.

### Validation commands

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm test
pnpm build
```

Run LSP/pi-lens on every touched source file.

## Implementation Cautions

- Do not move current raw handlers behind `express.json()`.
- Do not rewrite frontend transport in this phase beyond requiring terminal
  `complete` with exactly three indexed variants and rejecting truncated or
  partial streams.
- Do not change prompts or output schemas while extracting processors unless a failing security gate requires it.
- Do not make `AbortSignal` optional inside processors; only legacy adapters may create a local fallback signal.
- Never convert cancellation, deadline, budget, lease/fence, or shutdown errors
  into a fallback value, failed variant, or successful terminal response.
- Never pass a client-provided raw model ID into a processor/provider call.
- Avoid broad dependency injection frameworks; plain objects/functions are sufficient.
- Preserve current development behavior and debug capability through adapters.
- A timeout is not a retry policy. Do not add automatic provider retries until budgets and classification are tested.
- Current `App.jsx` is large and stateful; do not mix UI refactoring into this backend extraction.

## Completion Gate

- Characterization fixtures exist before orchestration moves.
- All expensive processors are callable without HTTP request/response objects.
- Analysis exposes exactly three stable indexed outcomes and succeeds only when
  all three are complete.
- Legacy/client stream success requires terminal `complete`; truncation and
  partial outcomes fail.
- Progress/events are transport-neutral, preserve causal per-variant ordering,
  and use one aggregator for monotonic global progress before NDJSON mapping.
- Both explicit deadlines and their effective earlier value reach every wait;
  signals, provider ledgers, and control-flow errors reach every provider and
  browser stage without being swallowed.
- Every provider/render call uses the process-wide abort-aware semaphores;
  provider work uses the separate per-attempt conservative ledger rather than
  the job admission reservation.
- Processors accept only immutable server-owned model profiles.
- Diagnostics, canonical artifacts, and immutable checkpoints use distinct
  ports; diagnostics may be no-op, while exercised artifact/checkpoint stores
  are create-only and production diagnostics cannot discard canonical outputs.
- Legacy route fixtures remain compatible except for the approved terminal-
  success correction.
- Full tests and build pass from frozen install.

## Rollback

Keep legacy route adapters and existing service functions until processor
equivalence is proven. Characterization tests must survive each extraction
commit. Processor extraction remains reversible per job kind; do not remove old
adapters in the same change that introduces the new pipeline. Do not roll back
to partial/truncated stream success after the client and route adopt the
production all-three terminal contract without a separate explicit decision.
