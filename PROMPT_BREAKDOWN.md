# Exact Prompt Structure — UI Screenshot → HTML + Element List

## The full system prompt (copy this exactly)

```
You are a UI design analysis tool. You will be shown a screenshot of an app or website.

Your job has two parts:

PART 1 — Recreate the UI as simplified static HTML.
- Use plain HTML + inline "class" attributes only (no <script>, no external resources, no real images — use colored divs/placeholders for avatars/icons).
- Keep the layout structure recognizable (same rough positions/sizes/hierarchy as the screenshot) but DO NOT try to be pixel-perfect. Simplify decorative details.
- For repeated elements (e.g. multiple post cards, multiple list rows, multiple icon chips), give them the SAME class name so they can be recolored as a group.
- Use semantic, descriptive class names (e.g. "nav-bar", "post-card", "avatar", "cta-button", "heading-text", "body-text", "icon-chip").
- All elements that should be recolorable MUST have one of the classes listed in PART 2's "id" field.
- Wrap the whole thing in a single root <div class="ui-root">.
- Use inline style ONLY for layout (flexbox, sizing, spacing, position). DO NOT hardcode colors in inline styles — colors will be applied via CSS variables based on the class name, using the mapping you provide in PART 2.
- For text elements, set color via the class alone (no inline color).

PART 2 — Return a flat JSON array of "colorable elements" you used as class names.
For each one, return:
- "id": the exact class name used in the HTML (string, kebab-case, must match PART 1 exactly)
- "label": a short human-readable label for a UI list, e.g. "Post cards", "Avatars", "CTA buttons" (string)
- "role": your best guess at "primary" | "secondary" | "accent" based on standard UI conventions:
   - "primary": large background/structural areas (page background, nav bars, tab bars)
   - "secondary": surface elements that sit on top of primary (cards, panels, input fields, badges, muted text)
   - "accent": small high-emphasis interactive or brand elements (buttons, links, icons, highlighted text, avatars, brand marks)
- "swatch": the approximate hex color (string, e.g. "#1a1a2e") this element currently has in the screenshot — sample the dominant color for that element/class

Respond with ONLY a single raw JSON object, no markdown fences, no explanation, in this exact shape:

{
  "html": "<div class=\"ui-root\">...</div>",
  "elements": [
    {"id": "nav-bar", "label": "Nav bar", "role": "primary", "swatch": "#0d0d14"},
    ...
  ]
}

Keep the element list focused — typically 6 to 14 entries covering: page/app background, nav/tab bars, cards/surfaces, primary text, secondary/muted text, buttons, avatars, icons, badges, and any brand-colored elements. Don't list every single text node separately — group by visual role.
```

## The user message (this also matters)

```
Analyze this UI screenshot and respond with the JSON object described in your instructions.
```

## The full API call structure

```json
{
  "model": "claude-sonnet-4-6",
  "max_tokens": 4000,
  "system": "<the system prompt above>",
  "messages": [
    {
      "role": "user",
      "content": [
        {
          "type": "image",
          "source": {
            "type": "base64",
            "media_type": "image/png",
            "data": "<base64 string, NO data: prefix>"
          }
        },
        {
          "type": "text",
          "text": "Analyze this UI screenshot and respond with the JSON object described in your instructions."
        }
      ]
    }
  ]
}
```

---

## Why other models are likely failing

### Problem 1 — They ignore "no inline colors"

The single most important constraint in the prompt:

> DO NOT hardcode colors in inline styles

Claude mostly respects this. Gemini Flash and most other models will
aggressively hardcode colors like `style="background:#1a1a2e; color:#fff"`
on every element. This completely breaks the palette engine because when
you later try to set `el.style.backgroundColor = palette.primary`, the
inline style wins (inline styles have the highest CSS specificity), and
nothing visually changes.

**Fix for other models:** After getting the HTML back, strip all color-related
inline styles via a post-processing step before injecting into the DOM:

```js
function stripInlineColors(html) {
  // Remove color, background-color, background, border-color from inline styles
  // but keep layout properties (flex, width, height, padding, margin, position)
  const COLOR_PROPS = [
    'color', 'background-color', 'background', 'border-color',
    'border', 'fill', 'stroke', 'outline-color'
  ];
  
  return html.replace(/style="([^"]*)"/gi, (match, styleStr) => {
    const kept = styleStr
      .split(';')
      .map(s => s.trim())
      .filter(s => {
        if (!s) return false;
        const prop = s.split(':')[0].trim().toLowerCase();
        // Keep layout props, strip color props
        return !COLOR_PROPS.some(c => prop === c || prop.startsWith('background'));
      })
      .join('; ');
    return kept ? `style="${kept}"` : '';
  });
}
```

Call this on the HTML string before setting `innerHTML`:
```js
containerRef.current.innerHTML = stripInlineColors(result.html);
```

---

### Problem 2 — They wrap the JSON in markdown fences

Claude returns raw JSON when told to. Gemini and others frequently wrap it:

```
```json
{ "html": "...", "elements": [...] }
```
```

**Fix (already in aiAnalysis.js but make sure it covers all cases):**

```js
const cleaned = textBlock.text
  .trim()
  .replace(/^```json\s*/i, '')
  .replace(/^```\s*/i, '')
  .replace(/```\s*$/i, '')
  .trim();
```

---

### Problem 3 — They nest JSON or change the shape

Some models return:
```json
{ "part1": { "html": "..." }, "part2": { "elements": [...] } }
```
or
```json
{ "reconstruction": "...", "colorMap": [...] }
```

**Fix:** Add explicit validation after parsing and normalize:

```js
// Handle common shape variants from non-Claude models
function normalizeResponse(parsed) {
  // Shape: { html, elements } — correct, return as-is
  if (parsed.html && Array.isArray(parsed.elements)) return parsed;
  
  // Shape: { part1: { html }, part2: { elements } }
  if (parsed.part1?.html && parsed.part2?.elements) {
    return { html: parsed.part1.html, elements: parsed.part2.elements };
  }
  
  // Shape: { reconstruction, colorMap } or { ui, components }
  const htmlKey = ['html', 'reconstruction', 'ui', 'markup', 'code']
    .find(k => typeof parsed[k] === 'string');
  const elemKey = ['elements', 'colorMap', 'components', 'items', 'colors']
    .find(k => Array.isArray(parsed[k]));
  
  if (htmlKey && elemKey) {
    return { html: parsed[htmlKey], elements: parsed[elemKey] };
  }
  
  throw new Error(`Unexpected response shape: ${Object.keys(parsed).join(', ')}`);
}
```

---

### Problem 4 — They hallucinate class names (elements don't match HTML)

The model returns an elements list with `id: "primary-button"` but the HTML
uses `class="cta-btn"`. The palette engine queries `.primary-button` and finds
nothing, so nothing changes on Space.

**Fix:** After getting the response, verify that every element id actually
exists as a class in the HTML. Flag or auto-correct mismatches:

```js
function validateElementIds(html, elements) {
  return elements.filter(el => {
    const hasClass = html.includes(`class="${el.id}"`) || 
                     html.includes(`class='${el.id}'`) ||
                     html.includes(` ${el.id} `) ||   // class among others
                     html.includes(`"${el.id} `) ||
                     html.includes(` ${el.id}"`);
    if (!hasClass) {
      console.warn(`Element id "${el.id}" not found as a class in the HTML — dropping`);
    }
    return hasClass;
  });
}

// Use it:
parsed.elements = validateElementIds(parsed.html, parsed.elements);
```

---

### Problem 5 — max_tokens too low

The HTML for even a medium-complexity UI can be 1500-3000 tokens. If you're
using a budget model with a low default max_tokens, the response gets cut off
mid-HTML and JSON parsing fails.

**Recommendation by model:**

| Model | Suggested max_tokens |
|---|---|
| claude-sonnet-4-6 | 4000 |
| Gemini 1.5 Flash | 8192 (their token counting differs) |
| Gemini 2.0 Flash | 8192 |
| MiniMax M3 | Check their docs — likely 4096+ |

Always check if the response is truncated before trying to parse:
```js
if (data.stop_reason === 'max_tokens' || data.finish_reason === 'length') {
  throw new Error('Response was cut off — increase max_tokens');
}
```

---

### Problem 6 — Gemini-specific: image format

Gemini uses a different content format for images:

```js
// Gemini format (via their SDK or REST API)
{
  "contents": [
    {
      "parts": [
        {
          "inline_data": {
            "mime_type": "image/png",
            "data": "<base64>"
          }
        },
        {
          "text": "Analyze this UI screenshot..."
        }
      ]
    }
  ],
  "system_instruction": {
    "parts": [{ "text": "<system prompt>" }]
  }
}
```

Claude uses `system` at the top level + `messages[0].content` array with
`{ type: "image", source: { type: "base64", ... } }`. These are NOT
interchangeable — wrong format = the model sees no image.

---

## Prompt adjustments for other models

If you want to use Gemini Flash or MiniMax, these additions to the system
prompt help significantly:

```
CRITICAL RULES (follow exactly):
1. Return ONLY the raw JSON object — no text before it, no text after it,
   no markdown code fences (no ```), no explanation.
2. Every class name in the HTML MUST appear in the "elements" array "id" field.
   They must match character-for-character.
3. Never put color values (hex codes, rgb(), named colors) in any style=""
   attribute. Layout properties only (width, height, padding, margin,
   display, flex, position, top, left, gap, border-radius, font-size,
   font-weight, line-height).
4. If you are unsure about a color role, default to "secondary".
5. The HTML must be valid, parseable, and complete — do not truncate it.
```

Add these as the final section of your system prompt when using non-Claude models.

---

## Quick test to verify your prompt is working

Send this screenshot of a simple two-color UI (a dark nav + white page + one
colored button) and check the response against these criteria:

✅ Response is valid JSON parseable with `JSON.parse()`  
✅ `result.html` contains a `<div class="ui-root">`  
✅ `result.elements` is an array with 4-8 items  
✅ Every `element.id` appears as a CSS class in `result.html`  
✅ No `#xxxxxx` hex colors appear anywhere in `style=""` attributes in the HTML  
✅ `result.elements` each have `id`, `label`, `role`, `swatch` fields  
✅ All `role` values are one of: `"primary"`, `"secondary"`, `"accent"`  

If any of these fail, the issue is almost always one of Problems 1-6 above.
