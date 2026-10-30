# Schema Contracts

## AI Analysis Response

The model/backend should return:

```js
{
  html: string,
  elements: Element[]
}
```

## Element / Grouped Pill

```js
{
  id: string,
  label: string,
  role: 'primary' | 'secondary' | 'accent' | 'custom',
  selector?: string,
  selectors?: string[],
  swatch: string,
  rationale?: string,
  isText: boolean,
  textLocked: boolean,
  source?: 'ai' | 'manual',
  isManual?: boolean
}
```

`selectors` is preferred when one pill represents similar repeated elements. `selector` remains a compatibility alias for older code and can contain a comma-joined selector list.

## Element Normalization Rules

- `id`: required string; trim whitespace.
- `label`: fallback to `id`.
- `role`: fallback to `custom` if invalid or low-confidence.
- `swatch`: fallback to `#888888` if invalid.
- `isText`: boolean; default false.
- `textLocked`: true only by default when `isText` is true.
- `source`: fallback to `ai` unless manually created.
- `isManual`: backward-compatible boolean; default false.

## Role Values

```js
const VALID_ROLES = ['primary', 'secondary', 'accent', 'custom'];
```

## Hex Color Validation

Valid swatches should match:

```js
/^#[0-9a-fA-F]{6}$/
```

## Session Storage Shape

```js
{
  version: 1,
  data: {
    html,
    elements,
    paletteIndex,
    lockedRoles,
    lockedColors
  }
}
```

## Grouped Pill Highlighting

When a pill has multiple selectors:

```js
{
  selectors: ['.caption', '.timestamp', '.muted-label']
}
```

Hover/highlight and palette application must target all matching nodes from every selector, scoped to the preview root.

## Effective Palette

```js
{
  ...currentPalette,
  primary: lockedRoles.primary ? lockedColors.primary : currentPalette.primary,
  secondary: lockedRoles.secondary ? lockedColors.secondary : currentPalette.secondary,
  accent: lockedRoles.accent ? lockedColors.accent : currentPalette.accent
}
```

## Export Contract

The refreshed UX should expose simple copyable hex values from the effective palette only. Do not include Copy CSS in the core panel.

## Validation Result

Optional AI validation should return:

```js
{
  pass: boolean,
  score: number,
  recommendedRetry: boolean,
  summary: string,
  missingElements: string[],
  badMappings: Array<{ id?: string, issue: string }>,
  roleIssues: Array<{ id?: string, issue: string }>,
  htmlIssues: string[],
  retryInstructions: string[]
}
```
