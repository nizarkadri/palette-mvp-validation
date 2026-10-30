# Phase 02 — Exhaustive AI Categorization

## Goal

Update the AI prompt so MiniMax M3 identifies all important visual parts of the UI, especially text elements.

Core idea connection:

> The AI should do the semantic mapping once. If it misses headings, body text, captions, links, or buttons, the user cannot accurately vibe-test palettes on their actual UI.

## Files

- `src/lib/aiAnalysis.js`
- backend/OpenRouter generation endpoint when Phase 09 is implemented

## Required Prompt Changes

Remove the current guidance:

```txt
Keep the element list focused — typically 6 to 14 entries...
```

Replace it with exhaustive guidance:

- MUST list every visual element in the UI, no exceptions.
- Standard app screens should typically return 12–25 entries.
- All text elements must be identified by level/type.
- Every returned `id` must appear as a class in the HTML.
- Every element includes `isText` and `textLocked`.

## Required Text Classes

- `page-title` or `screen-title`
- `heading-h1`
- `heading-h2`
- `heading-h3`
- `heading-h4`
- `heading-h5`
- `heading-h6`
- `body-text`
- `caption-text`
- `button-text`
- `link-text`
- `input-text`

## Micro Commits

### Commit 02.01 — Update prompt response schema

Add `isText` and `textLocked` to the JSON shape in the prompt.

Acceptance:

- Example JSON includes the new fields.
- Text examples show `isText: true` and `textLocked: true`.

### Commit 02.02 — Replace focused list wording with exhaustive wording

Remove 6–14 item guidance and replace with exhaustive mapping instructions.

Acceptance:

- Prompt clearly says not to skip headings, captions, links, labels, or input text.
- Prompt still supports class-based grouping.

### Commit 02.03 — Add class coverage validation

After receiving MiniMax M3 output, validate that each element id appears as a class in the returned HTML.

Acceptance:

- Invalid/missing classes are handled predictably.
- Preferred behavior: filter invalid entries or warn in console.
- App does not crash on invalid AI output.

### Commit 02.04 — Add MiniMax validation prompt draft

Add a strict validator prompt for MiniMax M3 to judge visual completeness when needed.

Acceptance:

- Validator returns JSON only.
- Validator checks missing UI regions, text groups, role issues, and class grouping.
- Validator does not rewrite the UI unless explicitly asked in a later retry step.
