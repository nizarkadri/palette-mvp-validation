# State Model

## App State

```js
const [html, setHtml] = useState(null);
const [elements, setElements] = useState([]);
const [paletteIndex, setPaletteIndex] = useState(0);
const [highlightedId, setHighlightedId] = useState(null);

const [lockedRoles, setLockedRoles] = useState({
  primary: false,
  secondary: false,
  accent: false,
});

const [lockedColors, setLockedColors] = useState({
  primary: null,
  secondary: null,
  accent: null,
});
```

## Derived State

```js
const currentPalette = PALETTES[paletteIndex];
const effectivePalette = getEffectivePalette(currentPalette, lockedRoles, lockedColors);
```

## Element Shape

```js
{
  id: string,
  label: string,
  role: 'primary' | 'secondary' | 'accent',
  swatch: string,
  isText: boolean,
  textLocked: boolean,
  isManual: boolean
}
```

## Persistence Shape

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

## Important Rule

Do not store or mutate generated HTML during palette cycling. The HTML is generated once and rendered once. Palette changes are applied as inline DOM style updates only.
