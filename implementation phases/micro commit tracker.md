# Micro Commit Tracker

Use this file to track implementation progress across phases.

## Phase 01 — Element Model Foundation

- [x] 01.01 Add element normalization helper
- [x] 01.02 Use normalization in AI response parsing
- [x] 01.03 Update JSDoc/comments for element model

## Phase 02 — Exhaustive AI Categorization

- [x] 02.01 Update prompt response schema
- [x] 02.02 Replace focused list wording with exhaustive wording
- [x] 02.03 Add class coverage validation
- [x] 02.04 Add MiniMax validation prompt draft

## Phase 03 — Palette Engine Intent Refactor

- [x] 03.01 Add color/luminance helpers
- [x] 03.02 Add metadata-first text handling
- [x] 03.03 Keep DOM text detection as fallback
- [x] 03.04 Export utility helpers needed by manual add

## Phase 04 — Role Color Locks

- [x] 04.01 Add locked role state
- [x] 04.02 Add effective palette calculation
- [x] 04.03 Add toggle handler
- [x] 04.04 Pass lock props downstream

## Phase 05 — Palette Strip Lock UI

- [x] 05.01 Convert swatches to labeled role controls
- [x] 05.02 Add lock buttons
- [x] 05.03 Add locked visual styling
- [x] 05.04 Add all-locked hint

## Phase 06 — Kanban Element Controls

- [x] 06.01 Add App handlers for element updates
- [x] 06.02 Add class existence validation
- [x] 06.03 Add add-class inputs to RoleKanban
- [x] 06.04 Add remove button
- [x] 06.05 Add rename interaction
- [x] 06.06 Add text lock toggle per text item

## Phase 07 — Minimal Persistence

- [x] 07.01 Add session serialization helpers
- [x] 07.02 Load session on startup
- [x] 07.03 Save session on relevant state changes
- [x] 07.04 Add minimal restore/reset safety

## Phase 08 — Effective Hex Export

- [x] 08.01 Pass effective palette to ExportPanel
- [ ] 08.02 Remove Copy CSS / bulky export UI in refreshed UX
- [ ] 08.03 Verify hex copy output manually

## Phase 09 — Backend Proxy / Production Safety

- [x] 09.01 Document MiniMax/OpenRouter model target
- [x] 09.02 Add backend endpoint
- [x] 09.03 Move prompt/server OpenRouter call to backend
- [x] 09.04 Update frontend analyzeScreenshot client
- [x] 09.05 Document env and run commands
- [ ] 09.06 Add optional MiniMax validation pass

## Phase 10 — Screenshot-to-Code Semantic Pipeline

- [x] 10.01 Document screenshot-to-code license and integration target
- [x] 10.02 Add screenshot-to-code research notes
- [x] 10.03 Refactor analysis response schema for two-stage output
- [x] 10.04 Generate or post-process stable palette hooks
- [x] 10.05 Add semantic categorization prompt/pass
- [x] 10.06 Update palette engine for selector-based elements
- [x] 10.07 Add Uncategorized tray behavior
- [ ] 10.08 End-to-end test with CondoConnect screenshot

## Phase 11 — Minimalist Responsive Palette UX

- [ ] 11.01 Update prompts for first-screen-only responsive website generation
- [ ] 11.02 Add mobile/desktop preview toggle
- [ ] 11.03 Prevent internal scroll inside generated preview
- [ ] 11.04 Replace dense panel with minimalist grouped role sections
- [ ] 11.05 Support grouped selectors per pill
- [ ] 11.06 Highlight all grouped matches on pill hover
- [ ] 11.07 Drag/recategorize pills between Primary/Secondary/Accent/Custom
- [ ] 11.08 Remove Copy CSS and keep copyable hex colors only
