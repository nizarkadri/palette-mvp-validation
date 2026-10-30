# Implementation Plan — UI Palette Explorer

This plan keeps the core product idea at the center of every decision:

> **Upload your UI → AI understands the visual roles → user rapidly vibe-tests palettes on something that looks like their actual product.**

The product is not just a color generator. It is an instant palette exploration workflow for an existing UI screenshot.

## Product North Star

Every implementation decision should protect these principles:

1. **High-fidelity first, semantics second**
   - AI first produces a screenshot-to-code style static HTML/CSS replica.
   - A semantic pass then categorizes stable preview hooks into color roles.
   - The generated UI should look right before palette cycling begins.

2. **Fast tactile exploration**
   - Space/arrow palette cycling must remain instant.
   - No API calls during cycling.
   - Avoid heavy React rerenders during cycling.

3. **User correction without friction**
   - AI will be imperfect.
   - The user must be able to fix roles, missed hooks, text behavior, and locked colors quickly.
   - Removing an element from a category should move it to an Uncategorized tray instead of deleting it.

4. **Preview-first experience**
   - The preview is the product.
   - Side panels support the preview; they should not dominate it.

5. **Responsive website output, not device mockups**
   - Generated HTML/CSS should be treated as responsive website code.
   - Do not force a phone/device frame around the generated result.
   - Provide mobile/desktop preview modes by changing the preview viewport, not by regenerating.

6. **Minimalist grouped role panel**
   - The panel should look and feel like a clean design tool, inspired by `finalExpect.png` and `labelsSample.png`.
   - Similar elements should be grouped under concise semantic pills.
   - Hovering one grouped pill should highlight all matching preview elements.

## Phase Files

Each phase has a separate file with micro-commit-sized steps:

1. [Phase 01 — Element Model Foundation](implementation phases/phase 01 element model foundation.md)
2. [Phase 02 — Exhaustive AI Categorization](implementation phases/phase 02 exhaustive ai categorization.md)
3. [Phase 03 — Palette Engine Intent Refactor](implementation phases/phase 03 palette engine intent refactor.md)
4. [Phase 04 — Role Color Locks](implementation phases/phase 04 role color locks.md)
5. [Phase 05 — Palette Strip Lock UI](implementation phases/phase 05 palette strip lock ui.md)
6. [Phase 06 — Kanban Element Controls](implementation phases/phase 06 kanban element controls.md)
7. [Phase 07 — Minimal Persistence](implementation phases/phase 07 minimal persistence.md)
8. [Phase 08 — Effective Export](implementation phases/phase 08 effective export.md)
9. [Phase 09 — Backend Proxy / Production Safety](implementation phases/phase 09 backend proxy production safety.md)
10. [Phase 10 — Screenshot-to-Code Semantic Pipeline](implementation phases/phase 10 screenshot-to-code semantic pipeline.md)
11. [Phase 11 — Minimalist Responsive Palette UX](implementation phases/phase 11 minimalist responsive palette UX.md)

## Recommended Implementation Order

1. Pivot generation to a screenshot-to-code style pipeline:
   - use `abi/screenshot-to-code` as the MIT-licensed reference implementation
   - generate a high-fidelity static HTML/CSS replica first
   - do not ask this generation step to solve palette semantics at the same time

2. Add a semantic categorization step:
   - categorize generated hooks by UI intent into Primary / Secondary / Accent / Custom
   - group similar elements into one concise label/pill where appropriate
   - use original colors only as supporting evidence, not as the main rule
   - preserve low-confidence or user-defined items in Custom

3. Keep the correction and cycling loop instant:
   - hover highlights all nodes represented by a grouped pill
   - drag/drop moves pills between Primary / Secondary / Accent / Custom
   - palette cycling remains local and never calls AI
   - mobile/desktop preview toggle never calls AI

Reason: visual fidelity and semantic palette intent are separate problems. The preview must look like the screenshot first; then users can correct semantic color roles quickly.

## Global Acceptance Criteria

The implementation is successful when:

1. User uploads a screenshot and receives a high-fidelity static UI replica.
2. Generated/processed preview DOM has stable palette hooks.
3. Semantic elements are categorized into Primary / Secondary / Accent / Custom by UI intent.
4. Similar elements can be grouped into one concise pill/label.
5. User can hover any grouped pill and see all matching preview nodes highlighted.
6. User can drag pills between Primary / Secondary / Accent / Custom.
7. Generated preview supports mobile/desktop viewport toggle without regeneration.
8. Generated output is responsive website HTML/CSS, not a forced mobile frame.
9. Generated preview has no internal scroll for normal screenshots.
10. Multi-screen screenshots automatically focus on the first screen only.
11. User can lock/unlock text coloring.
12. User can lock primary/secondary/accent colors.
13. Pressing Space still cycles palettes instantly.
14. Locked role colors stay fixed while cycling.
15. Custom elements are not palette-mutated unless explicitly assigned behavior later.
16. Text remains readable by default.
17. Export is simplified to copyable effective palette hex codes only; no Copy CSS feature.
18. Refresh does not lose the current session.

## Strategic Pivot — Screenshot-to-Code + Semantic Roles

The previous prompt tried to make one model produce both a usable UI replica and a color-role map. Testing showed that this couples two hard tasks and creates poor visual fidelity.

New approach:

```txt
Screenshot
  ↓
screenshot-to-code style generator
  ↓
high-fidelity static HTML/CSS
  ↓
semantic categorizer
  ↓
grouped Primary / Secondary / Accent / Custom pills
  ↓
user correction + instant local palette cycling
```

`abi/screenshot-to-code` is MIT licensed and can be used directly or ported, provided the MIT notice is retained for copied/substantial portions.

## Key Gap Fixes

### 1. Generated HTML Safety

The app renders AI output with `dangerouslySetInnerHTML`. Add sanitization before rendering or before storing returned HTML.

Recommended dependency:

```bash
npm install dompurify
```

### 2. Validate AI Response

After parsing generation/categorization output, validate:

- generated `html` exists
- semantic `elements` is an array
- roles are valid, including `custom`
- selectors or hook ids appear in the preview DOM
- duplicate ids/selectors are handled
- `isText` and `textLocked` are normalized
- low-confidence elements can safely land in Custom

### 3. Reject Invalid Manual Hooks

Manual selectors/classes/data hooks should exist in the preview DOM. A nonexistent hook creates a panel item that does nothing, which weakens user trust.

### 4. Keep Cycling Lightweight

Never mutate `html` during palette cycling. Palette cycling should only run DOM style updates in `paletteEngine.js`.

### 5. Scope DOM Queries to Preview Root

Always query inside the preview root:

```js
root.querySelectorAll(...)
```

Never use global queries for palette application.

## Open Questions Before Coding

1. Should backend proxy be implemented now, or after the core UX loop?
2. If backend is now, what deployment target should be used?
   - Express
   - Cloudflare Worker
   - Supabase Edge Function
   - Vercel/Next route
   - other
3. Should invalid manual classes be rejected? Recommendation: yes.
4. Should text contrast use only `palette.primary`, or actual element/background contrast? Recommendation: start with `palette.primary`, improve later.

## Model Decision

Current model/integration strategy:

```txt
Reference implementation: abi/screenshot-to-code
License: MIT
Provider: OpenRouter initially, matching local key setup
Model: to be selected after comparing screenshot-to-code defaults and current MiniMax M3 behavior
Use cases:
  1. screenshot-to-code style static UI generation
  2. semantic categorization of stable hooks into palette roles
  3. optional validation/retry
```

Deterministic local validation remains mandatory. The model should not replace code checks for JSON shape, selector coverage, valid roles, valid swatches, duplicate ids, or custom fallback behavior.
