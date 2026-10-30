# UI Palette Explorer — Handoff Prompt

Use this prompt to continue building this project in a new conversation.
Paste it in full at the start of your next session.

---

## MVP Gaps — New Features Added (2026-06-17)

These 4 features were identified as missing from the current MVP and take priority
over the existing backlog (items 1-9 below):

| # | Feature | Priority | Summary |
|---|---------|----------|---------|
| 10 | **Color lock per role** | HIGH | Lock primary/secondary/accent colors during Space cycling; AI palette suggestions adapt to locked colors |
| 11 | **Add/remove elements** | HIGH | Add custom CSS class names to any role column; remove elements from columns |
| 12 | **Categorize ALL elements** | HIGH | AI must identify every element including h1-h6, titles, body text, captions, links — exhaustive, not 6-14 |
| 13 | **Text color lock** | HIGH | Text elements default to locked auto-contrasting color (white/black per palette); user can unlock for role-based coloring |

Each feature is detailed in its own section below.

---

## What this project is

A web app called **UI Palette Explorer** — similar to Coolors but applied to
existing app/website UI screenshots. The core loop:

1. User uploads a screenshot of their app or website
2. One Claude vision API call recreates the UI as simplified static HTML/CSS
   and returns a flat list of identified elements, each pre-sorted into a
   color role: **Primary**, **Secondary**, or **Accent**
3. A three-column kanban panel (one column per role) shows the AI's guesses.
   User can hover any item to highlight the corresponding element(s) in the
   live HTML preview, and drag items between columns to recategorize
4. Pressing **Space** (or ← →) cycles through 12 curated palettes applied
   instantly to the preview via DOM style updates — zero further API calls
5. User copies the current palette as CSS custom properties or JSON tokens

The distinguishing design decisions vs Coolors:
- Works on the user's *own* existing UI (not a blank canvas)
- AI does the semantic grouping (what's a background vs a button vs an icon)
  so the user doesn't have to manually tag everything
- Class-based grouping — clicking/assigning one element in a group updates
  all identical elements (all post cards, all avatars, all action buttons)
- Space-cycling is the primary interaction — pure vibe/feel exploration,
  not fine-grained color picking

---

## Current tech stack

- **React 18 + Vite 5** (no TypeScript yet, no backend)
- **Claude claude-sonnet-4-6** via direct browser fetch to
  `https://api.anthropic.com/v1/messages` — ⚠️ API key is currently NOT
  handled (needs a backend proxy before going to production)
- **Tabler Icons** (CDN webfont) for icons in the shell UI
- No router, no state management library, no CSS framework —
  everything is plain React state + CSS custom properties

---

## Project file structure

```
palette-mvp/
├── index.html
├── vite.config.js
├── package.json
├── README.md
└── src/
    ├── main.jsx
    ├── App.jsx                    ← main orchestrator component
    ├── components/
    │   ├── UploadZone.jsx         ← drag-and-drop screenshot upload
    │   ├── UiPreview.jsx          ← renders AI HTML, handles .pe-highlight
    │   ├── RoleKanban.jsx         ← 3-col drag/drop role assignment
    │   ├── PaletteStrip.jsx       ← swatch strip + prev/next buttons
    │   └── ExportPanel.jsx        ← copy CSS vars / JSON tokens
    ├── lib/
    │   ├── aiAnalysis.js          ← ONE Claude API call lives here
    │   ├── paletteEngine.js       ← applies palette to DOM elements
    │   └── palettes.js            ← 12 curated palette definitions
    └── styles/
        └── global.css
```

---

## How the AI call works (most important file)

`src/lib/aiAnalysis.js` — `analyzeScreenshot(base64, mediaType)`

Sends the screenshot to Claude with a system prompt that instructs it to:

1. Recreate the UI as simplified static HTML/CSS:
   - No JS, no external resources, no real images (colored divs for placeholders)
   - Repeated elements (cards, list rows, icon chips) share the SAME class name
     so they recolor as a group
   - No hardcoded colors in inline styles — colors come from `applyPaletteToElements`
   - Wrap everything in `<div class="ui-root">`

2. Return a flat JSON object:
```json
{
  "html": "<div class=\"ui-root\">...</div>",
  "elements": [
    { "id": "nav-bar",    "label": "Nav bar",          "role": "primary",   "swatch": "#0d0d14" },
    { "id": "post-card",  "label": "Post cards",        "role": "secondary", "swatch": "#161620" },
    { "id": "avatar",     "label": "Avatars",           "role": "accent",    "swatch": "#4a5aff" },
    { "id": "action-btn", "label": "Action buttons",    "role": "secondary", "swatch": "#1e1e2e" },
    { "id": "post-name",  "label": "Usernames",         "role": "accent",    "swatch": "#4a90e2" }
  ]
}
```

Role heuristics used in the prompt:
- `primary` → large structural/background areas (page bg, nav bars, tab bars)
- `secondary` → surfaces on top of primary (cards, panels, badges, muted text)
- `accent` → small high-emphasis interactive/brand elements (CTAs, icons, avatars, links)

---

## How the palette engine works

`src/lib/paletteEngine.js` — `applyPaletteToElements(elements, palette, rootEl)`

Runs on every Space/arrow press. For each element in the list:
- Queries `rootEl.querySelectorAll('.' + id)` to get all matching nodes
- Determines if each node is "text-like" (transparent bg, no children)
  or "surface-like" (has a background)
- Text-like nodes get `color` set; surface-like get `background-color` + `color`
- Role mapping:
  - `primary` → `palette.primary` bg, `palette.text` color
  - `secondary` → `palette.secondary` bg, `palette.text` color
  - `accent` → `palette.accent` bg, `palette.onAccent` color
    (or `palette.accent` as text color if text-like)
- Borders: recolored to match the role surface color if a border is detected

No re-render of the HTML, no re-fetch, no re-parse — just `el.style.*` assignments.

---

## Palette shape (src/lib/palettes.js)

```js
{
  name: 'Violet night',
  primary: '#120a24',
  secondary: '#1f1340',
  accent: '#a78bfa',
  text: '#ede9fe',       // text on primary/secondary surfaces
  textMuted: '#7a6aa8',  // secondary/muted text
  onAccent: '#1a0f33',   // text/icons ON TOP of accent surfaces
}
```

---

## What's NOT built yet (priority order)

### 1. API key / backend proxy [CRITICAL — do this first]
The Claude API call currently goes directly from the browser, meaning the
API key would be exposed. Build a thin backend endpoint:
- `POST /api/analyze` — accepts `{ base64, mediaType }`, makes the Claude
  call server-side, returns `{ html, elements }`
- Simple options: Next.js API route, Cloudflare Worker, Express on Node,
  or a Supabase edge function

### 2. AI-generated palettes from a text prompt [HIGH VALUE]
Currently palettes are hardcoded. Add a text input above the palette strip:
"dark fintech app, trustworthy, modern" → call Claude with that context +
the current element list → Claude returns 5 palette suggestions in the
`PALETTES` array shape → user cycles through those AI-suggested palettes
instead of (or in addition to) the curated ones.

The prompt to generate palettes:
```
Given this UI element list and the user's description, generate 5 palette
suggestions. Each palette should have: name, primary, secondary, accent,
text, textMuted, onAccent. Return only a JSON array, no explanation.

User description: "{userPrompt}"
Elements: {JSON.stringify(elements)}
```

### 3. Fidelity improvements to AI HTML recreation [HIGH VALUE]
The AI-generated HTML varies in fidelity — complex UIs may be missing icons,
gradients, or border details. Options:
- Prompt engineering: add more explicit instructions for icons (use emoji or
  Tabler icon classes), gradients (use CSS gradient syntax), shadows
- Post-process: after getting the HTML back, make a second cheap Claude call
  with a focused prompt: "Here is a recreation of a UI and the original screenshot.
  List up to 5 specific visual details missing from the recreation." Then let
  the user see and dismiss those notes.

### 4. Element group editing in the kanban [MEDIUM]
Currently the kanban items show the AI's label. Add:
- Rename: double-click a kanban item to rename the label
- Expand: clicking a group shows all the CSS classes within it (if AI grouped
  multiple classes under one label)
- Add custom: text input to manually add a CSS class name to a group

### 5. Session persistence [MEDIUM]
Save `{ html, elements, paletteIndex, uploadedImageDataUrl }` to localStorage
so the user can close the tab and return. Add a "recent sessions" list on the
upload screen.

### 6. Palette saving + sharing [MEDIUM]
- User can star/save a palette they like while cycling
- "Saved palettes" tab shows all saved ones with the recreated UI thumbnail
- Share URL: encode the palette + element role assignments as URL params so
  the user can share their configuration

### 7. User's own palette prompt alongside Space cycling [MEDIUM]
Allow the user to describe a palette in freetext ("make it more purple and
warm") and have Claude produce a single one-shot palette suggestion instantly
without leaving the cycling flow — pressing Enter on the prompt generates
and applies it, then Space continues cycling from there.

### 8. Complex element handling (charts, illustrations) [LOWER PRIORITY]
For SVG charts or complex illustrations inside the screenshot:
- AI generates an inline SVG for those elements (instead of a div placeholder)
- SVG uses CSS custom properties for its key colors
  e.g. `fill: var(--chart-primary)` 
- `applyPaletteToElements` sets those CSS vars on the SVG root
This means even charts shift color on Space, with clean edges.

### 9. Light/dark toggle [LOWER PRIORITY]
Add a toggle next to the palette strip that flips between light and dark
variants of the current palette. Each PALETTES entry could carry a
`darkVariant` property that swaps primary/secondary while keeping accent.

### 10. Color lock per role [HIGH PRIORITY]
Allow the user to lock individual color roles (primary, secondary, accent)
so that when Space-cycling palettes, locked roles keep their current color
while unlocked roles change normally.

**UI:** Add a lock icon button next to each color swatch in the PaletteStrip.
Locked roles show a closed lock icon; unlocked show open lock. Click to toggle.

**State:** `lockedRoles: { primary: false, secondary: false, accent: false }`

**Palette engine changes:** In `applyPaletteToElements`, when a role is locked,
use the element's current `swatch` color (or a stored locked color) instead of
the palette's color for that role. Store the locked color at the moment the user
toggles the lock.

**AI palette suggestions adaptation:** When generating AI palettes from a text
prompt, pass the locked color values as constraints:
```
The following colors are locked by the user and MUST be preserved:
- Primary: #120a24 (locked)
- Accent: #a78bfa (locked)
Generate palettes that keep these exact values and only vary the unlocked roles.
```

**Edge case:** If all three roles are locked, Space cycling should still work but
only text colors (text, textMuted, onAccent) change — or show a subtle hint that
everything is locked.

### 11. Add and remove elements from roles [HIGH PRIORITY]
The AI won't always identify every element correctly. Give the user full control
to manage the element list.

**Add element:** At the bottom of each kanban column, add a small "+ Add class"
input. User types a CSS class name that exists in the recreated HTML and presses
Enter. The new element appears in that column with:
- `id`: the class name entered
- `label`: the class name (user can rename via double-click)
- `role`: whichever column they added it to
- `swatch`: sampled from the current computed color of matching DOM nodes
- `isText`: auto-detected via the same heuristic as paletteEngine
- `textLocked`: true if `isText` is true

**Remove element:** Each kanban item gets a small "×" remove button on hover.
Clicking it removes the element from the list entirely. The DOM nodes still
exist in the preview but are no longer recolored by the palette engine.

**Persist:** Added/removed elements are included in session persistence (feature 5).

### 12. Categorize ALL elements including headings and text [HIGH PRIORITY]
The current AI prompt is too loose — it says "typically 6 to 14 entries" which
means many UIs miss headings, body text, captions, links, etc. This must be
exhaustive.

**Updated AI prompt requirements (in `aiAnalysis.js` system prompt):**
- MUST list every visual element in the UI, no exceptions
- ALL text elements must be identified individually by their heading/text level:
  - Page/screen titles → class `page-title` or `screen-title`
  - H1 headings → class `heading-h1`
  - H2 headings → class `heading-h2`
  - H3 headings → class `heading-h3`
  - H4 headings → class `heading-h4`
  - H5 headings → class `heading-h5`
  - H6 headings → class `heading-h6`
  - Body/paragraph text → class `body-text`
  - Caption/muted/helper text → class `caption-text`
  - Button labels → class `button-text`
  - Link text → class `link-text`
  - Placeholder/input value text → class `input-text`
- Each element gets a new `isText` boolean field: `true` for all text-level
  elements (headings, body, captions, links, button labels, etc.)
- Text elements get `textLocked: true` by default (see feature 13)
- Remove the "typically 6 to 14 entries" guidance — instead say "be exhaustive,
typically 12-25 entries for a standard app screen"

**Element response shape update:**
```json
{
  "id": "heading-h1",
  "label": "H1 headings",
  "role": "secondary",
  "swatch": "#1a1a2a",
  "isText": true,
  "textLocked": true
}
```

### 13. Text color lock — auto white/black based on palette [HIGH PRIORITY]
Text elements should NOT blindly take the accent/secondary color when cycling
palettes. By default, text colors should be "locked" to an auto-contrasting
value (white for dark palettes, black for light palettes).

**Default behavior (textLocked: true):**
- The palette engine computes whether the palette is "light" or "dark" by
  checking the perceived lightness of `palette.primary`
- If dark palette → text gets `palette.text` (light color)
- If light palette → text gets a dark color (e.g. `#1a1a2a` or `palette.text`
  if it's already dark enough)
- Muted text gets `palette.textMuted`
- This is the DEFAULT for all text elements — no role-based color assignment

**When user unlocks a text element (textLocked: false):**
- The text element behaves like a normal element and takes the full role-based
  color treatment (e.g. accent color for accent-role text)
- This lets users make headings purple, links green, etc.

**UI in kanban:** Each text element row shows a small lock icon. Locked = auto
contrast color. Unlocked = role-based color. Click to toggle.

**Palette engine changes:**
- Add `isLightPalette(palette)` helper — compute relative luminance of
  `palette.primary` using the standard formula:
  `L = 0.2126*R + 0.7152*G + 0.0722*B` (from sRGB linearization)
- If `textLocked` and `isText`: use `palette.text` for dark palettes, dark
  fallback for light palettes. Ignore role-based color entirely.
- If `!textLocked` and `isText`: use role-based color (accent color for
  accent-role text, etc.)

**Edge case:** Non-text elements are unaffected by this feature. The `textLocked
` flag only applies when `isText: true`.

---

## Known edge cases / things to watch out for

- **Repeated class name conflicts**: if Claude returns a class like `text` or
  `card` that's too generic, it may accidentally match elements in the app
  shell itself (not just the phone preview). The `applyPaletteToElements`
  function scopes queries to `rootEl` (the phone screen div), so this is
  contained — but double-check if shell elements start getting recolored.

- **Text-like detection**: `paletteEngine.js` uses a heuristic
  (transparent bg + no block children) to decide text vs surface. This can
  misclassify some elements. The safe fallback is to treat unrecognized
  elements as surface-like and apply background color.

- **AI HTML recreation fidelity**: expect around 70-85% visual fidelity
  depending on UI complexity. The tool is for palette exploration / vibe
  checking, not pixel-perfect mockup generation — set that expectation in
  the UI copy.

- **API key exposure**: the current code makes the Claude API call from the
  browser (no auth header added yet — you need to add your own). Never ship
  this to production without a backend proxy.

---

## Design principles to maintain

1. **Space bar is the heart of the product** — nothing should slow down
   the cycle loop. API calls, heavy renders, or modals that interrupt it
   kill the core experience.

2. **AI does the thinking once, UI does the feeling** — the AI call is
   a one-time cost at upload. Everything after is instant, free, and
   tactile.

3. **Class-based grouping, not element-based** — one drag in the kanban
   affects ALL instances of that element type. Never regress to per-element
   assignment.

4. **The preview IS the product** — the kanban panel, palette strip, and
   export are supporting cast. The preview pane should always be the
   largest, most prominent part of the layout.