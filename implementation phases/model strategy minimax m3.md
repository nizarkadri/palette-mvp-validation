# Model Strategy — OpenRouter Multimodal Model

## Current Experiment

Gemini 3.1 Flash Lite produced structurally valid but low-fidelity generic output. Switch back to MiniMax M3 through OpenRouter using the prompt-breakdown approach: simplified static HTML, layout-only inline styles, no inline colors, focused colorable element map, response-shape normalization, inline-color stripping, and class-id validation.

```txt
Provider: OpenRouter
Model id: minimax/minimax-m3
```

## Previous Decision

MiniMax M3 was the initial planned model for both:

1. UI screenshot reconstruction/generation
2. Optional AI validation of the generated result

```txt
Provider: OpenRouter
Model id: minimax/minimax-m3
```

## Why This Fits the MVP

The core product loop is:

> **Upload your UI → AI understands the visual roles → user rapidly vibe-tests palettes on something that looks like their actual product.**

A multimodal OpenRouter model fits because:

- it is multimodal and can inspect screenshots directly
- one-model architecture is simpler for MVP debugging
- local deterministic validation can catch structural problems
- stronger models can be added later only if failure rates justify the cost

## Important Constraint

The selected model should not replace deterministic validation.

Code must still validate:

- valid JSON
- required top-level keys
- required element fields
- valid roles
- valid hex swatches
- duplicate ids
- element ids appearing as classes in HTML
- text elements having `isText` and `textLocked`

Current exact-replica experiment intentionally avoids heavy post-processing so model output can be inspected directly.

## Generation Flow

```txt
screenshot
  ↓
multimodal generation prompt
  ↓
local deterministic validator
  ↓
accept or retry/fail gracefully
```

## Optional Validation Flow

```txt
screenshot + generated html + generated elements
  ↓
multimodal validation prompt
  ↓
structured validation JSON
  ↓
accept, retry with critique, or show recoverable error
```

## Generation Prompt Requirements

The generation prompt must require:

- JSON only
- root `<div class="ui-root">`
- no scripts or external resources
- layout-only inline styles; color-related inline styles are stripped defensively
- focused visual element coverage
- text classes for headings/body/captions/links/buttons/labels/inputs
- `isText` and `textLocked` on every element
- every `element.id` to appear as a class in the HTML

## Validation Prompt Requirements

The validation prompt must return JSON only:

```json
{
  "pass": true,
  "score": 0.0,
  "recommendedRetry": false,
  "summary": "Short judgment.",
  "missingElements": [],
  "badMappings": [],
  "roleIssues": [],
  "htmlIssues": [],
  "retryInstructions": []
}
```

The validation model should judge whether the result is good enough for palette exploration, not whether it is pixel-perfect.

## Future Upgrade Path

If the current model fails frequently:

1. add a stronger validation model
2. use the current model as first-pass generator and fallback to a stronger generator
3. switch back to MiniMax M3 or another OpenRouter multimodal model
4. split the pipeline into vision schema extraction + coding model HTML generation
