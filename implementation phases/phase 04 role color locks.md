# Phase 04 — Role Color Locks

## Goal

Allow users to lock primary, secondary, or accent colors while cycling palettes.

Core idea connection:

> Users often like one part of a palette and want to explore around it. Locking preserves the instant Space-cycling loop while giving user control.

## Files

- `src/App.jsx`
- `src/lib/paletteEngine.js`
- `src/components/PaletteStrip.jsx`
- `src/components/ExportPanel.jsx`

## State

```js
const [lockedRoles, setLockedRoles] = useState({
  primary: false,
  secondary: false,
  accent: false,
});

const [lockedColors, setLockedColors] = useState({
  primary: null,
  secondary: null,
  accent: null,
});
```

## Locking Rule

Do not lock from individual element swatches. A role can contain many elements.

Instead:

- Lock primary = store current effective `primary` color.
- Lock secondary = store current effective `secondary` color.
- Lock accent = store current effective `accent` color.

## Effective Palette

```js
const effectivePalette = {
  ...currentPalette,
  primary: lockedRoles.primary ? lockedColors.primary : currentPalette.primary,
  secondary: lockedRoles.secondary ? lockedColors.secondary : currentPalette.secondary,
  accent: lockedRoles.accent ? lockedColors.accent : currentPalette.accent,
};
```

## Micro Commits

### Commit 04.01 — Add locked role state

Add `lockedRoles` and `lockedColors` state to `App.jsx`.

Acceptance:

- State resets on Start Over.
- Defaults are all unlocked.

### Commit 04.02 — Add effective palette calculation

Calculate `effectivePalette` from current palette plus locks.

Acceptance:

- Palette application uses `effectivePalette`.
- No behavior changes when all roles are unlocked.

### Commit 04.03 — Add toggle handler

Add `handleToggleRoleLock(role)`.

Acceptance:

- Locking stores the currently visible role color.
- Unlocking clears or ignores the locked color.

### Commit 04.04 — Pass lock props downstream

Pass `lockedRoles`, `lockedColors`, and toggle handler to `PaletteStrip`.

Acceptance:

- UI layer has everything needed for Phase 05.
