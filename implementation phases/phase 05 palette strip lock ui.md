# Phase 05 — Palette Strip Lock UI

## Goal

Expose role locks in the palette strip without slowing down or distracting from palette cycling.

Core idea connection:

> The palette strip should support the main tactile loop. Lock controls must be visible and quick, not modal or workflow-heavy.

## Files

- `src/components/PaletteStrip.jsx`
- `src/styles/global.css`

## UI Requirements

For primary, secondary, and accent swatches:

- Show a lock/unlock button.
- Locked uses `ti-lock`.
- Unlocked uses `ti-lock-open`.
- Locked swatches should have a clear visual state.

Text swatch does not need role lock control in this phase.

## Edge Case

If all three role colors are locked, show a subtle hint:

```txt
All role colors are locked. Unlock a role to see larger palette changes.
```

Space cycling should still work because text colors may still change.

## Micro Commits

### Commit 05.01 — Convert swatches to labeled role controls

Update palette strip markup so role swatches can contain labels and buttons.

Acceptance:

- Primary, secondary, accent, and text colors still display.
- Layout remains compact.

### Commit 05.02 — Add lock buttons

Add lock buttons for primary/secondary/accent.

Acceptance:

- Clicking lock does not trigger unwanted palette navigation.
- Buttons have accessible labels.

### Commit 05.03 — Add locked visual styling

Add CSS for locked swatches/buttons.

Acceptance:

- Locked roles are visibly distinct.
- Hover behavior still feels lightweight.

### Commit 05.04 — Add all-locked hint

Show hint only when primary, secondary, and accent are locked.

Acceptance:

- Hint does not block cycling.
- Hint disappears when any role unlocks.
