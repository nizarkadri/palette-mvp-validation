# Variant Improvement Implementation Plan

## Goal

When only one or two variants successfully generate, avoid treating that as a
failed experience. Let the user improve the best successful variant by using it
as the reference starting point for a new refinement pass.

The workflow becomes:

1. Generate the initial successful variants.
2. User picks the closest one.
3. User clicks **Improve**.
4. App sends the original screenshot plus the selected variant HTML/rendered
   screenshot to the backend.
5. Backend asks the model to improve the existing HTML instead of regenerating
   from scratch.
6. Improved result is appended as a new variant card.

---

## UX Plan

### Variant card actions

Replace the current text preview button with a compact enlarge/preview icon.

Current:

```txt
Preview | Select
```

Target:

```txt
[enlarge icon]  Select  Improve
```

### Preview icon

- Same behavior as the current Preview action.
- Uses less card space.
- Should have accessible text, for example:

```txt
Preview Variant 1
```

### Select button

- Keeps the current behavior.
- Selects the variant for categorization/final use.

### Improve button

- New action on each successful variant.
- Sends that variant for improvement.
- While improving:
  - disable the clicked Improve button
  - show `Improving...` or spinner state
- On success:
  - append the improved result as a new variant card
  - auto-select the improved variant
  - keep the original variant available as fallback
  - mark the new card as improved, e.g. `Improved from Variant 1`

---

## Frontend Plan

### Files

- `src/components/VariantPicker.jsx`
- `src/App.jsx`
- `src/lib/aiAnalysis.js`
- `src/styles/global.css`

### VariantPicker changes

Add props:

```js
onImproveVariant
improvingVariantId
```

Update actions:

- icon-only preview action
- Select button
- Improve button

Disable Improve when:

```js
isGenerating || isCategorizing || improvingVariantId === variant.id
```

### App state/handler

Add state:

```js
const [improvingVariantId, setImprovingVariantId] = useState(null);
```

Add handler:

```js
async function handleImproveVariant(variantId) {
  const sourceVariant = variants.find((variant) => variant.id === variantId);
  if (!sourceVariant || !uploadedImage) return;

  setImprovingVariantId(variantId);

  try {
    const result = await improveVariant({
      html: sourceVariant.html,
      base64: uploadedImage.base64,
      mediaType: uploadedImage.mediaType,
      variantId,
      modelId: sourceVariant.modelId,
    });

    const improvedVariant = {
      ...result,
      id: `${variantId}-improved-${Date.now()}`,
      parentVariantId: variantId,
      isImproved: true,
    };

    setVariants((current) => [...current, improvedVariant]);
    setSelectedVariantId(improvedVariant.id);
  } finally {
    setImprovingVariantId(null);
  }
}
```

### API client

Add to `src/lib/aiAnalysis.js`:

```js
export async function improveVariant(payload) {
  const response = await fetch("/api/improve-variant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Parse JSON and throw errors consistently with existing helpers.
}
```

---

## Backend Plan

### New route

Create:

```txt
server/routes/improve-variant.js
```

Register in:

```txt
server/plugin.js
```

Endpoint:

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
  modelId,
  feedback?
}
```

Initial version can omit user-visible feedback input. Add it later once the
basic improve loop is reliable.

---

## Improvement Pipeline

Use existing visual correction infrastructure where possible.

Steps:

1. Validate request.
2. Create debug session.
3. Save request metadata, original screenshot, and source variant HTML.
4. Render source variant HTML to a screenshot.
5. Compare original screenshot and rendered source variant.
6. Ask the model to improve the current HTML, preserving correct structure.
7. Render improved HTML.
8. Return improved variant data.

Return shape:

```js
{
  html,
  modelId,
  issues,
  renderedScreenshot,
  frameFit,
  visualEvaluation,
  debug
}
```

---

## Model Strategy

Use:

```js
OPENROUTER_IMPROVE_MODEL_ID || OPENROUTER_MODEL_ID || DEFAULT_MODEL_ID
```

For v1, one improvement attempt is acceptable. Later we can add fallback retry.

Important prompt rule:

```txt
Improve this existing HTML based on the screenshot. Preserve correct structure.
Do not regenerate from scratch unless necessary.
```

---

## Debug Artifacts

Each improve run should write files like:

```txt
request-meta.json
request-image.png
source-variant.html
source-rendered.png
source-rendered-fit.json
improvement-response.json
improvement-tool-events.json
improved.html
improved-rendered.png
improved-rendered-fit.json
```

---

## Testing Plan

### Component tests

Update `VariantPicker.test.js`:

- Preview text button is replaced by an icon button.
- Preview icon button has an accessible label.
- Select button exists.
- Improve button exists.
- Improving state disables the button and shows loading copy/state.

### Backend tests

Add lightweight request-validation tests if practical.
Do not run real model or Playwright work in unit tests.

### Manual validation

1. Generate variants.
2. Confirm card actions show preview icon, Select, and Improve.
3. Click preview icon and confirm current preview behavior still works.
4. Click Improve and confirm loading state.
5. Confirm improved variant is appended, not replacing the original.
6. Confirm improved variant is auto-selected.
7. Select improved variant and continue.
8. Confirm categorization still works.

---

## Trade-offs

### Pros

- Better UX when only one or two variants succeed.
- Avoids wasting time forcing failed models.
- Uses best available output as a strong starting point.
- Supports iterative fidelity improvement.

### Cons

- Adds another model call.
- Adds per-card loading/error state.
- Improved variant can still fail.
- More backend debug artifacts.

---

## Initial Recommendation

Implement in this order:

1. UI card action cleanup: preview icon + Select + Improve.
2. Frontend improve state and API function.
3. Backend `/api/improve-variant` route.
4. Append improved variants instead of replacing originals.
5. Tests and manual validation.
