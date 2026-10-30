# colorBrain Implementation Plan

This plan turns `colorBrain.md` from a design document into a working palette engine inside the current React/Vite palette app.

## Goal

Build a real `colorBrain` engine that can generate endless UI-ready palettes while preserving creative combinations.

The engine must:

1. Generate or receive creative anchor colors.
2. Convert anchors into usable UI roles.
3. Guarantee readable UI tokens.
4. Avoid boring over-safe results.
5. Keep compatibility with the current app palette shape.
6. Eventually replace the static `PALETTES` list with generated palettes.

## Current app state

Relevant current files:

```txt
src/lib/palettes.js          Static palette list
src/lib/paletteEngine.js     Applies palette colors to recreated HTML
src/App.jsx                  Owns paletteIndex/currentPalette and keyboard cycling
src/components/PaletteStrip.jsx
src/components/VariantPicker.jsx
src/components/UiPreview.jsx
src/components/RoleKanban.jsx
```

Current palette shape:

```ts
{
  name: string,
  primary: string,
  secondary: string,
  accent: string,
  text: string,
  textMuted: string,
  onAccent: string
}
```

Current semantic meaning:

```txt
primary   = large structural/background areas
secondary = cards/surfaces
accent    = buttons, links, icons, emphasis
text      = primary readable text
textMuted = secondary/muted text
onAccent  = text/icon color placed on accent surfaces
```

Important implementation constraint:

> Phase 1 must output this existing shape so the UI does not need a large rewrite.

Later phases can add richer roles such as `background`, `surface`, `primaryButton`, `onPrimary`, `border`, `warning`, etc.

---

# Implementation strategy

Implement colorBrain in layers.

```txt
Phase 1: Local deterministic color engine
Phase 2: Role mapping + repair + scoring
Phase 3: App integration with generated palettes
Phase 4: External API seeders
Phase 5: UI controls and creativity modes
Phase 6: Tests, metrics, and tuning
```

The first working version should be local-only. API sources should come after the mapping/scoring core works.

---

# Phase 1 — Color math foundation

## Objective

Create the low-level utilities colorBrain needs.

## Add files

```txt
src/lib/colorBrain/
  colorMath.js
  contrast.js
  random.js
  types.js
```

## Recommended dependency

Install a perceptual color library:

```bash
npm install culori
```

Why `culori`:

- supports OKLCH/LCH
- good browser compatibility
- lightweight enough for this app
- avoids writing fragile color conversions ourselves

## Required utilities

### `colorMath.js`

Functions:

```ts
normalizeHex(input): string | null
hexToOklch(hex): { l: number, c: number, h: number }
oklchToHex(color): string
mixColors(a, b, amount): string
adjustLightness(hex, delta): string
adjustChroma(hex, multiplier): string
rotateHue(hex, degrees): string
clampToDisplayable(hex): string
```

### `contrast.js`

Functions:

```ts
relativeLuminance(hex): number
contrastRatio(fg, bg): number
bestReadableColor(bg, candidates = ["#ffffff", "#000000"]): string
passesNormalText(fg, bg): boolean // >= 4.5
passesLargeText(fg, bg): boolean  // >= 3.0
```

Note: `src/lib/paletteEngine.js` already has `relativeLuminance`. Move or duplicate carefully. Prefer extracting shared logic into `colorBrain/contrast.js`, then import it where needed.

### `random.js`

Functions:

```ts
seededRandom(seed): () => number
pickWeighted(items, random): item
randomBetween(min, max, random): number
shuffle(items, random): array
```

Seeded randomness matters because generated palettes should be reproducible by id.

## Acceptance criteria

- Can convert hex → OKLCH → hex.
- Can compute WCAG contrast.
- Can choose readable black/white text for any background.
- Utilities have unit tests or at least a local smoke test script.

---

# Phase 2 — Implement the core colorBrain engine

## Objective

Create the real role-mapping, derivation, repair, and scoring engine.

## Add files

```txt
src/lib/colorBrain/
  anchors.js
  roleMapping.js
  deriveTokens.js
  repair.js
  score.js
  generate.js
  index.js
```

---

## 2.1 Anchor palette generation

File:

```txt
src/lib/colorBrain/anchors.js
```

Purpose:

Generate creative anchor colors without worrying too much about final UI safety.

Initial local anchor strategies:

```ts
createAnalogousAnchors(seed, options)
createTriadicAnchors(seed, options)
createSplitComplementAnchors(seed, options)
createMonochromeAnchors(seed, options)
createWildAnchors(seed, options)
createNeutralPlusAccentAnchors(seed, options)
```

Returned shape:

```ts
{
  id: string,
  source: "local",
  strategy: "triadic" | "analogous" | "wild" | ...,
  creativeColors: string[]
}
```

Start with 5 anchors per palette because the existing app expects a compact palette. The engine can later support more.

## 2.2 Role mapping as permutation search

File:

```txt
src/lib/colorBrain/roleMapping.js
```

Purpose:

Try multiple ways to use the anchor colors.

Candidate role seed shape:

```ts
{
  backgroundSeed: string,
  surfaceSeed: string,
  textSeed: string,
  primarySeed: string,
  secondarySeed: string,
  accentSeed: string
}
```

For 5 colors, generate practical permutations instead of assuming fixed order.

Implementation detail:

- Generate all permutations for core roles when count is small.
- Also generate heuristic mappings:
  - lightest low-chroma color as background candidate
  - darkest color as text candidate
  - highest chroma color as accent candidate
  - medium lightness saturated color as primary candidate
- De-duplicate candidates.

Pseudo-code:

```ts
export function createRoleMappingCandidates(creativeColors, options) {
  const normalized = creativeColors.map(toColorProfile)
  const permutations = generatePermutations(normalized)
  const heuristicCandidates = createHeuristicMappings(normalized, options)
  return dedupeMappings([...heuristicCandidates, ...permutations])
}
```

## 2.3 Derive complete UI tokens

File:

```txt
src/lib/colorBrain/deriveTokens.js
```

Purpose:

Turn a role mapping into a full usable theme.

Internal rich token shape:

```ts
{
  background: string,
  surface: string,
  surfaceElevated: string,
  text: string,
  mutedText: string,
  border: string,
  primary: string,
  primaryHover: string,
  onPrimary: string,
  secondary: string,
  onSecondary: string,
  accent: string,
  onAccent: string,
  warning?: string,
  onWarning?: string
}
```

Compatibility output shape:

```ts
{
  name: string,
  primary: tokens.background,
  secondary: tokens.surface,
  accent: tokens.accent,
  text: tokens.text,
  textMuted: tokens.mutedText,
  onAccent: tokens.onAccent
}
```

Important:

The current `primary` key means app background. It does **not** mean brand primary. Internally, colorBrain should use clearer names, then adapt at the boundary.

Adapter:

```ts
export function toLegacyPalette(colorBrainPalette) {
  return {
    name: colorBrainPalette.name,
    primary: colorBrainPalette.roles.background,
    secondary: colorBrainPalette.roles.surface,
    accent: colorBrainPalette.roles.accent,
    text: colorBrainPalette.roles.text,
    textMuted: colorBrainPalette.roles.mutedText,
    onAccent: colorBrainPalette.roles.onAccent,
    _colorBrain: colorBrainPalette
  }
}
```

## 2.4 Repair unsafe usage

File:

```txt
src/lib/colorBrain/repair.js
```

Purpose:

Guarantee every palette becomes usable without rejecting creative colors.

Repair rules:

```txt
If background is unsafe/too loud:
  derive a soft background from a creative anchor.

If text is not readable:
  derive readable text from background.

If mutedText is not readable enough:
  mix text with background, then adjust until contrast >= 3.0.

If accent cannot support readable text:
  set onAccent to black or white, whichever passes.

If a creative color is too unsafe for core UI:
  preserve it as accent/decorative, not background/text.
```

Hard guarantees:

```txt
contrast(text, background) >= 4.5
contrast(text, surface) >= 4.5
contrast(onAccent, accent) >= 4.5
contrast(mutedText, background) >= 3.0 where possible
```

No function in this layer should return “invalid palette”. It should return a repaired palette plus notes.

Example notes:

```ts
[
  "Derived readable text from background.",
  "Moved neon yellow into accent usage.",
  "Softened background from violet anchor."
]
```

## 2.5 Score complete UI themes

File:

```txt
src/lib/colorBrain/score.js
```

Purpose:

Rank many valid themes by usability and creativity.

Score shape:

```ts
{
  total: number,
  accessibility: number,
  roleFit: number,
  visualInterest: number,
  harmony: number,
  distinctiveness: number,
  overSafetyPenalty: number
}
```

Default weighting:

```ts
const WEIGHTS = {
  accessibility: 0.35,
  roleFit: 0.20,
  visualInterest: 0.20,
  harmony: 0.15,
  distinctiveness: 0.10,
}
```

Creativity mode should adjust weights:

```txt
safe       → higher accessibility/roleFit, lower visualInterest
balanced   → default
expressive → higher visualInterest/distinctiveness
wild       → highest visualInterest, relaxed soft roleFit penalties
```

Important:

Accessibility remains a hard guarantee in every mode.

## 2.6 Main generator

File:

```txt
src/lib/colorBrain/generate.js
```

API:

```ts
export function generateColorBrainPalettes({
  seedColor,
  lockedColors = [],
  count = 24,
  theme = "auto", // light | dark | auto
  creativity = "balanced", // safe | balanced | expressive | wild
  source = "local",
  randomSeed,
})
```

Return shape:

```ts
{
  palettes: ColorBrainPalette[],
  legacyPalettes: LegacyPalette[],
  diagnostics: {
    generatedAnchors: number,
    mappingCandidates: number,
    repairedCandidates: number,
    returned: number
  }
}
```

---

# Phase 3 — Integrate with the current app

## Objective

Replace static-only palette cycling with generated colorBrain palettes while keeping the app stable.

## 3.1 Keep static palettes as fallback

Do not delete `src/lib/palettes.js` yet.

Instead:

```ts
import { PALETTES as STATIC_PALETTES } from "./lib/palettes.js";
import { generateColorBrainPalettes } from "./lib/colorBrain/index.js";
```

On startup:

```ts
const generated = generateColorBrainPalettes({ count: 36, creativity: "balanced" })
const palettes = [...generated.legacyPalettes, ...STATIC_PALETTES]
```

## 3.2 App state changes

Current:

```ts
const [paletteIndex, setPaletteIndex] = useState(0);
const currentPalette = PALETTES[paletteIndex];
```

Target:

```ts
const [paletteBatch, setPaletteBatch] = useState(() => createInitialPaletteBatch());
const [paletteIndex, setPaletteIndex] = useState(0);
const currentPalette = paletteBatch[paletteIndex];
```

When the user cycles beyond the current batch:

```ts
appendMoreColorBrainPalettes()
```

This creates the “unlimited palettes” behavior.

## 3.3 Keyboard behavior

Current app likely cycles palettes with keyboard shortcuts.

Keep that behavior:

```txt
Space / next action → next palette
If near end of batch → generate more
```

## 3.4 Snappy palette switching requirement

Palette switching must feel instant. Pressing Space should never wait for API calls, heavy scoring, or async generation.

Required behavior:

```txt
Space hit
→ immediately move to the next already-generated palette
→ apply inline styles synchronously
→ schedule more palette generation in the background only if needed
```

Implementation rules:

- Keep a precomputed in-memory queue of palettes.
- Generate an initial batch before the user starts cycling.
- Maintain a buffer, for example 48–100 palettes ahead.
- When the user reaches a threshold, such as 70% through the queue, generate/append the next batch in the background.
- Never put external API calls on the Space key path.
- Never run full permutation/scoring work inside the keydown handler.
- If the queue somehow runs low, loop existing palettes or append local fast-generated palettes immediately while richer palettes continue loading.

Suggested state:

```ts
const PALETTE_LOW_WATERMARK = 24;
const PALETTE_BATCH_SIZE = 64;
const [paletteBatch, setPaletteBatch] = useState(() => createInitialPaletteBatch());
const [isGeneratingMore, setIsGeneratingMore] = useState(false);
```

Suggested cycle behavior:

```ts
function goToNextPalette() {
  setPaletteIndex((index) => {
    const nextIndex = index + 1;
    maybeGenerateMorePalettes(nextIndex);
    return nextIndex % paletteBatch.length;
  });
}
```

`maybeGenerateMorePalettes()` must not block the UI. It should use one of:

```txt
requestIdleCallback
setTimeout(..., 0)
Web Worker for heavier generation
server/API prefetch for external seeders
```

External API seeders should fill a future queue, not the current interaction queue.

```txt
Immediate queue: local generated palettes
Future queue: API-enhanced palettes appended when ready
```

This means the user can rapidly hit Space and always see a new palette with no visible wait time.

## 3.5 Palette strip UI

Update `PaletteStrip.jsx` to show:

- background
- surface
- accent
- text
- mutedText
- optional creative anchor colors if `_colorBrain` exists

Avoid exposing too many technical tokens at first.

## 3.6 Debug/diagnostics panel

In development mode, show optional colorBrain details:

```txt
score
strategy
creativity
repair notes
contrast ratios
creative colors
```

This will be useful for tuning.

---

# Phase 4 — External API seeders

## Objective

Add Huemint, Colormind, and The Color API as optional sources for creative anchors.

Important:

> External APIs should only generate anchors. colorBrain still owns mapping, repair, and scoring.

## Add server routes

Since commercial/API/CORS concerns exist, call external APIs from the server/plugin side.

Add:

```txt
server/routes/colorbrain.js
server/services/colorSources/
  huemint.js
  colormind.js
  theColorApi.js
```

Possible endpoint:

```txt
POST /api/colorbrain/anchors
```

Request:

```ts
{
  source: "huemint" | "colormind" | "the-color-api" | "mixed",
  seedColor?: string,
  lockedColors?: string[],
  count?: number,
  creativity?: "safe" | "balanced" | "expressive" | "wild"
}
```

Response:

```ts
{
  anchorPalettes: Array<{
    source: string,
    creativeColors: string[],
    raw?: unknown
  }>
}
```

Then client-side colorBrain converts anchors to UI palettes.

## Fallback behavior

If APIs fail:

```txt
Use local generation silently.
Do not block palette generation.
```

## API usage order

Recommended:

1. Local generator first, to ship fast.
2. Colormind second, because simple response.
3. Huemint third, because richer but more tuning.
4. The Color API for deterministic seed variations.

---

# Phase 5 — Product controls

## Objective

Expose colorBrain without overwhelming the user.

## Initial controls

Add a compact control area:

```txt
Creativity: Safe / Balanced / Expressive / Wild
Theme: Auto / Light / Dark
Seed color: optional
Generate more
```

## Later controls

```txt
Lock this color
Use this as accent
More like this
Less safe / More safe
Export palette
Show contrast details
```

## UX rule

Do not show failures. Every generated palette is valid.

If repair happened, show it positively:

```txt
“Adapted for readable UI”
“Creative accent preserved”
“Soft background derived”
```

---

# Phase 6 — Testing and tuning

## Add test tooling

Current package has no test script.

Add:

```bash
npm install -D vitest
```

Package script:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

## Unit tests

Add:

```txt
src/lib/colorBrain/__tests__/
  contrast.test.js
  deriveTokens.test.js
  repair.test.js
  score.test.js
  generate.test.js
```

Critical tests:

```txt
Any generated palette has text/background contrast >= 4.5.
Any generated accent has onAccent/accent contrast >= 4.5.
Generator returns requested count.
Generator never returns empty unless count is 0.
Wild mode has higher average chroma than safe mode.
Repair preserves at least one original creative color as accent/primary/secondary.
Legacy adapter returns current app-compatible keys.
```

## Visual/manual tests

Create a small debug page or panel that renders:

```txt
button
card
input
badge
navigation
muted text
alert
```

Then inspect generated palettes in all modes.

## Regression checks

Run before merging:

```bash
npm run build
npm run test
```

---

# Milestone breakdown

## Milestone 1 — Local engine MVP

Deliverables:

```txt
color math utilities
contrast utilities
local anchor generation
basic role mapping
token derivation
legacy adapter
```

Success:

```txt
generateColorBrainPalettes({ count: 12 }) returns 12 app-compatible palettes.
```

## Milestone 2 — Guaranteed usability

Deliverables:

```txt
repair layer
contrast guarantees
scoring model
creativity modes
```

Success:

```txt
100 generated palettes all pass required contrast checks.
```

## Milestone 3 — App integration

Deliverables:

```txt
App uses generated palettes
Space/next can cycle indefinitely
PaletteStrip shows generated palettes
Static palettes remain fallback
```

Success:

```txt
User can keep cycling and see fresh valid palettes without reload.
```

## Milestone 4 — API seeders

Deliverables:

```txt
server colorbrain route
Colormind integration
Huemint integration
The Color API integration
local fallback
```

Success:

```txt
External anchors appear in generated palette batch, but app still works offline/local.
```

## Milestone 5 — Tuning and polish

Deliverables:

```txt
creativity controls
seed color control
repair notes
contrast diagnostics
export updates
```

Success:

```txt
User can intentionally explore safe, balanced, expressive, and wild UI palettes.
```

---

# Suggested implementation order by file

1. `src/lib/colorBrain/contrast.js`
2. `src/lib/colorBrain/colorMath.js`
3. `src/lib/colorBrain/random.js`
4. `src/lib/colorBrain/anchors.js`
5. `src/lib/colorBrain/roleMapping.js`
6. `src/lib/colorBrain/deriveTokens.js`
7. `src/lib/colorBrain/repair.js`
8. `src/lib/colorBrain/score.js`
9. `src/lib/colorBrain/generate.js`
10. `src/lib/colorBrain/index.js`
11. `src/App.jsx` integration
12. `src/components/PaletteStrip.jsx` update
13. tests
14. server API seeders

---

# Key engineering decisions

## Decision 1: Keep legacy palette compatibility first

Reason:

The current app already recolors recreated HTML using:

```txt
primary / secondary / accent / text / textMuted / onAccent
```

Do not rewrite the rendering engine before proving colorBrain works.

## Decision 2: Internal names should be clearer than legacy names

Internally use:

```txt
background / surface / brandPrimary / accent / text / mutedText
```

Then map to legacy names only at the final adapter.

## Decision 3: No invalid palette state

The engine must always return usable palettes by deriving support tokens.

## Decision 4: APIs are optional seed sources

The app should not depend on Huemint, Colormind, or The Color API to work.

## Decision 5: Creativity is a scoring input, not a separate generator

Same pipeline, different weights/soft constraints.

---

# Risks and mitigations

## Risk: Palettes become too safe and boring

Mitigation:

- add `visualInterestScore`
- add `overSafetyPenalty`
- preserve original creative anchors
- tune expressive/wild modes with higher chroma and hue distance

## Risk: Palettes become creative but ugly

Mitigation:

- score harmony and role fit
- preview on real UI components
- keep accessibility hard rules
- tune with screenshots and manual review

## Risk: Current `primary` naming causes confusion

Mitigation:

- use internal `background`
- convert via `toLegacyPalette()` only at app boundary
- later rename app roles if needed

## Risk: External APIs fail or change

Mitigation:

- local generator is always available
- API route catches errors
- no API response is trusted as final UI tokens

## Risk: Performance issues from many permutations

Mitigation:

- for 5 colors, full permutation is cheap
- cap candidate mappings per anchor palette
- score and keep top N early
- keep a large precomputed palette queue in memory
- generate more palettes before the user reaches the end of the queue
- never do generation/scoring/API calls directly inside the Space key handler
- use local fast generation as the instant fallback while API-enhanced palettes load later

---

# Definition of done

colorBrain is considered real and working when:

1. The app no longer depends only on the static `PALETTES` list.
2. The user can cycle through generated palettes indefinitely.
3. Every returned palette has readable text/background and accent/onAccent pairs.
4. Generated palettes retain surprising creative color combinations.
5. The app can produce safe, balanced, expressive, and wild palettes.
6. Static palettes remain available as fallback.
7. Tests verify contrast guarantees and non-empty generation.
8. The implementation remains compatible with the current preview recoloring system.
