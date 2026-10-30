# Variant Improvement Final Implementation Plan

## Confirmed Decisions

1. **Improve model**
   - Use the same model as the source variant.
   - Reason: the source model produced that candidate and should have the most
     compatible generation style/context.

2. **Improved variant behavior**
   - Append the improved variant as a new card.
   - Do not auto-select it.
   - Highlight the new card so the user can notice it.

3. **User input**
   - V1 is one-click only.
   - No feedback textbox yet.

4. **Failure message**
   - If Improve fails, show:

   ```txt
   upload a better screenshot for better results
   ```

5. **Repeated improvement**
   - Do not allow improving an already improved variant.
   - If user clicks Improve on an improved variant, show the same message:

   ```txt
   upload a better screenshot for better results
   ```

---

## Phase Strategy

### Phase 1 — Variant card UI actions

**Goal:** Make the variant card ready for improvement without backend changes.

Changes:

- Replace text `Preview` button with compact enlarge/preview icon button.
- Keep `Select` button.
- Add `Improve` button.
- Add visual label support for improved cards:
  - `Improved`
  - optionally `from Variant N`
- Add highlight styling for newly appended improved variants.

Files:

- `src/components/VariantPicker.jsx`
- `src/styles/global.css`
- `src/components/__tests__/VariantPicker.test.js`

Validation:

- Component test checks preview icon accessible label.
- Component test checks Select and Improve are rendered.
- Component test checks improved-card label/highlight class.

Microcommit:

```txt
ui: add variant improve action and compact preview icon
```

---

### Phase 2 — Frontend improve state and API client

**Goal:** Wire the UI state and client request shape without backend behavior yet.

Changes:

- Add client helper in `src/lib/aiAnalysis.js`:

```js
improveVariant({ html, base64, mediaType, variantId, modelId })
```

- Add app state:

```js
improvingVariantId
highlightedVariantId
```

- Add handler in `App.jsx`:
  - reject improved variants immediately with failure message
  - call `/api/improve-variant` for normal variants
  - append returned variant
  - do not auto-select
  - highlight appended variant

Failure behavior:

```txt
upload a better screenshot for better results
```

Files:

- `src/App.jsx`
- `src/lib/aiAnalysis.js`
- `src/components/VariantPicker.jsx`

Validation:

- Existing tests still pass.
- Manual UI can show disabled/loading improve state once backend is available.

Microcommit:

```txt
feat: wire frontend variant improvement flow
```

---

### Phase 3 — Backend improve route

**Goal:** Add `/api/improve-variant` using existing visual correction machinery.

Route:

```txt
POST /api/improve-variant
```

Payload:

```js
{
  html,
  base64,
  mediaType,
  variantId,
  modelId
}
```

Model selection:

```js
modelId || env.OPENROUTER_MODEL_ID || DEFAULT_MODEL_ID
```

Pipeline:

1. Validate request.
2. Create debug session.
3. Save request metadata.
4. Save original screenshot.
5. Save source variant HTML.
6. Render source variant HTML.
7. Use existing visual correction prompt/agent to improve the HTML.
8. Finalize/sanitize improved HTML.
9. Run generation issue checks.
10. Render improved HTML.
11. Return public variant-compatible payload.

Return shape:

```js
{
  html,
  modelId,
  issues,
  renderedScreenshot,
  frameFit,
  debug
}
```

Files:

- `server/routes/improve-variant.js`
- `server/plugin.js`
- possibly `server/services/visualVerifier.js` if helper export is needed

Validation:

- Add request-validation unit tests where practical.
- Avoid real model calls in unit tests.

Microcommit:

```txt
feat: add improve variant API route
```

---

### Phase 4 — Integration polish and failure handling

**Goal:** Make the end-to-end experience safe and understandable.

Changes:

- Ensure improved variants cannot be improved again.
- Show confirmed failure message for:
  - model/API failure
  - request validation failure
  - clicking Improve on an already improved variant
- Ensure original variant remains available.
- Ensure appended improved variant is highlighted, not selected.
- Ensure `Continue` still uses only the currently selected variant.

Files:

- `src/App.jsx`
- `src/components/VariantPicker.jsx`
- `src/styles/global.css`

Validation:

- Manual test with successful improve.
- Manual test with failed improve.
- Manual test clicking Improve on improved variant.
- Verify categorization still works after selecting improved variant manually.

Microcommit:

```txt
fix: polish improve variant states and errors
```

---

### Phase 5 — Documentation and trade-off update

**Goal:** Document the new product direction.

Changes:

- Update `tradeoffs.md` with:
  - accepting partial variant success
  - adding user-driven improvement instead of forcing 3 variants
- Optionally link this plan from `implementation phases/phase index.md`.

Files:

- `tradeoffs.md`
- optionally `implementation phases/phase index.md`

Microcommit:

```txt
 docs: document variant improvement trade-off
```

---

## Final Validation Checklist

Run:

```txt
npm test
npm run build
```

Manual checks:

1. Generate variants.
2. Confirm card actions are:

```txt
[preview icon] Select Improve
```

1. Confirm preview icon opens the preview popover.
2. Confirm Improve on a normal variant shows loading state.
3. Confirm successful improve appends a highlighted new card.
4. Confirm improved card is not auto-selected.
5. Confirm original variant remains available.
6. Confirm clicking Improve on improved card shows:

```txt
upload a better screenshot for better results
```

1. Confirm failed improve shows the same message.
2. Select improved variant manually and continue.
3. Confirm categorization still works.

---

## Implementation Notes

- Keep V1 one-click only.
- Do not add user feedback input yet.
- Do not force 3 variants.
- Do not replace existing variants.
- Keep debug artifacts for every improve attempt.
- Keep improved variant IDs stable enough for selection and rendering, for example:

```js
`${sourceVariant.id}-improved-${Date.now()}`
```
