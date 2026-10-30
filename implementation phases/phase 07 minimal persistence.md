# Phase 07 — Minimal Persistence

## Goal

Persist the current working session so user corrections survive refresh.

Core idea connection:

> The user should not lose their refined AI mapping. AI maps once, user fixes it, then keeps exploring.

## Files

- `src/App.jsx`
- optional: `src/lib/sessionStorage.js`

## Persisted Shape

```js
{
  version: 1,
  data: {
    html,
    elements,
    paletteIndex,
    lockedRoles,
    lockedColors
  }
}
```

## Storage Key

```js
ui-palette-explorer:session:v1
```

## Micro Commits

### Commit 07.01 — Add session serialization helpers

Create helpers to save/load/clear session state.

Acceptance:

- Bad JSON does not crash app.
- Unknown versions are ignored safely.

### Commit 07.02 — Load session on startup

Initialize state from localStorage when available.

Acceptance:

- Refresh restores current UI, elements, palette index, and locks.
- Empty storage starts cleanly.

### Commit 07.03 — Save session on relevant state changes

Persist after changes to html, elements, palette index, locked roles, or locked colors.

Acceptance:

- Manual edits survive refresh.
- Start Over clears the saved session.

### Commit 07.04 — Add minimal restore/reset safety

Ensure reset clears both React state and persisted state.

Acceptance:

- Start Over returns app to upload state.
- No stale session reappears after reset.
