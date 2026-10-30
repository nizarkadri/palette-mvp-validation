# Implementation Readiness Checklist

Before starting implementation in a new session, confirm these files exist:

- [ ] `core idea.md`
- [ ] `implementation plan.md`
- [ ] `implementation phases/new session handoff.md`
- [ ] `implementation phases/confirmed decisions.md`
- [ ] `implementation phases/autonomous implementation loop.md`
- [ ] `implementation phases/micro commit tracker.md`
- [ ] `implementation phases/phase index.md`
- [ ] `implementation phases/phase 00 decision log.md`
- [ ] `implementation phases/model strategy minimax m3.md`
- [ ] `implementation phases/minimax prompts.md`
- [ ] `implementation phases/openrouter integration notes.md`
- [ ] `implementation phases/testing plan.md`
- [ ] `implementation phases/acceptance checklist.md`

## First Source Files to Inspect

- [ ] `src/App.jsx`
- [ ] `src/lib/aiAnalysis.js`
- [ ] `src/lib/paletteEngine.js`
- [ ] `src/components/RoleKanban.jsx`
- [ ] `src/components/PaletteStrip.jsx`
- [ ] `src/components/ExportPanel.jsx`
- [ ] `src/components/UiPreview.jsx`
- [ ] `src/styles/global.css`

## Confirmed Constraints

- [ ] Do not expose OpenRouter key in browser code.
- [ ] Do not call AI during palette cycling.
- [ ] Do not mutate generated HTML during palette cycling.
- [ ] Reject nonexistent manual classes.
- [ ] Use `palette.primary` for first text contrast implementation.
- [ ] Keep preview-first UX.

## Suggested First Action

Start with:

```txt
Phase 01 — Element Model Foundation
Commit 01.01 — Add element normalization helper
```
