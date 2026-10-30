# Phase 02 — Chromium and Generated-Content Security

- **Status:** Not started
- **Depends on:** Phase 01 processor/context seams
- **Unblocks:** private worker and real-user rendering

## Goal

Make rendering model/user-derived HTML deterministic, bounded, network-denied, isolated between jobs, and safe enough for a private Cloud Run worker.

## Related Codebase

- `server/utils/html.js` currently sanitizes HTML but does not fully cover CSS resource URLs.
- `server/services/visualVerifier.js` calls `page.setContent(..., { waitUntil: "networkidle" })` without request interception.
- `server/routes/improve-variant.js` can render caller-provided HTML before a complete security boundary.
- `server/services/browserPool.js` reuses a process-global browser and has signal hooks but no per-job context policy.
- Debug screenshots and HTML currently use local files.

## Implementation

1. Sanitize every HTML input before its first render, including improvement source HTML.
2. Introduce explicit HTML element/attribute/protocol allowlists.
3. Parse and sanitize CSS; remove `@import`, external `url()`, `image-set`, fonts, cursors, masks, filters, and escaped equivalents.
4. Enforce HTML byte, DOM-node, selector, stylesheet, and rendered-output limits.
5. Create a fresh browser context and temporary directory for each render/job boundary.
6. Disable JavaScript, service workers, downloads, permissions, and persistent profiles.
7. Install request routing before `setContent`; abort all network except explicitly validated inline `data:` and required `blob:` resources.
8. Inject restrictive CSP as a second layer.
9. Replace `networkidle` with deterministic DOM/font readiness and bounded waits.
10. Run one active page/render at a time.
11. Run Chromium non-root with sandbox enabled; verify the exact pinned image.
12. Close page/context and delete temporary files in `finally`.
13. Treat browser crash as attempt-local and never reuse a corrupt context/profile.

## Likely Files

- `server/utils/html.js`
- `server/services/visualVerifier.js`
- `server/services/browserPool.js`
- `server/pipeline/artifacts.js`
- new `server/security/htmlPolicy.js`
- new `server/security/cssPolicy.js`
- tests/fixtures under `server/security/__tests__/fixtures/`
- worker Docker target introduced later but smoke-tested here when available

## Tests

- script/event handler/form/frame/object/embed/meta/base vectors removed;
- CSS URL/import/font/cursor/mask/filter vectors removed, including escaped syntax;
- HTTP, HTTPS, redirects, WebSocket, FTP, file, localhost, RFC1918, IPv6 local, link-local, `169.254.169.254`, and `metadata.google.internal` produce zero forbidden browser requests;
- data/blob policy allows only intended inline assets;
- JavaScript/service worker/download/permission attempts fail;
- oversize HTML/DOM/CSS/render output fails before publication;
- cancellation and timeout close active context;
- browser crash does not leak state to next job;
- temp storage returns to baseline after repeated renders;
- exact production image runs non-root with sandbox enabled and within memory limit.

## Implementation Cautions

- DOMPurify alone is not a CSS or network security boundary.
- Browser request interception is defense in depth, not hard process-level network isolation; worker IAM remains minimal.
- Do not add `--no-sandbox` to make a container test pass. Escalate and block the launch gate.
- Disabling JavaScript can change visual fidelity. Validate representative fixtures before accepting output changes.
- Do not loosen network policy for remote fonts/images; generated output should be self-contained.
- Do not log rejected HTML or URLs.

## Completion Gate

- Malicious fixture suite produces zero forbidden network requests.
- Every render input is sanitized before browser contact.
- Exact worker image is non-root and sandboxed.
- Repeated render/cancel/crash tests show no context/temp leakage.
- Existing generation visual fixtures remain acceptably compatible.

## Rollback

Keep old rendering available only in local test fixtures while comparing output. Never deploy the old unrestricted render path to production as a rollback.
