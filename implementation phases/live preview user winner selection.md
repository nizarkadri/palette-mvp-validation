# Live Preview + User-Selected Winner Implementation Plan

## Goal

Change the upload flow from “AI silently generates 3 variants, auto-picks one, then enables palette editing” to:

```txt
Upload screenshot
  -> generate 3 UI variants
  -> stream each completed variant to the browser as soon as it is ready
  -> user previews and chooses the winner
  -> run semantic palette-role mapping only for the chosen HTML
  -> enable the existing palette engine / role board / export flow
```

This is **not conflicting** with the current approach. It only moves the final HTML selection responsibility from backend auto-selection to the user. The palette engine still needs exactly one chosen `{ html, elements }` result, so it can remain mostly unchanged.

## Important Constraints

- Do **not** use Flutter. This is a React/Vite app.
- Keep 3 generated variants by default.
- Do not run semantic palette categorization for all variants. Run it only after the user picks one.
- Preserve the existing palette engine behavior after selection:
  - role kanban
  - hover highlight
  - palette cycling
  - locks
  - export
  - localStorage session persistence
- The live preview should stream **complete generated HTML variants**, not token-by-token partial HTML. Partial HTML/CSS can break the iframe and creates more sanitization risk.

## Current Relevant Files

- `vite.config.js`
  - local Vite API plugin
  - current `/api/analyze` endpoint
  - generation functions:
    - `generateCandidate(...)`
    - `generateVerifiedHtml(...)`
    - `renderHtmlScreenshot(...)`
    - `evaluateVisualCandidate(...)`
    - `runVisualCorrectionAgent(...)`
  - semantic mapping logic currently inside `/api/analyze`
- `src/lib/aiAnalysis.js`
  - browser API client: `analyzeScreenshot(...)`
  - normalization/filtering helpers
- `src/App.jsx`
  - upload state
  - calls `analyzeScreenshot(...)`
  - stores final `html` and `elements`
- `src/components/UiPreview.jsx`
  - already renders arbitrary HTML in an iframe; reuse this for variant previews
- Suggested new file:
  - `src/components/VariantPicker.jsx`

## Recommended Transport

Use a **POST fetch streaming NDJSON endpoint**, not EventSource.

Reason:

- EventSource is GET-only and awkward for large image payloads.
- WebSocket is overkill for this local MVP.
- `fetch(...).body.getReader()` supports POST body + streamed response.

Endpoint:

```txt
POST /api/analyze-stream
Content-Type: application/json
Response Content-Type: application/x-ndjson
```

Each streamed line is one JSON event:

```json
{"type":"progress","message":"Generating 3 variants...","progress":12}
{"type":"variant.generated","variant":{"id":"variant-1","index":1,"html":"...","issues":[]}}
{"type":"variant.evaluated","variantId":"variant-1","score":0.83,"visualEvaluation":{}}
{"type":"complete","recommendedVariantId":"variant-2","debug":{}}
{"type":"error","error":"..."}
```

Keep the existing `/api/analyze` endpoint during migration for fallback/backward compatibility if desired.

## Backend Design

### 1. Add small stream helpers in `vite.config.js`

Add helpers near `sendJson`:

```js
function setupNdjsonStream(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
}

function sendStreamEvent(res, event) {
  res.write(`${JSON.stringify(event)}\n`);
}
```

### 2. Extract semantic categorization into reusable function

Current semantic mapping is inline inside `/api/analyze`. Extract it:

```js
async function categorizeHtmlForPalette({ apiKey, modelId, html, base64, mediaType, session }) {
  // existing semantic callOpenRouter + parseOrRepair + finalizeSemanticElements
  // return { elements, semanticDebug }
}
```

This function will be used by:

- existing `/api/analyze`, if kept
- new `/api/categorize`

### 3. Add `/api/categorize`

Endpoint:

```txt
POST /api/categorize
```

Request:

```json
{
  "html": "<style>...</style><div class='s2c-screen'>...</div>",
  "base64": "original screenshot base64",
  "mediaType": "image/png",
  "variantId": "variant-2"
}
```

Response:

```json
{
  "html": "...same/sanitized html...",
  "elements": [...],
  "debug": {
    "debugId": "...",
    "debugPath": "...",
    "semanticFallback": false
  }
}
```

Validation/safety:

- Require `html` string.
- Re-sanitize via `sanitizeGeneratedHtml(html)` before categorization and before returning.
- Require screenshot `base64` if semantic prompt still needs image context.
- If semantic mapping fails, use existing fallback: `finalizeSemanticElements({ elements: [] }, html)`.

### 4. Add `/api/analyze-stream`

High-level behavior:

1. Parse body with `readJsonBody(req)`.
2. Validate `base64`.
3. Create debug session and write request metadata/image.
4. Determine 3 model IDs with existing `variantModelIds(env, modelId)`.
5. Generate variants and stream each one as it completes.
6. Optionally evaluate/render each generated variant and stream score updates.
7. Send `complete` with backend recommendation only. Do **not** semantic-map yet.

Pseudo-code:

```js
server.middlewares.use("/api/analyze-stream", async (req, res) => {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  setupNdjsonStream(res);

  try {
    const { base64, mediaType = "image/png" } = await readJsonBody(req);
    // validate apiKey/base64, create debug session

    sendStreamEvent(res, { type: "progress", message: "Generating 3 variants...", progress: 8 });

    const modelIds = variantModelIds(env, modelId);
    const candidates = [];

    await Promise.allSettled(
      modelIds.map(async (variantModelId, variantIndex) => {
        const candidate = await generateCandidate({
          apiKey,
          modelId: variantModelId,
          base64,
          mediaType,
          session,
          variantIndex,
        });

        candidates.push(candidate);

        sendStreamEvent(res, {
          type: "variant.generated",
          variant: publicVariant(candidate),
          progress: 20 + candidates.length * 18,
        });

        candidate.renderedScreenshot = await renderHtmlScreenshot(
          candidate.html,
          session,
          `variant-${candidate.variantIndex + 1}-rendered`,
        );

        if (candidate.renderedScreenshot) {
          try {
            candidate.visualEvaluation = await evaluateVisualCandidate({
              apiKey,
              modelId: candidate.modelId,
              base64,
              mediaType,
              renderedScreenshot: candidate.renderedScreenshot,
              candidate,
            });
          } catch (error) {
            await writeDebugJson(session, `variant-${candidate.variantIndex + 1}-visual-evaluation-error.json`, {
              message: error.message,
            });
          }
        }

        sendStreamEvent(res, {
          type: "variant.evaluated",
          variantId: `variant-${candidate.variantIndex + 1}`,
          score: scoreVariant(candidate),
          visualEvaluation: candidate.visualEvaluation || null,
          progress: 70 + candidates.length * 6,
        });
      }),
    );

    if (candidates.length === 0) throw new Error("All generation variants failed.");

    const recommended = selectBestVariant(candidates);
    await write generation summary debug files;

    sendStreamEvent(res, {
      type: "complete",
      recommendedVariantId: `variant-${recommended.variantIndex + 1}`,
      debug: { debugId: session.id, debugPath: session.relativeDir },
      progress: 100,
    });
    res.end();
  } catch (error) {
    sendStreamEvent(res, { type: "error", error: error.message || "Analysis failed." });
    res.end();
  }
});
```

Create a helper to avoid leaking huge/raw OpenRouter responses to frontend:

```js
function publicVariant(candidate) {
  return {
    id: `variant-${candidate.variantIndex + 1}`,
    index: candidate.variantIndex + 1,
    modelId: candidate.modelId,
    html: candidate.html,
    issues: candidate.issues,
    score: scoreVariant(candidate),
    visualEvaluation: candidate.visualEvaluation || null,
    renderedScreenshot: candidate.renderedScreenshot?.relativePath || null,
  };
}
```

### 5. Decide whether to keep visual correction

For this feature, recommended behavior:

- Do **not** auto-correct before user selection in v1.
- Show raw generated variants + optional scores.
- After user chooses a variant, optionally add future button: “Improve selected variant”.

Reason: auto-correction adds extra latency before the user sees selectable results. The goal is live preview and user choice.

If correction must stay, run it only for the backend-recommended variant and stream it as another event:

```json
{"type":"variant.corrected","variant":{...}}
```

But this is not required for first implementation.

## Frontend API Client Design

Update `src/lib/aiAnalysis.js`.

### Add `analyzeScreenshotVariants(...)`

Signature:

```js
export async function analyzeScreenshotVariants(base64Image, mediaType, handlers = {})
```

Handlers:

```js
{
  onProgress(event) {},
  onVariant(variant) {},
  onVariantEvaluated(event) {},
  onComplete(event) {},
}
```

Implementation outline:

```js
export async function analyzeScreenshotVariants(base64Image, mediaType = "image/png", handlers = {}) {
  const response = await fetch("/api/analyze-stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ base64: base64Image, mediaType }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`Analysis stream failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const variants = [];
  let complete = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      const event = JSON.parse(line);

      if (event.type === "progress") handlers.onProgress?.(event);
      if (event.type === "variant.generated") {
        const variant = {
          ...event.variant,
          elements: [],
        };
        variants.push(variant);
        handlers.onVariant?.(variant);
      }
      if (event.type === "variant.evaluated") handlers.onVariantEvaluated?.(event);
      if (event.type === "complete") {
        complete = event;
        handlers.onComplete?.(event);
      }
      if (event.type === "error") throw new Error(event.error || "Analysis failed.");
    }
  }

  return { variants, recommendedVariantId: complete?.recommendedVariantId, debug: complete?.debug };
}
```

### Add `categorizeSelectedVariant(...)`

```js
export async function categorizeSelectedVariant({ html, base64, mediaType, variantId }) {
  const response = await fetch("/api/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, base64, mediaType, variantId }),
  });

  const parsed = await response.json().catch(() => null);
  if (!response.ok) throw new Error(parsed?.error || `Categorization failed: ${response.status}`);
  if (!parsed.html || !Array.isArray(parsed.elements)) {
    throw new Error('Categorization response missing required "html" or "elements" fields');
  }

  return {
    ...parsed,
    elements: filterElementsWithHtmlTargets(normalizeElements(parsed.elements), parsed.html),
  };
}
```

Keep existing `analyzeScreenshot(...)` if needed for old flow/tests.

## Frontend State Design (`src/App.jsx`)

Add state:

```js
const [uploadedImage, setUploadedImage] = useState(null); // { base64, mediaType }
const [variants, setVariants] = useState([]);
const [selectedVariantId, setSelectedVariantId] = useState(null);
const [recommendedVariantId, setRecommendedVariantId] = useState(null);
const [isCategorizing, setIsCategorizing] = useState(false);
```

Derived state:

```js
const selectedVariant = variants.find((variant) => variant.id === selectedVariantId) || variants[0] || null;
const isChoosingVariant = variants.length > 0 && !html;
```

Upload handler becomes:

```js
const handleFileSelected = useCallback(async (file) => {
  setIsProcessing(true);
  setError(null);
  setVariants([]);
  setSelectedVariantId(null);
  setRecommendedVariantId(null);
  setHtml(null);
  setElements([]);

  try {
    const base64 = await fileToBase64(file);
    const mediaType = file.type || "image/png";
    setUploadedImage({ base64, mediaType });

    await analyzeScreenshotVariants(base64, mediaType, {
      onProgress: (event) => {
        setStatusMessage(event.message || "Generating variants...");
        if (typeof event.progress === "number") setAnalysisProgress(event.progress);
      },
      onVariant: (variant) => {
        setVariants((prev) => [...prev, variant]);
        setSelectedVariantId((current) => current || variant.id);
        setStatusMessage(`Variant ${variant.index} ready. Generating the rest...`);
      },
      onVariantEvaluated: (event) => {
        setVariants((prev) =>
          prev.map((variant) =>
            variant.id === event.variantId
              ? { ...variant, score: event.score, visualEvaluation: event.visualEvaluation }
              : variant,
          ),
        );
      },
      onComplete: (event) => {
        setRecommendedVariantId(event.recommendedVariantId);
        setStatusMessage("Choose the version you want to palette-edit.");
        setAnalysisProgress(100);
      },
    });
  } catch (err) {
    setError(err.message || "Something went wrong analyzing the image.");
  } finally {
    setIsProcessing(false);
  }
}, []);
```

Add choose handler:

```js
async function handleUseSelectedVariant() {
  if (!selectedVariant || !uploadedImage) return;
  setIsCategorizing(true);
  setError(null);
  setStatusMessage("Mapping palette roles for your selected version...");

  try {
    const result = await categorizeSelectedVariant({
      html: selectedVariant.html,
      base64: uploadedImage.base64,
      mediaType: uploadedImage.mediaType,
      variantId: selectedVariant.id,
    });

    setHtml(result.html);
    setElements(result.elements);
    setVariants([]);
    setSelectedVariantId(null);
    setRecommendedVariantId(null);
    setPaletteIndex(0);
    setIsPaletteActive(false);
    setLockedRoles(DEFAULT_LOCKED_ROLES);
    setLockedColors(DEFAULT_LOCKED_COLORS);
    setPreviewMode("desktop");
  } catch (err) {
    setError(err.message || "Failed to map palette roles.");
  } finally {
    setIsCategorizing(false);
    setStatusMessage("");
  }
}
```

Render logic:

```jsx
{!html && !selectedVariant ? (
  <UploadZone ... />
) : !html && selectedVariant ? (
  <VariantPicker
    variants={variants}
    selectedVariantId={selectedVariantId}
    recommendedVariantId={recommendedVariantId}
    isGenerating={isProcessing}
    isCategorizing={isCategorizing}
    statusMessage={statusMessage}
    progressPercent={analysisProgress}
    onSelectVariant={setSelectedVariantId}
    onUseSelectedVariant={handleUseSelectedVariant}
  />
) : (
  <UiPreview ... />
)}
```

## New Component: `VariantPicker.jsx`

Purpose: show selected variant in the main iframe and thumbnails/buttons for all variants received so far.

Props:

```js
{
  variants,
  selectedVariantId,
  recommendedVariantId,
  isGenerating,
  isCategorizing,
  statusMessage,
  progressPercent,
  onSelectVariant,
  onUseSelectedVariant,
}
```

Implementation notes:

- Reuse `UiPreview` for the large selected preview.
- Use local `previewRootRef = useRef(null)` for picker preview; palette highlighting is not active yet.
- Variant cards can be buttons:
  - “Variant 1”
  - score if available
  - “Recommended” badge if `variant.id === recommendedVariantId`
  - issue count if non-zero
- Disable “Use this version” while `isGenerating && variants.length < 3` only if product wants to force seeing all variants. Otherwise allow choosing early.

Suggested UX:

```txt
Generated versions
[Variant 1] [Variant 2] [Variant 3]

Main iframe preview of selected variant

Button: Use this version
Status: Variant 2 ready. Generating the rest...
Progress bar
```

## CSS Additions

Add classes to `src/styles/global.css`:

- `.variant-picker`
- `.variant-picker-header`
- `.variant-tabs`
- `.variant-card`
- `.variant-card.active`
- `.variant-badge`
- `.variant-actions`
- `.variant-use-button`

Keep visual style consistent with existing dark panels and `.preview-toggle` buttons.

## Persistence Considerations

Current localStorage stores final chosen session only:

```js
{ html, elements, paletteIndex, isPaletteActive, lockedRoles, lockedColors, previewMode }
```

Recommended for first implementation:

- Do not persist in-progress variants.
- Only persist after user chooses and categorization succeeds.
- `handleReset()` should clear:
  - `variants`
  - `selectedVariantId`
  - `recommendedVariantId`
  - `uploadedImage`
  - `analysisProgress`

## Error Handling

- If one variant fails, stream a `variant.failed` event but continue generating others.
- If all variants fail, stream `error` and show current error banner.
- If semantic categorization fails, fallback elements should be generated from HTML hooks as current code already does.
- If stream connection drops after at least one variant is available, allow user to choose from available variants, but show warning.

Optional event:

```json
{"type":"variant.failed","variantId":"variant-2","index":2,"error":"..."}
```

## Acceptance Criteria

1. Upload still generates 3 variants by default.
2. The frontend displays each variant as soon as its full HTML is available, before all backend work is complete.
3. User can select between generated variants and see the selected variant in the preview iframe.
4. User can click “Use this version”.
5. Only after “Use this version” does the app run semantic palette-role mapping.
6. After mapping, existing palette engine flow works unchanged:
   - element roles appear
   - hover highlighting works
   - Space/arrow palette cycling works
   - palette locks work
   - export works
7. Existing `/api/analyze` either still works or is intentionally migrated with no dead imports.
8. `npm run build` passes.
9. No LSP/lint diagnostics remain in changed files.

## Suggested Implementation Order

1. Backend: extract `categorizeHtmlForPalette(...)`.
2. Backend: add `/api/categorize` and manually test with a known generated HTML.
3. Frontend: add `categorizeSelectedVariant(...)` client helper.
4. Backend: add `/api/analyze-stream` with NDJSON progress + `variant.generated` events.
5. Frontend: add `analyzeScreenshotVariants(...)` stream reader.
6. Frontend: create `VariantPicker.jsx`.
7. Frontend: update `App.jsx` state and render flow.
8. CSS: style picker/cards/progress.
9. Verify build and run one upload manually.

## Manual Test Script

1. Start dev server:

```bash
npm run dev
```

1. Upload `src/test01.jpg` or another screenshot.
2. Confirm:
   - variant 1 appears before all 3 finish
   - variant 2/3 append as they finish
   - recommended badge appears after evaluation completes
   - choosing a variant maps roles
   - palette cycling changes the chosen preview only

## Notes for Future Improvement

- Add “Improve selected variant” after user chooses one, using existing `runVisualCorrectionAgent(...)`.
- Add side-by-side compare view for desktop screens.
- Add thumbnail screenshots using `renderedScreenshot` debug images, but do not rely on file paths in production unless they are served by a static debug route.
- Add cancel support with `AbortController` on frontend and `req.on("close")` handling backend-side.
