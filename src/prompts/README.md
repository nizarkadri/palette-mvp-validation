# Prompt inventory

All AI-facing prompt text lives in this folder so prompts are easy to review without digging through app/server logic.

- `screenshotToCode.js` — tool-based screenshot-to-code system/user prompts and retry instructions.
- `screenshotJsonGeneration.js` — legacy JSON-only screenshot-to-code prompt kept for compatibility.
- `semanticCategorization.js` — palette role categorization prompt and JSON shape.
- `validation.js` — visual fidelity evaluator prompts and validation shape.
- `visualCorrection.js` — visual correction prompt builders.
- `jsonRepair.js` — malformed JSON repair prompt.
- `index.js` — barrel export for consumers.
