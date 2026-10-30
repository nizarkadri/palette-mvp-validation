# UI Palette Explorer — MVP

Upload a screenshot of an app or website. A server-side OpenRouter/MiniMax
pipeline first recreates it as high-fidelity static HTML, then semantically
categorizes stable palette hooks as grouped **Primary**, **Secondary**, **Accent**, or
**Custom** pills. From there, everything is free and instant: drag grouped pills
between roles, hover to highlight all matching preview elements, and press
**Space** to cycle through curated palettes applied live with zero further API
calls.

## Architecture

```
Upload screenshot
      │
      ▼
server-side AI pipeline (/api/analyze)
      │
      ├─► screenshot-to-code generation: high-fidelity static HTML
      └─► semantic categorization: grouped [{ id, selectors, label, role, swatch }]
      │
      ▼
React state (src/App.jsx)
      │
      ├─► Minimal grouped role panel — drag/drop across Primary/Secondary/Accent/Custom
      ├─► UiPreview  — responsive preview, mobile/desktop toggle, hover highlights
      └─► PaletteStrip / Space key — cycles PALETTES and exposes copyable hex values
                │
                ▼
      applyPaletteToElements (src/lib/paletteEngine.js)
      — pure DOM style updates, no re-render, no API call
```

## Project structure

```
src/
  App.jsx                 Main component, wires everything together
  main.jsx                React entry point
  components/
    UploadZone.jsx        Drag-and-drop screenshot upload
    UiPreview.jsx         Renders AI-generated responsive HTML, handles highlight
    RoleKanban.jsx         Grouped Primary/Secondary/Accent/Custom pills
    PaletteStrip.jsx       Current palette swatches + prev/next controls + hex copy
    ExportPanel.jsx        Legacy export area; refreshed UX should keep only hex copy
  lib/
    aiAnalysis.js          Browser client for /api/analyze (screenshot -> HTML + roles)
    paletteEngine.js        Applies a palette to elements via inline styles
    palettes.js             Curated palette definitions (12 included)
  styles/
    global.css              All styles
```

## Running locally

```bash
npm install
npm run dev
```

Create a root `.env` file with `OPENROUTER_API_KEY`, then run `npm run dev`.
The Vite dev server provides `POST /api/analyze` locally so the browser never
receives the API key. Production deployments should provide the same endpoint
server-side.

Failed analysis requests and malformed model outputs are saved under
`debug/analysis/<timestamp-id>/` with request metadata, the uploaded image, raw
model output when available, and parse/repair errors. This directory is ignored
by git.

## How the AI call works

`analyzeScreenshot()` posts the image to `/api/analyze`. The local server sends
the image to `minimax/minimax-m3` via OpenRouter in two steps:

1. **Screenshot-to-code generation** recreates the first screen as responsive
   website HTML/CSS with stable `data-palette-id` hooks. It should not force a
   phone/device frame and should avoid internal preview scrolling.
2. **Semantic categorization** maps those hooks to grouped selectors, concise
   human labels, role intent (`primary` / `secondary` / `accent` / `custom`),
   text metadata, rationale, and approximate swatches.

The screenshot-to-code architecture is inspired by the MIT-licensed
`abi/screenshot-to-code` project. If substantial code is copied from that
reference, retain its MIT notice:
`MIT License — Copyright (c) 2023 Abi Raja`.

The frontend never needs to call AI again after this — palette cycling,
mobile/desktop preview toggling, recategorization, hover highlighting, and hex
copy are all pure client-side logic.

## Extending this MVP

- **More palettes**: add entries to `src/lib/palettes.js`. Each needs
  `primary`, `secondary`, `accent`, `text`, `textMuted`, `onAccent`.
- **AI-suggested palettes**: instead of (or alongside) the curated list,
  ask Claude to generate palettes based on a text prompt (app niche, mood,
  light/dark) — same shape as `PALETTES` entries, still applied via
  `applyPaletteToElements`.
- **Complex elements (charts, illustrations)**: for elements too complex to
  recreate as flat HTML, have the AI return an inline SVG with named CSS
  variables for its key colors (e.g. `fill: var(--chart-accent)`), generated
  once on upload. `applyPaletteToElements` can be extended to set those SVG
  custom properties the same way it sets element styles.
- **Persisting results**: the current browser session is saved to
  localStorage with `{ html, elements, paletteIndex, lockedRoles, lockedColors }`
  so refreshes do not lose the active palette exploration state.
