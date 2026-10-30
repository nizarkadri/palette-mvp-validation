# Phase 01 — Element Model Foundation

## Goal

Create a richer element model so the app can support exhaustive AI categorization, manual fixes, text locking, and reliable palette behavior.

Core idea connection:

> AI maps the UI once, then the user rapidly explores palettes. That only works if each mapped element carries enough intent for instant local recoloring.

## Target Element Shape

```js
{
  id,
  label,
  role, // primary | secondary | accent
  swatch,
  isText,
  textLocked,
  isManual
}
```

## Files

- `src/lib/aiAnalysis.js`
- `src/App.jsx`
- `src/components/RoleKanban.jsx`
- `src/lib/paletteEngine.js`

## Micro Commits

### Commit 01.01 — Add element normalization helper

Create a helper that normalizes all AI/manual elements into the target shape.

Acceptance:

- Missing `label` falls back to `id`.
- Invalid `role` falls back to `secondary`.
- Invalid `swatch` falls back to `#888888`.
- `isText` is boolean.
- `textLocked` defaults to true only when `isText` is true.
- `isManual` defaults to false.

### Commit 01.02 — Use normalization in AI response parsing

Update `analyzeScreenshot()` so parsed elements always pass through normalization.

Acceptance:

- Existing old-shape AI responses still work.
- New-shape responses preserve `isText` and `textLocked`.

### Commit 01.03 — Update JSDoc/comments for element model

Update comments in affected files so future implementation follows the new shape.

Acceptance:

- RoleKanban prop comments mention `isText` and `textLocked`.
- Palette engine comments mention metadata-first behavior.
