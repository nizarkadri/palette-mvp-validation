# Testing Plan

## Manual Testing

### Upload and AI response

- Upload a screenshot.
- Confirm recreated UI renders.
- Confirm kanban includes surfaces and text elements.
- Confirm no invalid classes appear as useless kanban rows.

### Palette cycling

- Press Space repeatedly.
- Press ArrowRight and ArrowLeft.
- Confirm cycling is instant.
- Confirm no API requests happen during cycling.

### Role locks

- Lock primary and cycle.
- Lock secondary and cycle.
- Lock accent and cycle.
- Lock all three and cycle.
- Unlock each role and confirm cycling resumes.

### Text locks

- Confirm text is readable by default.
- Unlock a text element.
- Move text element between roles.
- Confirm it takes role-based color.
- Lock it again and confirm auto contrast returns.

### Kanban controls

- Drag elements between roles.
- Add an existing class.
- Try adding a nonexistent class.
- Try adding a duplicate class.
- Rename a label.
- Remove an element.
- Confirm removed element styles reset.

### Persistence

- Make several edits.
- Refresh the page.
- Confirm state restores.
- Click Start Over.
- Refresh again.
- Confirm state does not restore.

### Export

- Lock a role.
- Cycle palettes.
- Copy CSS.
- Copy JSON.
- Confirm copied values match visible swatches.

## Build Validation

Run after implementation phases:

```bash
npm run build
```

## Future Automated Tests

Potential tests to add later:

- element normalization unit tests
- palette helper unit tests
- session serialization unit tests
- class validation unit tests
