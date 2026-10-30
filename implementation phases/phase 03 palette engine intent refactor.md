# Phase 03 — Palette Engine Intent Refactor

## Goal

Refactor palette application so it uses element intent from metadata first, with DOM heuristics only as fallback.

Core idea connection:

> Palette cycling must remain instant and trustworthy. The user should be changing the UI's visual roles, not fighting random text/surface heuristics.

## Files

- `src/lib/paletteEngine.js`
- `src/App.jsx`

## Helpers to Add

```js
hexToRgb()
relativeLuminance()
isLightPalette()
getAutoTextColor()
getRoleColor()
getEffectivePalette()
sampleElementSwatch()
detectIsTextLike()
```

## Behavior Rules

### Text + locked

```js
el.isText && el.textLocked
```

Use readable auto-contrast text. Ignore role-based color.

### Text + unlocked

```js
el.isText && !el.textLocked
```

Apply role color as text color.

### Non-text

Apply role color as surface/background color.

## Micro Commits

### Commit 03.01 — Add color/luminance helpers

Add helpers for RGB parsing, luminance, and light/dark palette detection.

Acceptance:

- Helpers are pure functions.
- Invalid hex values do not crash the app.

### Commit 03.02 — Add metadata-first text handling

Update `applyPaletteToElements()` to use `element.isText` and `element.textLocked`.

Acceptance:

- Locked text stays readable.
- Unlocked text uses role color.
- Non-text surfaces keep existing behavior.

### Commit 03.03 — Keep DOM text detection as fallback

If `isText` is missing, fall back to current text-like heuristic.

Acceptance:

- Old element data still works.
- New element data takes precedence.

### Commit 03.04 — Export utility helpers needed by manual add

Export sampling/detection helpers needed by kanban add-class behavior.

Acceptance:

- Manual add can sample swatch and detect text-like status using shared logic.
