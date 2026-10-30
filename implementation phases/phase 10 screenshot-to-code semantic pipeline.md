# Phase 10 — Screenshot-to-Code Semantic Pipeline

## Goal

Replace the fragile single-step "AI wireframe + role map" approach with a two-step pipeline inspired by `abi/screenshot-to-code`:

```txt
Screenshot
  ↓
High-fidelity static HTML/CSS generation
  ↓
Semantic element categorization into grouped Primary / Secondary / Accent / Custom pills
  ↓
User correction panel + instant palette cycling
```

Core idea connection:

> The preview is the product. First make the uploaded UI look right; then apply semantic palette roles to stable element hooks.

## License Note

`abi/screenshot-to-code` is MIT licensed:

```txt
MIT License
Copyright (c) 2023 Abi Raja
```

We may copy, modify, merge, and use code directly as long as the copyright and license notice are included in copied/substantial portions.

## Research Notes

- `abi/screenshot-to-code` is the reference architecture, not currently vendored.
- Current implementation ports the architectural split: first generate static HTML, then run a semantic categorization pass.
- Useful reference pattern: keep generated output static and non-functional, store debug artifacts for each run, and validate/repair model JSON locally.
- Decision: prefer porting prompt/API logic over direct code vendoring for now, so no copied source requires an embedded license header. If substantial source is copied later, retain the MIT notice.

## New Architecture

### 1. Fixed App Shell

Keep the UI Palette Explorer app shell constant:

- upload / preview area
- responsive preview container with mobile/desktop toggle
- minimalist grouped role panel
- palette strip / hex swatches

The AI should not generate the whole product shell.

### 2. Screenshot-to-Code Generation

The generator should produce high-fidelity, non-functional responsive website HTML/CSS for the uploaded screenshot content.

Acceptance:

- generated UI visually resembles the screenshot before palette cycling
- if multiple screens are present, only the first screen is recreated
- generated output is responsive and can be previewed at mobile or desktop widths
- do not force a phone/device frame unless the screenshot itself contains a physical device frame as content
- no internal scroll inside the generated preview for normal screenshots
- repeated visible rows/cards are preserved, not summarized
- no generated JS
- no backend/API functionality in generated markup
- debug artifacts save the request image, raw output, generated HTML, and categorized elements

### 3. Stable Palette Hooks

Generated/processed markup must expose stable hooks such as:

```html
<div data-palette-id="post-card">...</div>
<button data-palette-id="primary-cta">...</button>
<span data-palette-id="username-text">...</span>
```

or the existing prototype-compatible form:

```html
<div data-el="card-surface">...</div>
<span data-el="heading">...</span>
```

Decision for implementation: prefer `data-palette-id` for the new pipeline, while supporting `data-el` as a compatibility alias during migration.

### 4. Semantic Categorization

Categorization should be based on UI intent, not just original colors. It should group similar elements into concise screenshot-specific labels suitable for a minimalist panel.

Roles:

- `primary`: app/page background, nav bars, tab bars, main layout containers
- `secondary`: cards, panels, inputs, list rows, dividers, muted surfaces, regular text groups
- `accent`: CTAs, active nav icons, links, chips/badges, avatars, brand marks, highlighted counts/icons
- `custom`: uncertain, user-defined, or intentionally excluded groups

Element/pill shape:

```js
{
  id: "secondary-text-labels",
  selector: ".caption, .timestamp, .muted-label",
  selectors: [".caption", ".timestamp", ".muted-label"],
  label: "Secondary text & labels",
  role: "secondary", // primary | secondary | accent | custom
  rationale: "Repeated muted labels and timestamps",
  isText: true,
  textLocked: true,
  source: "ai" // ai | manual
}
```

`selectors` is preferred for grouped pills; `selector` remains a compatibility alias.

### 5. User Correction Panel

The role panel should show four clean grouped sections:

1. Primary
2. Secondary
3. Accent
4. Custom

Behavior:

- hover pill → highlight all matching preview nodes from all grouped selectors
- drag pill between Primary / Secondary / Accent / Custom
- group counts update live
- optional manual grouping can remain available for advanced cleanup

### 6. Palette Cycling

Palette cycling must remain instant and local.

Rules:

- no API calls during cycling
- scope all DOM queries to preview root
- never mutate generated HTML string during cycling
- only mutate live preview styles or CSS variables
- custom elements keep their generated/default styling unless explicitly assigned behavior later

## Micro Commits

### Commit 10.01 — Document screenshot-to-code license and integration target

Acceptance:

- README or docs mention MIT license obligations.
- Plan names `abi/screenshot-to-code` as the reference implementation.

### Commit 10.02 — Add screenshot-to-code research notes

Acceptance:

- Capture which files/prompts/backend patterns are useful.
- Identify whether to vendor code directly or port prompt/API logic.

### Commit 10.03 — Refactor analysis response schema for two-stage output

Acceptance:

- Generation output can carry high-fidelity HTML separately from semantic elements.
- Element records support `selector`, `role`, `rationale`, and `uncategorized`.

### Commit 10.04 — Generate or post-process stable palette hooks

Acceptance:

- Preview DOM has stable `data-palette-id` or `data-el` hooks.
- Every semantic element points to at least one preview node.

### Commit 10.05 — Add semantic categorization prompt/pass

Acceptance:

- Categorizer receives generated HTML plus screenshot context or UI tree.
- Categorizer assigns roles by intent, not by sampled colors only.
- Categorizer groups similar elements into concise semantic labels.
- Unknown/low-confidence items go to `custom`.

### Commit 10.06 — Update palette engine for selector-based elements

Acceptance:

- Palette engine targets `element.selector` scoped to preview root.
- Backward compatibility remains for old `id`/class or `data-el` entries.
- Uncategorized elements are skipped.

### Commit 10.07 — Add Custom tray behavior

Acceptance:

- Role panel shows Custom.
- Low-confidence/user-defined groups can live in Custom.
- Drag/drop between Primary / Secondary / Accent / Custom works.

### Commit 10.08 — End-to-end test with CondoConnect screenshot

Acceptance:

- Generated preview is visibly close enough before palette cycling.
- Hover highlights all mapped elements.
- Drag/drop role changes affect palette application.
- Space cycling remains instant.
- Debug artifacts are saved for the run.
