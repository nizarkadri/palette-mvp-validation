# Acceptance Checklist

Use this before marking the implementation complete.

## Core Flow

- [ ] User can upload screenshot.
- [ ] AI returns recreated HTML.
- [ ] AI returns element list.
- [ ] Preview renders generated UI.
- [ ] Space cycles palettes instantly.
- [ ] Arrow keys cycle palettes instantly.

## Element Coverage

- [ ] AI prompt asks for exhaustive elements.
- [ ] Text elements are included.
- [ ] Elements include `isText`.
- [ ] Text elements default to `textLocked: true`.
- [ ] Invalid AI elements do not crash the app.

## User Correction

- [ ] User can drag elements between roles.
- [ ] User can add existing classes manually.
- [ ] User cannot add duplicate classes.
- [ ] User cannot add nonexistent classes.
- [ ] User can remove elements.
- [ ] Removing elements resets inline styles.
- [ ] User can rename labels.
- [ ] User can toggle text lock.

## Palette Locks

- [ ] User can lock primary color.
- [ ] User can lock secondary color.
- [ ] User can lock accent color.
- [ ] Locked colors remain fixed while cycling.
- [ ] Unlocking resumes normal cycling.
- [ ] All-locked state is communicated subtly.

## Text Readability

- [ ] Locked text stays readable on dark palettes.
- [ ] Locked text stays readable on light palettes.
- [ ] Unlocked text uses role-based color.

## Persistence

- [ ] Current session survives refresh.
- [ ] Element edits survive refresh.
- [ ] Locks survive refresh.
- [ ] Start Over clears persisted state.

## Export

- [ ] CSS export matches visible palette.
- [ ] JSON export matches visible palette.
- [ ] Locked role colors are reflected in export.

## Safety

- [ ] AI HTML is sanitized or otherwise constrained.
- [ ] DOM queries are scoped to preview root.
- [ ] No API calls happen while palette cycling.
