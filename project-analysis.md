# UI Palette Explorer — Project Analysis

## What It Is

A **React + Vite** single-page app that lets users upload a screenshot of any app/website UI, then rapidly explore different color palettes on an AI-recreated version of that UI. Think **Coolors, but applied to your own real UI screenshot** instead of abstract color swatches.

**Live product loop:** Upload screenshot → AI recreates it as HTML + maps semantic color roles → user presses Space to cycle palettes instantly → export final palette as CSS/JSON.

---

## Current State: Implemented

The project is a **working MVP** with most core features built:

### ✅ What's Built and Functional

| Feature | Status | Key File(s) |
|---------|--------|-------------|
| Screenshot upload (drag-and-drop) | ✅ | `UploadZone.jsx` |
| Server-side AI pipeline (`/api/analyze`) | ✅ | `vite.config.js` (Vite plugin) |
| Screenshot-to-code generation (tool-calling agent) | ✅ | `vite.config.js` → `runScreenshotToCodeAgent()` |
| Semantic categorization pass | ✅ | `vite.config.js` + `aiAnalysis.js` |
| HTML sanitization (script/event stripping) | ✅ | `stripUnsafeHtml()` in `vite.config.js` |
| Generation quality validation + auto-retry | ✅ | `generationIssues()` in `vite.config.js` |
| JSON repair for malformed model output | ✅ | `repairModelJson()` in `vite.config.js` |
| Debug session logging | ✅ | `debug/analysis/<timestamp>/` directory |
| Preview rendering (iframe-based) | ✅ | `UiPreview.jsx` |
| 4-column kanban (Primary/Secondary/Accent/Uncategorized) | ✅ | `RoleKanban.jsx` |
| Drag-and-drop role reassignment | ✅ | `RoleKanban.jsx` |
| Manual element add (by selector/class/hook) | ✅ | `RoleKanban.jsx` + `App.jsx` |
| Element remove (→ Uncategorized or delete) | ✅ | `RoleKanban.jsx` + `App.jsx` |
| Element rename (double-click) | ✅ | `RoleKanban.jsx` |
| Text lock toggle per element | ✅ | `RoleKanban.jsx` + `paletteEngine.js` |
| Palette cycling (Space / ← / →) | ✅ | `App.jsx` + `PaletteStrip.jsx` |
| 12 curated palettes | ✅ | `palettes.js` |
| Role color locks (lock primary/secondary/accent) | ✅ | `App.jsx` + `PaletteStrip.jsx` |
| Palette engine (DOM style updates, no re-render) | ✅ | `paletteEngine.js` |
| Auto-contrasting text colors | ✅ | `paletteEngine.js` → `getAutoTextColor()` |
| Export (CSS vars + JSON tokens) | ✅ | `ExportPanel.jsx` |
| Session persistence (localStorage) | ✅ | `App.jsx` → `readStoredSession()` |
| Element validation against generated HTML | ✅ | `filterElementsWithHtmlTargets()` in `aiAnalysis.js` |
| Fallback elements for unmatched hooks | ✅ | `finalizeSemanticElements()` in `vite.config.js` |

### 🏗️ Architecture Decisions

1. **Vite server plugin for `/api/analyze`**: The backend is not a separate server — it's a Vite middleware plugin defined in `vite.config.js`. This keeps the dev setup simple (single `npm run dev`) but means the API key never reaches the browser.

2. **Two-stage AI pipeline**: First a screenshot-to-code agent generates HTML with tool-calling (`create_file`/`edit_file`), then a separate semantic categorization pass maps elements to palette roles. This decoupling was a deliberate pivot from an earlier single-prompt approach that coupled both tasks and produced poor fidelity.

3. **iframe-based preview**: The generated HTML renders in an `<iframe>` with `srcDoc`, providing complete CSS isolation from the host app. Highlight styles are injected into the iframe's document.

4. **Agent tool-calling loop**: The screenshot-to-code generation uses a simplified version of the `abi/screenshot-to-code` agent pattern — up to 6 turns of `create_file`/`edit_file` tool calls, with the model constrained to produce a single `index.html`.

5. **Generation quality gates**: After the first generation pass, the output is checked for common failure modes (icon libraries, emoji icons, device frames, missing bottom nav, white placeholders). If issues are found, a retry is issued with explicit correction instructions.

---

## File-by-File Breakdown

### `vite.config.js` (270+ lines) — The Server-Side Brain

This is the most complex file. It contains:

- **Vite plugin** (`local-analyze-api`) that registers `POST /api/analyze`
- **`runScreenshotToCodeAgent()`**: Multi-turn tool-calling loop (up to 6 turns) with `create_file`/`edit_file` tools
- **`callOpenRouter()`**: Generic OpenRouter API caller with JSON/text mode support
- **`repairModelJson()`**: Second-pass JSON repair when the model returns malformed output
- **`generationIssues()`**: Heuristic quality checks on generated HTML (8 failure patterns)
- **`finalizeSemanticElements()`**: Validates AI-returned elements against actual HTML hooks, adds fallbacks
- **HTML sanitization**: Strips `<script>` tags and inline event handlers
- **Debug session management**: Saves request metadata, images, raw outputs, and errors to `debug/analysis/<id>/`

### `src/App.jsx` — Main Orchestrator

Manages all application state:

- Processing/error/status states for the upload→analysis flow
- `html` and `elements` (the AI pipeline output)
- `paletteIndex`, `isPaletteActive`, `lockedRoles`, `lockedColors`
- `highlightedId` for hover-to-highlight
- Keyboard event listener for Space/←/→
- localStorage session save/restore
- Element CRUD: `handleChangeRole`, `handleAddElement`, `handleRemoveElement`, `handleRenameElement`, `handleToggleTextLock`
- Role color lock toggling with automatic color capture

### `src/lib/aiAnalysis.js` — Browser Client + Shared Prompts

- `analyzeScreenshot()`: Posts to `/api/analyze`, validates response, filters elements against HTML
- `normalizeElement()`: Normalizes AI/manual elements into the full element model
- `filterElementsWithHtmlTargets()`: Drops elements whose selectors don't match the generated HTML
- Exports `SCREENSHOT_TO_CODE_PROMPT` and `SEMANTIC_CATEGORIZATION_PROMPT` (also imported by `vite.config.js`)

### `src/lib/paletteEngine.js` — Palette Application Engine

- `applyPaletteToElements()`: Core function — iterates elements, queries DOM matches, applies role-based colors
- `getAutoTextColor()`: Determines white/black text based on palette luminance
- `detectIsTextLike()`: Heuristic (transparent bg + no block children) for text vs surface
- `sampleElementSwatch()`: Reads computed styles to sample current element color
- `resetElementStyles()`: Clears all inline styles (used on remove/reset)
- `getElementMatches()`: Resolves elements to DOM nodes via selector + legacy fallback

### `src/lib/palettes.js` — 12 Curated Palettes

Each palette: `name`, `primary`, `secondary`, `accent`, `text`, `textMuted`, `onAccent`. Ranges from dark themes (Dark default, Violet night, Ocean deep) to light modes (Light mode, Peach, Mint fresh).

### `src/lib/screenshotToCodePrompts.js` — Ported from `abi/screenshot-to-code`

- `SCREENSHOT_TO_CODE_SYSTEM_PROMPT`: Full agent system prompt with tooling instructions, stack-specific guidance, and local hard constraints (no icon libraries, no device frames, exact SVG icons)
- `SCREENSHOT_TO_CODE_USER_PROMPT`: User message with replication instructions and critical local constraints
- `SCREENSHOT_TO_CODE_STRICT_SYSTEM_PROMPT`: Same as system prompt but with additional local hard constraints appended

### `src/components/UploadZone.jsx`

Drag-and-drop + click-to-upload. Shows spinner + status message during processing.

### `src/components/UiPreview.jsx`

Renders generated HTML in an `<iframe>` via `srcDoc`. Injects `.pe-highlight` CSS rule into the iframe. Updates highlights via `containerRef` when `highlightedElement` changes.

### `src/components/RoleKanban.jsx`

Four-column kanban with:

- Drag-and-drop between columns
- Per-item: swatch, label (double-click to rename), text lock button, remove button
- Per-column: add form with selector/class/hook input + validation
- Hover events drive preview highlighting

### `src/components/PaletteStrip.jsx`

Shows current palette swatches with lock buttons, palette name/counter, prev/next navigation, keyboard hint.

### `src/components/ExportPanel.jsx`

Two buttons: Copy CSS custom properties, Copy JSON tokens (includes lock metadata).

### `src/styles/global.css`

Complete dark-theme UI. CSS custom properties for colors. Responsive layout (sidebar collapses below 800px). All component styles included.

---

## Data Flow

```
User drops screenshot
        │
        ▼
UploadZone → App.handleFileSelected()
        │
        ▼
aiAnalysis.analyzeScreenshot() → POST /api/analyze { base64, mediaType }
        │
        ▼
Vite middleware plugin:
  1. runScreenshotToCodeAgent() → OpenRouter (tool-calling, up to 6 turns)
  2. generationIssues() check → retry if needed
  3. finalizeGeneratedHtml() → strip unsafe HTML
  4. callOpenRouter() → semantic categorization pass
  5. parseOrRepair() → validate/repair JSON
  6. finalizeSemanticElements() → validate against HTML hooks + add fallbacks
  7. Return { html, elements, debug }
        │
        ▼
App: setHtml(), setElements(), reset palette/locks
        │
        ▼
UiPreview: renders html in <iframe>
RoleKanban: shows elements in 4 columns
        │
        ▼
User presses Space → App cycles paletteIndex
        │
        ▼
useEffect → applyPaletteToElements(elements, effectivePalette, previewRoot)
        │
        ▼
paletteEngine: queries DOM nodes, sets inline styles (bg, color, border)
```

---

## Implementation Plan Status

The `implementation plan.md` defines 10 phases. Based on the code:

| Phase | Title | Status |
|-------|-------|--------|
| 01 | Element Model Foundation | ✅ Done |
| 02 | Exhaustive AI Categorization | ✅ Done |
| 03 | Palette Engine Intent Refactor | ✅ Done |
| 04 | Role Color Locks | ✅ Done |
| 05 | Palette Strip Lock UI | ✅ Done |
| 06 | Kanban Element Controls | ✅ Done (add/remove/rename/text-lock) |
| 07 | Minimal Persistence | ✅ Done (localStorage) |
| 08 | Effective Export | ✅ Done (CSS + JSON) |
| 09 | Backend Proxy / Production Safety | ❌ Not started |
| 10 | Screenshot-to-Code Semantic Pipeline | ✅ Done |

**Phases 01–08 and 10 are complete. Phase 09 (production backend proxy) is the main remaining work item.**

---

## Known Gaps / TODOs

| Priority | Gap | Notes |
|----------|-----|-------|
| 🔴 High | **Backend proxy for production** | Currently the Vite plugin only works in dev. Needs a standalone server (Express/Cloudflare Worker/Supabase Edge Function) for production deployment. |
| 🔴 High | **DOMPurify for HTML sanitization** | Current `stripUnsafeHtml()` is regex-based. The implementation plan recommends `dompurify` for robust sanitization before rendering. |
| 🟡 Medium | **AI-suggested palettes from text prompt** | User describes a mood/niche → Claude generates 5 palette suggestions in PALETTES shape. Not yet implemented. |
| 🟡 Medium | **Fidelity improvements** | Complex UIs may miss icons, gradients, shadows. Could add a second "gap analysis" Claude call comparing original screenshot to recreation. |
| 🟡 Medium | **Palette saving + sharing** | Star/save palettes, share URL with encoded config. |
| 🟡 Medium | **Light/dark variant toggle** | Each palette could carry a `darkVariant` property. |
| 🟢 Lower | **Complex element handling (charts/SVGs)** | Inline SVG with CSS custom properties for charts/illustrations. |
| 🟢 Lower | **Deployment target undecided** | Express, Cloudflare Worker, Supabase Edge Function, Vercel — not yet chosen. |

---

## Key Technical Risks

1. **Model dependency**: The entire value proposition depends on the AI model producing high-fidelity HTML. The current MiniMax M3 model may vary in quality. The system has retry logic and fallback element generation, but complex UIs will still have fidelity limits.

2. **Vite plugin coupling**: The `/api/analyze` endpoint is a Vite dev server plugin. This is fine for local dev but cannot be deployed as-is. A production deployment needs a separate server.

3. **No TypeScript**: The entire frontend is plain JavaScript (`.jsx`/`.js`). The implementation plan mentions "no TypeScript yet" — this is intentional for speed but may cause maintenance issues as the codebase grows.

4. **API key in `.env`**: The `.env` file with the OpenRouter key is in the project root. It's gitignored, but should be rotated if it was ever committed to version control.

---

## Project File Tree

```
palette-mvp/app/
├── .env                          # OPENROUTER_API_KEY (gitignored)
├── .gitignore
├── index.html                    # Entry HTML (loads Tabler Icons CDN)
├── package.json                  # React 18 + Vite 5
├── vite.config.js                # Vite config + /api/analyze plugin (main backend)
├── README.md                     # Project docs
├── core idea.md                  # Product vision & key insight
├── implementation plan.md        # 10-phase implementation plan
├── PROMPT_BREAKDOWN.md           # Prompt engineering guide for model compatibility
├── screenshot-to-code-report.md  # Analysis of abi/screenshot-to-code reference
├── project-analysis.md           # This file
├── src/
│   ├── main.jsx                  # React entry point
│   ├── App.jsx                   # Main orchestrator component
│   ├── idea.md                   # Handoff prompt for continuing development
│   ├── test01.jpg                # Test screenshot
│   ├── components/
│   │   ├── UploadZone.jsx        # Drag-and-drop screenshot upload
│   │   ├── UiPreview.jsx         # iframe-based HTML preview + highlight
│   │   ├── RoleKanban.jsx        # 4-column drag/drop kanban
│   │   ├── PaletteStrip.jsx      # Palette swatches + navigation + locks
│   │   └── ExportPanel.jsx       # Copy CSS vars / JSON tokens
│   └── lib/
│       ├── aiAnalysis.js         # Browser client + shared prompts
│       ├── paletteEngine.js      # Palette application via DOM style updates
│       ├── palettes.js           # 12 curated palette definitions
│       └── screenshotToCodePrompts.js  # Ported from abi/screenshot-to-code
├── debug/                        # Auto-generated debug sessions (gitignored)
└── dist/                         # Build output
```
