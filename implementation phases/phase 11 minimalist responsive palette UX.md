# Phase 11 — Minimalist Responsive Palette UX

## Goal

Refine the MVP into a clean UI-designer-style palette exploration workspace.
Use `finalExpect.png` and `labelsSample.png` as visual references.

Core idea connection:

> The preview is the product. The role panel should feel like a concise
> design tool, not a dense developer dashboard.

## Confirmed Product Decisions

1. **Generated output is website-first and responsive**
   - Treat generated HTML/CSS as a responsive website recreation.
   - Do not treat it as a mobile-app mockup.
   - Do not force a phone/device frame around the generated UI.
   - The generated UI should adapt naturally to mobile and desktop sizes.

2. **Mobile / desktop preview toggle**
   - Add a preview toggle for mobile and desktop modes.
   - The toggle changes the preview viewport/context only.
   - It must not ask AI to regenerate.

3. **One screen at a time**
   - If an uploaded image contains multiple screens, focus on the first screen.
   - Do not generate a combined multi-screen page.
   - Prompts and validation should say: recreate only the first screen.

4. **No scroll inside generated preview**
   - The recreated preview should fit the selected preview viewport.
   - Avoid internal generated CSS scroll regions such as `overflow-y: auto`.
   - Only allow internal scrolling if it is visibly required by the screenshot.
   - The app shell may manage layout, but the preview should not need scrolling.

5. **Minimalist palette panel**
   - Use compact grouped cards like `finalExpect.png`:
     - Primary
     - Secondary
     - Accent
     - Custom
   - Each group shows a count.
   - Each pill shows a small color chip and a concise semantic label.
   - Labels are dynamic per screenshot.
   - Example labels:
     - `Secondary text & labels`
     - `Credit card surface`
     - `Category cards`
     - `List item icon chips`

6. **Grouped pills represent similar elements**
   - Group related selectors under one label when they share a visual role.
   - Hovering a pill highlights all matching elements in the preview.
   - This should behave like `labelsSample.png`.
   - Example: one `Secondary text & labels` pill can highlight all related
     labels/timestamps instead of one pill per text node.

7. **Drag/recategorize pills**
   - Pills must be draggable/recategorizable between:
     - Primary
     - Secondary
     - Accent
     - Custom
   - Custom replaces the old Uncategorized tray language.
   - Custom is for user-defined, uncertain, or intentionally excluded groups.
   - Custom items are not palette-mutated unless later assigned behavior.

8. **Export simplification**
   - Remove the Copy CSS feature.
   - Keep only simple copyable hex codes for the current effective palette.
   - Export UI should not dominate the panel.

## Files Likely Affected Later

- `src/App.jsx`
- `src/components/RoleKanban.jsx` or replacement minimalist panel component
- `src/components/PaletteStrip.jsx`
- `src/components/ExportPanel.jsx` or simplified hex-copy component
- `src/components/UiPreview.jsx`
- `src/lib/aiAnalysis.js`
- `src/lib/paletteEngine.js`
- `src/lib/screenshotToCodePrompts.js`
- `src/styles/global.css`
- `vite.config.js`

## Data Model Requirements

Element/pill records should support grouped selectors:

```js
{
  id: "secondary-text-labels",
  label: "Secondary text & labels",
  role: "secondary", // primary | secondary | accent | custom
  selectors: [".welcome-text", ".caption", ".timestamp"],
  selector: ".welcome-text, .caption, .timestamp",
  swatch: "#D8B8C5",
  rationale: "Repeated muted labels and timestamps",
  isText: true,
  textLocked: true,
  source: "ai"
}
```

Rules:

- `selectors` is preferred for grouped pills.
- `selector` remains as a compatibility alias.
- Hovering a pill highlights every node matching `selectors`.
- Palette application applies to all matching nodes.
- Role values should include `custom`.

## Prompt Requirements

Update generation/categorization prompts so the model knows:

- Recreate only the first screen if multiple screens are present.
- Generate responsive website HTML/CSS, not a fixed phone mockup.
- Do not add a phone/device frame unless it is actual screenshot content.
- Avoid internal preview scrolling.
- Group similar elements into concise semantic labels.
- Prefer grouped selectors for repeated/similar elements.

## Acceptance Criteria

- UI panel visually resembles the grouped structure in `finalExpect.png`.
- Primary / Secondary / Accent / Custom groups are visible with counts.
- Pills are compact, draggable, and recategorizable between all four groups.
- Hovering a grouped pill highlights related elements like `labelsSample.png`.
- Generated preview has mobile/desktop toggle.
- Generated preview does not use a forced mobile frame.
- Generated preview does not scroll internally for normal screenshots.
- Copy CSS export is removed.
- Hex colors remain easy to copy.
- Palette cycling remains instant and local.

## Non-Goals

- Do not implement this phase until explicitly asked.
- Do not add multi-screen generation.
- Do not add full design-system export.
- Do not add AI calls during palette cycling or viewport toggling.
