# Phase 07 — Frontend Durable-Job Migration

- **Status:** Not started
- **Depends on:** Phases 04–06 staging API/worker
- **Unblocks:** user-facing canary

## Goal

Replace base64/NDJSON synchronous analysis with authenticated direct uploads, durable job creation, ETag polling, refresh recovery, artifact access, and cancellation while preserving palette UX.

## Related Codebase

- `src/App.jsx` is a large stateful component containing analysis, variant, palette, custom swatch, persistence, and UI behavior.
- `src/lib/aiAnalysis.js` posts base64/HTML to legacy APIs and consumes NDJSON.
- `src/components/UploadZone.jsx` converts/accepts local image files.
- `VariantPicker.jsx` assumes streamed/generated variants and rendered screenshots.
- Current localStorage can contain large snapshots/HTML and must be narrowed.
- Palette engine/RoleKanban/PaletteStrip behavior is already local and must not regress.

## Implementation

1. Add Identity Platform initialization and sign-in/token refresh abstraction.
2. Add authenticated API client with standard error handling and request IDs.
3. Validate file type/size locally, request signed upload, upload directly, finalize.
4. Create analysis with a client UUID idempotency key.
5. Persist only current job/variant IDs and palette UI state needed for recovery.
6. Poll job with ETag, 2-to-10-second backoff, hidden/offline pause, and refresh resume.
7. Render stable progress and every terminal state.
8. Fetch artifacts through authorized logical artifact endpoints.
9. Create categorization/improvement/custom-swatch jobs by source job/variant references, not resubmitted HTML/base64.
10. Add cancellation and safe retry UX.
11. Feature-flag the new flow; keep legacy adapter only for rollback window.
12. Remove legacy transport after production cutover, not in the first frontend commit.

## Likely Files

Modify:

- `src/main.jsx`
- `src/App.jsx`
- `src/lib/aiAnalysis.js`
- `src/components/UploadZone.jsx`
- `src/components/VariantPicker.jsx`
- `src/styles/global.css`
- `vite.config.js`

Create:

- `src/lib/identity.js`
- `src/lib/jobsApi.js`
- `src/lib/jobPolling.js`
- `src/lib/uploadClient.js`
- `src/components/AuthGate.jsx`
- `src/components/JobProgress.jsx`
- `src/components/JobError.jsx`

## Tests

- sign-in/sign-out/token refresh/disabled session;
- client validation before upload;
- signed upload and finalization progress/errors;
- dropped job-create response replay returns same job;
- refresh/reopen resumes current job;
- hidden/offline polling pauses and resumes;
- ETag 304 backoff;
- queued/running/retry/cancel-requested/succeeded/failed/cancelled/timed-out UX;
- cancellation and terminal race;
- artifact expiry and unauthorized artifact;
- exactly three stable variant indexes and recommendation;
- categorization/improvement/custom swatch by references;
- no screenshot, HTML, signed URL, or token in localStorage;
- palette cycling, locks, drag/drop, custom swatches, hover highlighting, and export make zero API calls;
- accessible progress, errors, focus, and controls.

## Implementation Cautions

- Do not broadly rewrite `App.jsx` while changing transport; extract narrowly and preserve state behavior.
- Never persist Identity tokens or signed URLs in localStorage.
- A network error after POST does not mean create failed; replay the same idempotency key.
- Polling is canonical; do not add SSE/WebSockets in this phase.
- Do not render arbitrary artifact paths or trust server HTML outside the existing sandboxed preview boundary.
- Preserve relative same-origin API calls.
- Keep legacy and new sessions distinguishable by version.

## Completion Gate

- Full staging browser flow works across refresh and API/worker restarts.
- Every terminal state is recoverable and understandable.
- Sensitive local persistence is removed.
- Existing palette/product regression tests pass with zero added AI calls.
- Feature flag can return users to the legacy path during canary window.

## Rollback

Disable the new-flow feature flag and restore the previous web/API revision while preserving job records. Legacy compatibility remains temporary, authenticated/protected, and removed only in Phase 09.
