# Phase 06 — Grouped Pill Element Controls

## Goal

Let users fix AI mistakes by recategorizing grouped semantic pills, adding/manual grouping when needed, renaming labels, and text-locking text groups.

Core idea connection:

> AI gives a first pass, but the user needs quick correction controls so their actual UI can be accurately palette-tested.

## Files

- `src/components/RoleKanban.jsx` or a replacement minimalist grouped role panel
- `src/App.jsx`
- `src/lib/paletteEngine.js`
- `src/styles/global.css`

## Required Controls

1. Drag grouped pills between Primary / Secondary / Accent / Custom.
2. Hover pill to highlight all matching preview nodes.
3. Rename label on double-click.
4. Text lock toggle for text groups.
5. Optional manual selector/group input for advanced cleanup.

## Manual Add Behavior

When user enters a class:

1. Check that the class exists inside preview root.
2. Reject duplicates.
3. Sample current color.
4. Detect whether it is text-like.
5. Add element to chosen role.

New grouped pill:

```js
{
  id: className,
  label: className,
  role, // primary | secondary | accent | custom
  selector: `.${className}`,
  selectors: [`.${className}`],
  swatch,
  isText,
  textLocked: isText,
  source: "manual"
}
```

## Micro Commits

### Commit 06.01 — Add App handlers for element updates

Add handlers:

- `handleAddElement(role, className)`
- `handleRemoveElement(id)`
- `handleRenameElement(id, label)`
- `handleToggleTextLock(id)`

Acceptance:

- Handlers update state immutably.
- Duplicate ids are rejected.

### Commit 06.02 — Add class existence validation

Manual class additions must match at least one node inside preview root.

Acceptance:

- Nonexistent classes show an inline error.
- App does not add no-op elements.

### Commit 06.03 — Add add-class inputs to RoleKanban

Add input at the bottom of each role column.

Acceptance:

- Enter submits.
- Empty input is ignored.
- Errors are shown near the input.

### Commit 06.04 — Add Custom move behavior

Show a lightweight way to move a grouped pill out of active mutation.

Acceptance:

- Moving an active pill out of a role sends it to Custom.
- Before moving, inline styles for matching preview nodes are reset.
- Custom pills are not palette-mutated by default.

### Commit 06.05 — Add rename interaction

Double-click label to edit it inline.

Acceptance:

- Enter saves.
- Escape cancels.
- Class/id does not change, only label.

### Commit 06.06 — Add text lock toggle per text item

Show text lock button only when `el.isText` is true.

Acceptance:

- Locked text uses auto contrast.
- Unlocked text uses role-based color.
- Palette reapplies after toggling.
