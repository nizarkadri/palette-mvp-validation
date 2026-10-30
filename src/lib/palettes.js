/**
 * PALETTES
 * --------
 * Each palette defines colors for the three roles (primary, secondary, accent)
 * plus derived text colors. These are applied to the AI-recreated HTML via
 * CSS variables — see `applyPalette` in usePaletteEngine.js.
 *
 * "primary"   -> large structural/background areas (page bg, nav bars)
 * "secondary" -> surfaces sitting on top of primary (cards, panels, badges)
 * "accent"    -> high-emphasis interactive/brand elements (buttons, links, icons)
 *
 * Derived tokens:
 * "text"       -> default text color (contrasts with primary/secondary)
 * "textMuted"  -> secondary/muted text color
 * "onAccent"   -> text/icon color when placed ON TOP of an accent-colored surface
 */

export const PALETTES = [
  {
    name: 'Dark default',
    primary: '#0d0d14',
    secondary: '#1a1a28',
    accent: '#4a90e2',
    text: '#f0f0f5',
    textMuted: '#7a7a90',
    onAccent: '#ffffff',
  },
  {
    name: 'Violet night',
    primary: '#120a24',
    secondary: '#1f1340',
    accent: '#a78bfa',
    text: '#ede9fe',
    textMuted: '#7a6aa8',
    onAccent: '#1a0f33',
  },
  {
    name: 'Ocean deep',
    primary: '#071b28',
    secondary: '#0f2f44',
    accent: '#38bdf8',
    text: '#e0f4ff',
    textMuted: '#5a8aa0',
    onAccent: '#062230',
  },
  {
    name: 'Forest',
    primary: '#081d10',
    secondary: '#11301c',
    accent: '#4ade80',
    text: '#dcfce7',
    textMuted: '#4a7256',
    onAccent: '#0a2613',
  },
  {
    name: 'Crimson',
    primary: '#160608',
    secondary: '#2a0c12',
    accent: '#f87171',
    text: '#fee2e2',
    textMuted: '#8a4a4f',
    onAccent: '#2a0c0e',
  },
  {
    name: 'Amber warm',
    primary: '#160e02',
    secondary: '#2c1a02',
    accent: '#fbbf24',
    text: '#fef3c7',
    textMuted: '#8a6a2a',
    onAccent: '#241200',
  },
  {
    name: 'Light mode',
    primary: '#f4f4fa',
    secondary: '#ffffff',
    accent: '#4a5aff',
    text: '#1a1a2a',
    textMuted: '#8888a0',
    onAccent: '#ffffff',
  },
  {
    name: 'Peach',
    primary: '#fffaf6',
    secondary: '#ffe3d9',
    accent: '#e8927a',
    text: '#2a1a14',
    textMuted: '#b89a8c',
    onAccent: '#ffffff',
  },
  {
    name: 'Rose gold',
    primary: '#1c0c12',
    secondary: '#301626',
    accent: '#f9a8d4',
    text: '#fce7f3',
    textMuted: '#80505f',
    onAccent: '#2a0f1c',
  },
  {
    name: 'Slate',
    primary: '#0f172a',
    secondary: '#1e293b',
    accent: '#94a3b8',
    text: '#e2e8f0',
    textMuted: '#52647a',
    onAccent: '#0f172a',
  },
  {
    name: 'Mint fresh',
    primary: '#f6fbf8',
    secondary: '#dcf2e4',
    accent: '#3fae7a',
    text: '#102018',
    textMuted: '#9ab8a8',
    onAccent: '#ffffff',
  },
  {
    name: 'Neon',
    primary: '#050505',
    secondary: '#141414',
    accent: '#d4ff00',
    text: '#ffffff',
    textMuted: '#5a5a5a',
    onAccent: '#0a0a00',
  },
];
