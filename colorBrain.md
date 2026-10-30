# colorBrain

A design-intelligent color engine for generating **unlimited UI-ready 5-color palettes** that feel closer to curated design tools such as Coolors while remaining accessible and practical in real UI components.

## Updated direction

The current local generation approach is too mathematical/random. The next version should stop treating palette generation as:

```txt
random colors → repair
```

and instead treat it as:

```txt
candidate 5-color UI theme
→ compatibility score
→ role-fit score
→ prototype/taste score
→ dedupe/rank
→ final palette
```

The product should generate complete UI themes, not loose color sets.

## Phase 7 — Palette quality engine

This phase focuses on making colorBrain feel more design-intelligent.

Scope:

1. Stable 5-swatch visible palette strip.
2. Recipe-based local generation.
3. Stronger taste scoring.
4. Background API refill at low queue watermark.
5. Palette memory, dedupe, and ranking before appending palettes.

## Non-negotiable UI rule: stable visible swatches

The main palette strip must always show the same 5 UI roles:

```txt
Background | Surface | Accent | Text | Muted
```

No creative anchors, generated seeds, debug colors, or extra support tokens should appear in the main strip.

Additional colors may exist internally:

```txt
primary
secondary
onAccent
border
success
warning
danger
surfaceElevated
creativeColors
apiAnchors
```

But they belong in:

```txt
details/debug panel
secondary mini-row
score breakdown
not the main palette strip
```

This keeps the product visually predictable and helps users judge every palette as a real UI theme.

## Core research principles

### 1. Palettes are judged as complete 5-color themes

O’Donovan et al.’s **Color Compatibility From Large Datasets** learned scoring models from large human-made palette datasets and evaluated the quality of five-color themes.

For colorBrain, this means scoring should happen at the complete-theme level:

```txt
Background + Surface + Accent + Text + Muted
```

not as independent pairwise color choices.

### 2. UI color is about purpose

The **Palette, Purpose, Prototype** research reinforces that designers evaluate color through:

```txt
Palette  → the color set
Purpose  → what the product/UI should communicate
Prototype → how colors behave in actual components
```

So colorBrain should score palettes inside UI-like usage, not only as abstract swatches.

### 3. Semantic role context matters

GUI colorization research uses semantic context such as application type, text concept, and UI element importance.

For us, colors should understand their intended jobs:

```txt
background
surface
primary action
secondary action
accent
text
muted text
warning
success
```

A neon color may be excellent as a badge/accent and terrible as a background.

### 4. External palette APIs are inspiration, not authority

Huemint, Colormind, and The Color API should be used as taste seeders:

```txt
API anchors
→ role mapping
→ repair
→ taste scoring
→ dedupe
→ append only top palettes
```

They should not directly own the visible UI palette.

## Architecture overview

```txt
Recipe intent / locked color / API anchor
        ↓
Generate candidate 5-role UI themes
        ↓
Normalize in OKLCH/HCT-style perceptual space
        ↓
Apply hard accessibility and role gates
        ↓
Repair specific failing roles
        ↓
Score complete palette in UI context
        ↓
Dedupe against queue + palette memory
        ↓
Rank and append best palettes
```

## Two-layer model

### 1. Visible UI palette layer

This is the primary user-facing palette.

```ts
visibleRoles: {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  accent: "#FA5C7C",
  text: "#111827",
  muted: "#64748B"
}
```

This is what the main palette strip displays.

### 2. Extended UI token layer

This is the practical design-system layer used for previews and exports.

```ts
roles: {
  background: "#F8FAFC",
  surface: "#FFFFFF",
  surfaceElevated: "#FFFFFF",
  text: "#111827",
  mutedText: "#64748B",
  border: "#E2E8F0",
  primary: "#4C1D95",
  onPrimary: "#FFFFFF",
  secondary: "#2DD4BF",
  onSecondary: "#042F2E",
  accent: "#FA5C7C",
  onAccent: "#FFFFFF",
  warning: "#FACC15",
  onWarning: "#2A2100"
}
```

The visible role count stays stable even when the extended token set grows.

## Recipe-based local generation

Local generation should be the primary initial source. It should generate curated UI themes instead of random hue rotations.

Initial load target:

```txt
30–40 high-quality local recipe palettes
```

Example recipes:

```txt
Soft editorial
Dark premium
Warm minimal
Fresh SaaS
Pastel product
Bold pop
Earthy organic
Mono luxe
High contrast neon
Calm healthcare
Fintech blue-green
Creative portfolio
Luxury neutral
Playful candy
Brutalist contrast
```

Each recipe should define constraints, not fixed colors.

Example:

```ts
{
  id: "soft-editorial",
  label: "Soft editorial",
  mood: "editorial",
  mode: "light",
  hueLogic: "analogous",
  chromaBudget: "low-medium",
  surprise: 0.25,

  background: {
    lightness: [0.94, 0.99],
    chroma: [0.0, 0.04]
  },

  surface: {
    relation: "near-background",
    deltaLightness: [-0.02, 0.03],
    chromaMax: 0.04
  },

  text: {
    contrast: "high",
    chromaMax: 0.06
  },

  muted: {
    contrast: "medium",
    chromaMax: 0.08
  },

  accent: {
    lightness: [0.45, 0.72],
    chroma: [0.12, 0.28]
  }
}
```

Useful hue strategies:

```txt
analogous
split-complement
warm-cool
mono-pop
neutral-plus-accent
near-complementary
triadic-muted
```

## Role-first generation

Recipes should generate candidate roles directly:

```txt
background
surface
accent
text
muted
```

Then derive support tokens from those roles.

This is better than generating five arbitrary colors and trying to repair them afterward.

## External generation sources

Use external APIs as background inspiration.

### Expected behavior

```txt
Initial load:
  generate 30–40 local recipe palettes

When remaining palettes ≈ 20:
  call /api/colorbrain/anchors in background

API anchors:
  Huemint / Colormind / The Color API
  → map to roles
  → repair
  → taste score
  → dedupe
  → append only top palettes
```

Space switching should remain instant. API work should never block local palette navigation.

### Huemint

Best for design-aware inspiration because it generates colors based on usage context rather than only flat harmony.

Use it for:

```txt
website-like anchors
brand-aware anchors
locked-color variations
interesting color relationships
```

### Colormind

Useful as a backup taste seeder from design/art/image-trained data.

Use it for:

```txt
creative anchors
UI-ish model output
unusual but plausible combinations
```

### The Color API

Useful deterministic fallback for harmony-based expansion from a seed color.

Modes include:

```txt
monochrome
monochrome-dark
monochrome-light
analogic
complement
analogic-complement
triad
quad
```

## API role mapping as optimization

For API/anchor palettes, never assume palette order equals role order.

Given a 5-color anchor palette, evaluate role assignments:

```txt
Which color is best as background?
Which color is best as surface?
Which color is best as accent?
Which color is best as text?
Which color is best as muted?
```

For five colors, role permutations are cheap:

```txt
5! = 120 candidate assignments
```

Each assignment should become a candidate theme:

```txt
role assignment
→ derive missing tokens
→ repair
→ score
→ keep best mapping
```

## Hard gates

These checks should happen before final scoring.

Reject or repair candidates that fail:

```txt
text/background contrast
text/surface contrast
accent/onAccent contrast
background not too loud unless recipe allows it
surface distinguishable from background
accent distinguishable from text and muted text
no duplicate or near-duplicate visible swatches
no more than 1–2 high-chroma colors in the visible strip
critical UI states distinguishable
```

The product should still never show “no valid palette.” If a candidate fails, repair the role or move the risky color into an accent/decorative token.

## Repair strategy

Repair should happen by role, not by flattening the whole palette.

Bad approach:

```txt
Palette is too saturated → desaturate everything
```

Good approach:

```txt
Color is too saturated for background
→ preserve it as accent/decorative token
→ derive a calmer related background
```

Repair order:

```txt
1. Try recipe-native role generation or all role permutations.
2. Derive missing neutrals/text/surfaces.
3. Move unsafe colors into accent/decorative roles.
4. Adjust only the specific failing token.
5. Preserve creative identity where possible.
6. Return a valid theme.
```

## Stronger taste scoring

The scorer should evaluate design quality, not only mathematical harmony.

Recommended score components:

```txt
accessibilityScore
+ compatibilityScore
+ roleFitScore
+ moodCoherenceScore
+ noveltyScore
+ surfaceHierarchyScore
+ prototypeScore
- chaosPenalty
- boringPenalty
- genericPenalty
```

Suggested initial weights:

```ts
score =
  accessibilityScore * 0.22 +
  roleFitScore * 0.20 +
  compatibilityScore * 0.16 +
  moodCoherenceScore * 0.14 +
  prototypeScore * 0.12 +
  surfaceHierarchyScore * 0.08 +
  noveltyScore * 0.08 -
  chaosPenalty -
  boringPenalty -
  genericPenalty
```

### Accessibility score

Checks actual role usage:

```txt
text on background
text on surface
muted text on background
onAccent on accent
onPrimary on primary
focus ring against background/surface
```

Use WCAG contrast now. Add APCA-style perceptual contrast later, especially for dark mode and text-size-aware scoring.

### Compatibility score

Scores the complete 5-color visible theme as a unit:

```txt
background + surface + accent + text + muted
```

Features:

```txt
pairwise OKLCH distances
hue topology
lightness distribution
chroma distribution
warm/cool balance
accent/foundation balance
similarity to high-quality palette archetypes
```

### Role fit score

Checks whether each color is doing the right job.

Good role fit:

```txt
calm background/surface foundation
clear hero/accent color
text is readable and not overly colorful
muted text is lower emphasis but still readable
surface hierarchy is visible but subtle
```

Bad role fit:

```txt
neon green full-page background
pale yellow body text
five equally loud colors
accent too close to text
muted text too low contrast
```

### Mood coherence score

Each recipe should have its own taste target.

Examples:

```txt
Dark premium → deep neutral base, controlled luxury accent
Calm healthcare → soft low-chroma foundation, trustworthy accent
Bold pop → high accent energy, but restrained text/surface roles
Earthy organic → warm neutrals, natural greens/browns, low synthetic feel
```

The same palette should not be judged identically under every recipe.

### Prototype score

Evaluate the palette in UI-like usage:

```txt
page background
card surface
headline
body text
muted metadata
primary button
secondary button
badge/chip
border/divider
```

This captures whether the palette would actually work in a product screen.

### Novelty score

Reward controlled surprise:

```txt
interesting accent hue
non-generic neutral temperature
fresh warm/cool relationship
unexpected but coherent secondary color
```

Novelty should be capped so it does not become chaos.

### Surface hierarchy score

Reward clear but subtle structure:

```txt
background vs surface visible
surface vs elevated surface visible
border visible but not loud
muted text lower than text but readable
accent clearly dominant
```

### Chaos penalty

Penalize:

```txt
too many loud colors
uncontrolled hue spread
multiple competing accents
high-chroma background plus high-chroma accent
unclear visual hierarchy
```

### Boring penalty

Penalize technically safe palettes that feel dead:

```txt
all gray
all low chroma
no hero color
too close to generic Tailwind/SaaS defaults
no emotional signature
```

### Generic penalty

Penalize repeated common patterns when they appear too often:

```txt
off-white + slate text + blue accent
near-identical SaaS blue/gray palettes
same accent hue bucket repeatedly
same background/text pair repeatedly
```

## Palette memory and dedupe

Coolors feels fresh because it avoids showing near-identical palettes constantly.

colorBrain should maintain recent palette fingerprints for:

```txt
current queue
recently shown palettes
recently skipped palettes
saved palettes
API-added palettes
```

Fingerprint dimensions:

```txt
accent hue bucket
background hue/lightness bucket
text/background pair
sorted hue topology
visible OKLCH role vector
recipe id
light/dark mode
chroma profile
```

Dedupe checks:

```txt
similar accent hue
similar background/text pair
similar OKLCH distance
similar hue structure
same recipe repeated too often
same generic SaaS structure repeated too often
```

A candidate can be high quality and still rejected if it is too similar to the recent queue.

## Creativity modes

colorBrain should support different levels of creative risk:

```ts
creativity: "safe" | "balanced" | "expressive" | "wild"
```

### Safe

Conventional, polished, low-risk UI palettes.

```txt
business
SaaS
professional
enterprise
```

### Balanced

Default mode.

```txt
safe foundation
clear accent
moderate novelty
high usability
```

### Expressive

More colorful and memorable.

```txt
stronger accent
warmer/cooler neutrals
more unusual hue relationships
still readable
```

### Wild

Experimental but still role-safe.

```txt
unusual hue pairings
strong contrast
higher accent energy
hard accessibility rules still apply
```

## Example output

```ts
{
  id: "palette_9xK2",
  status: "valid",
  source: "local-recipe",
  recipe: "soft-editorial",
  creativity: "balanced",
  visibleRoles: {
    background: "#FAF8FF",
    surface: "#FFFFFF",
    accent: "#FA5C7C",
    text: "#171326",
    muted: "#6B6478"
  },
  roles: {
    background: "#FAF8FF",
    surface: "#FFFFFF",
    surfaceElevated: "#FFFFFF",
    text: "#171326",
    mutedText: "#6B6478",
    border: "#E7E1F2",
    primary: "#4C1D95",
    onPrimary: "#FFFFFF",
    secondary: "#2DD4BF",
    onSecondary: "#042F2E",
    accent: "#FA5C7C",
    onAccent: "#FFFFFF",
    warning: "#FACC15",
    onWarning: "#2A2100"
  },
  score: {
    total: 91,
    accessibility: 100,
    compatibility: 84,
    roleFit: 89,
    moodCoherence: 92,
    prototype: 88,
    surfaceHierarchy: 86,
    novelty: 78,
    chaosPenalty: 0,
    boringPenalty: 0,
    genericPenalty: 0
  },
  dedupe: {
    fingerprint: "light|soft-editorial|accent-348|bg-285-98|low-medium",
    similarRecentCount: 0
  },
  notes: [
    "Main strip uses stable Background/Surface/Accent/Text/Muted roles.",
    "Accent provides the only high-chroma focal point.",
    "Background and surface are calm but retain a subtle violet temperature."
  ]
}
```

## Implementation pseudo-code

```ts
function generateInitialColorBrainQueue(input) {
  const localCandidates = generateRecipePalettes({
    ...input,
    count: 40
  })

  return rankAndDedupe(localCandidates, input).slice(0, 40)
}
```

```ts
function generateRecipePalettes(input) {
  return selectRecipes(input).flatMap(recipe => {
    return generateCandidatesForRecipe(recipe, input).map(candidate => {
      const repaired = repairUiUsage(candidate, input)
      const score = scoreUiTheme(repaired, { recipe, ...input })

      return {
        ...repaired,
        recipe: recipe.id,
        score
      }
    })
  })
}
```

```ts
function maybeRefillFromApis(queue, input) {
  if (queue.remaining > 20) return queue

  fetchApiAnchorsInBackground(input).then(anchorPalettes => {
    const candidates = anchorPalettes
      .flatMap(anchor => buildRoleMappingCandidates(anchor, input))
      .map(candidate => repairUiUsage(candidate, input))
      .map(candidate => scoreUiTheme(candidate, input))

    appendTopDedupeCandidates(candidates)
  })
}
```

```ts
function rankAndDedupe(candidates, input) {
  return candidates
    .filter(passesHardGates)
    .sort((a, b) => b.score.total - a.score.total)
    .filter(candidate => !isTooSimilarToRecent(candidate, input.memory))
}
```

## Product behavior

The user should experience:

```txt
instant space switching
consistent 5-role palette strip
less random local palettes
more designed mood variety
fewer near-duplicates
API-inspired surprises appearing in the background
```

Good UX labels:

```txt
Soft editorial
Dark premium
Fresh SaaS
Warm minimal
Bold accent palette
Unexpected but accessible
High-contrast neon
Calm healthcare
```

Optional debug/details metadata:

```txt
source
recipe
score breakdown
hard-gate repairs
role mapping confidence
dedupe fingerprint
api source
```

## Final model

colorBrain is not just a palette generator.

It is a **UI palette quality engine**.

Its job is to:

1. Generate complete 5-role UI palettes.
2. Keep the main swatches stable: Background, Surface, Accent, Text, Muted.
3. Use curated recipes instead of random hue math.
4. Score palettes as complete themes in UI context.
5. Preserve creative surprise without allowing chaos.
6. Use APIs as background inspiration only.
7. Avoid repeated near-identical palettes.
8. Return endless UI-ready palettes that feel designed.

Final principle:

> Generate for purpose first, then score for taste.

## Reference sources

- Color Compatibility From Large Datasets: <https://www.dgp.toronto.edu/~donovan/color/>
- Color Compatibility PDF: <https://www.dgp.toronto.edu/~donovan/color/colorcomp.pdf>
- Palette, Purpose, Prototype — CHI 2024: <https://dl.acm.org/doi/fullHtml/10.1145/3613904.3641976>
- Palette, Purpose, Prototype PDF: <https://lelemonanade.github.io/palette_purpose_prototype.pdf>
- Semantic-Based GUI Colorization Through CGANs: <https://www.tandfonline.com/doi/full/10.1080/10447318.2019.1680921>
- Automated Image-Based User Interface Color Theme Generation: <https://www.mdpi.com/2076-3417/14/7/2850>
- Huemint About/API: <https://huemint.com/about/>
- Colormind API: <http://colormind.io/api-access/>
- The Color API: <https://www.thecolorapi.com/docs>
- Material Color Utilities: <https://github.com/material-foundation/material-color-utilities>
- APCA in a Nutshell: <https://git.apcacontrast.com/documentation/APCA_in_a_Nutshell.html>
- Harmony OKLCH/APCA: <https://evilmartians.com/opensource/harmony>
- W3C WCAG Contrast Minimum: <https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum>
