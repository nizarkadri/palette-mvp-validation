# Phase 08 — Effective Hex Export

## Goal

Expose the exact effective palette hex colors the user is seeing, including locked role colors, without a bulky export panel.

Core idea connection:

> The preview is the source of truth. Export must match the visible result, otherwise the exploration loop loses trust.

## Files

- `src/components/ExportPanel.jsx`
- `src/App.jsx`

## Requirements

Hex copy should use `effectivePalette`, not the raw current palette.

Visible copyable fields:

```js
primary
secondary
accent
text
textMuted
onAccent
```

Do not keep the Copy CSS feature in the refreshed UX. A future advanced export can be added later, but the immediate product should only expose simple copyable hex values.

## Micro Commits

### Commit 08.01 — Pass effective palette to ExportPanel

Update `App.jsx` so export receives visible/effective palette.

Acceptance:

- Export output matches preview colors when roles are unlocked.
- Export output matches preview colors when roles are locked.

### Commit 08.02 — Remove Copy CSS / bulky export UI

Replace the export panel with minimal copyable hex values.

Acceptance:

- No Copy CSS action remains in the refreshed UX.
- Hex values are easy to copy from the palette strip/panel.
- Export UI does not dominate the panel.

### Commit 08.03 — Verify hex copy output manually

Test hex copy after locking roles and cycling.

Acceptance:

- Copied hex values match visible swatches.
