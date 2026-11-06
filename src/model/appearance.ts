/**
 * Diagram appearance: five preset themes, color families with numeric shades, and the overrides a
 * file can set. `resolveAppearance` turns a saved appearance into the concrete colors, spacing and
 * type that sizing, the canvas and both SVG exports read, so all of them agree.
 *
 * Diagram appearance is separate from the editor's light or dark mode.
 */
import type { Footnote } from './footnote';
import type { Note } from './note';
import { typeProfile, type FontRole, type TypeProfile } from './fonts';
import type { FileConfig } from './link';

export type ThemeId = 'drafting' | 'fieldnotes' | 'signal' | 'ink' | 'blueprint';
export const THEME_IDS: ThemeId[] = ['drafting', 'fieldnotes', 'signal', 'ink', 'blueprint'];
export const DEFAULT_THEME: ThemeId = 'drafting';

/** Shade stops. Lower numbers are lighter and higher numbers darker, in every theme. */
export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type Shade = (typeof SHADES)[number];
export const isShade = (n: unknown): n is Shade => SHADES.includes(n as Shade);
/** Shade of a node that names a color without a shade. */
export const NODE_SHADE: Shade = 500;
/**
 * Shade of a group that names a color without a shade. Groups are quiet surfaces behind nodes, so
 * this is a pale shade in light themes and a deep one in dark themes; the scale itself never flips.
 */
export const groupShadeFor = (theme: ThemeId, dark = PRESETS[theme]?.dark): Shade =>
  dark ? 900 : 100;

/** Built-in color families, available in every theme. `primary` and `secondary` follow the theme. */
export const BUILT_IN_FAMILIES = [
  'primary',
  'secondary',
  'slate',
  'stone',
  'blue',
  'sky',
  'teal',
  'mint',
  'green',
  'amber',
  'orange',
  'red',
  'rose',
  'violet',
] as const;
export const isBuiltInFamily = (name: string) =>
  (BUILT_IN_FAMILIES as readonly string[]).includes(name);

export interface Swatch {
  fill: string;
  stroke: string;
  ink: string;
}

/** A file's color declaration: one shade of a family. Built-in shades may set some fields only. */
export interface ColorDefinition {
  family: string;
  shade: Shade;
  fill?: string;
  stroke?: string;
  ink?: string;
}

export interface AppearanceOverrides {
  paddingX?: number;
  paddingY?: number;
  radius?: number;
  titleFont?: FontRole;
  annotationFont?: FontRole;
  canvas?: string;
  text?: string;
  connection?: string;
}

export interface DiagramAppearance {
  theme: ThemeId;
  overrides: AppearanceOverrides;
  colors: ColorDefinition[];
  /** What the colors mean, from `legend` statements, drawn as a key beside the diagram. */
  legend?: LegendEntry[];
  /** Title and subtitle drawn above exported images, from `diagram` and `subtitle` statements. */
  heading?: Heading;
  /** Sentences drawn on the diagram without moving it, from `note` statements. */
  notes?: Note[];
  /** Entries of the block between the drawing and the key, from `footnote` statements. */
  footnotes?: Footnote[];
  /** Panel labels from a `compare` statement: draw the old and new versions side by side. */
  compare?: {
    /** Set by `draftably compare`: the changes the older panel draws in their new version. */
    undrawn?: string;
    before: string;
    after: string;
    /** `right` sets the panels side by side, `down` stacks them; chosen by `aspect` when unset. */
    direction?: 'right' | 'down';
    /** Width over height the whole image should come closest to; 1.6 when unset. */
    aspect?: number;
  };
  /** File settings from `config` statements. */
  config?: FileConfig;
  /** Named emphasis states from `state` statements, in file order. */
  states?: EmphasisState[];
  /**
   * Paint the page hosting the diagram lays over it, such as its own light or dark palette. Set
   * by a host session, never by the file, and never written to the source.
   */
  host?: AppearanceLayer;
}

/**
 * Colors a host lays over a diagram's appearance. Only paint: text is still measured in the
 * file's fonts and spacing, so nothing moves. Unset fields keep the file's look; preset colors
 * the host leaves alone are held to their contrast targets against the host's canvas.
 */
export interface AppearanceLayer {
  /** The canvas is dark: built-in color ramps, group shades and nesting steps follow. */
  dark?: boolean;
  canvas?: string;
  /** Titles and annotations. */
  text?: string;
  /** Secondary text, such as subtitles and counts. */
  muted?: string;
  /** Connection lines and their labels. */
  connection?: string;
  /** Shapes and containers that name no color. */
  node?: Partial<Swatch>;
  group?: Partial<Swatch>;
  /** Shades of color families, as `theme-color` sets them, over the file's own. */
  colors?: ColorDefinition[];
}

/** One way to draw the diagram: these objects and connections in focus, the rest faded or plain. */
export interface EmphasisState {
  id: string;
  label: string;
  /** Objects (a group brings its members) and connections in focus. */
  ids: string[];
  /** How everything else draws: faded like a context line, or as usual. */
  rest: 'dim' | 'plain';
}

export interface Heading {
  title?: string;
  subtitle?: string;
  /** Width of the frame round the drawing, from `diagram width=`; never narrower than its content. */
  width?: number;
}

/** The connection styles a `legend line` row can explain. */
export const LEGEND_LINES = ['dashed', 'solid'] as const;
export type LegendLine = (typeof LEGEND_LINES)[number];

/** One row of the key: a color swatch (`family`), or a short connection (`line`). */
export interface LegendEntry {
  family?: string;
  line?: LegendLine;
  /** Shade of the swatch; nodes' default when omitted. */
  shade?: Shade;
  label: string;
}

export const defaultAppearance = (): DiagramAppearance => ({
  theme: DEFAULT_THEME,
  overrides: {},
  colors: [],
});

/** Limits for numeric overrides, shared by the file parser and JSON validation. */
export const OVERRIDE_LIMITS = {
  paddingX: { min: 4, max: 48 },
  paddingY: { min: 4, max: 48 },
  radius: { min: 0, max: 24 },
} as const;

export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// --- Presets -----------------------------------------------------------------------------------

interface Preset {
  label: string;
  description: string;
  dark: boolean;
  canvas: string;
  text: string;
  muted: string;
  connection: string;
  node: Swatch;
  group: Swatch;
  paddingX: number;
  paddingY: number;
  radius: number;
  shadow: boolean;
  titleFont: FontRole;
  annotationFont: FontRole;
  titleSize: number;
  titleLine: number;
  annotationSize: number;
  /** Chroma multiplier for the built-in families: how saturated this theme's colors are. */
  chroma: number;
  /** Anchor colors for `primary` and `secondary`, at the shade they appear as. */
  primary: [string, Shade];
  secondary: [string, Shade];
  /** Hue and chroma for built-in families this theme draws in its own way. */
  hues?: Partial<Record<string, [number, number]>>;
}

export const PRESETS: Record<ThemeId, Preset> = {
  drafting: {
    label: 'Drafting',
    description: 'Navy ink on cool paper, with drafting blue and marker gold',
    dark: false,
    canvas: '#F7F7F4',
    text: '#1B2433',
    muted: '#586172',
    connection: '#39414F',
    node: { fill: '#FFFFFF', stroke: '#C3C8CF', ink: '#1B2433' },
    group: { fill: '#EEEFEB', stroke: '#D5D8DC', ink: '#363F4D' },
    paddingX: 12,
    paddingY: 20,
    radius: 4,
    shadow: false,
    titleFont: 'sans',
    annotationFont: 'sans',
    titleSize: 13,
    titleLine: 16,
    annotationSize: 11,
    chroma: 0.9,
    primary: ['#2754A6', 700],
    secondary: ['#F0B43C', 400],
  },
  fieldnotes: {
    label: 'Fieldnotes',
    description: 'Editorial serif titles on warm paper, indigo and terracotta',
    dark: false,
    canvas: '#F6F1E6',
    text: '#2F2B24',
    muted: '#6B6559',
    connection: '#57503F',
    node: { fill: '#FFFCF5', stroke: '#CFC4AF', ink: '#2F2B24' },
    group: { fill: '#EEE7D8', stroke: '#D8CDB8', ink: '#4A4539' },
    paddingX: 18,
    paddingY: 22,
    radius: 3,
    shadow: false,
    titleFont: 'serif',
    annotationFont: 'sans',
    titleSize: 15,
    titleLine: 19,
    annotationSize: 11,
    chroma: 0.72,
    primary: ['#34507F', 700],
    secondary: ['#B5532F', 600],
    hues: { green: [150, 0.1], amber: [80, 0.12], violet: [320, 0.1] },
  },
  signal: {
    label: 'Signal',
    description: 'Color-blind-safe Okabe–Ito hues on white, with monospace annotations',
    dark: false,
    canvas: '#FFFFFF',
    text: '#16202B',
    muted: '#4F5B68',
    connection: '#3B4652',
    node: { fill: '#F5F7F9', stroke: '#C3CAD3', ink: '#16202B' },
    group: { fill: '#F6F8FA', stroke: '#D9DEE4', ink: '#2A3644' },
    paddingX: 16,
    paddingY: 20,
    radius: 6,
    shadow: false,
    titleFont: 'sans',
    annotationFont: 'mono',
    titleSize: 13,
    titleLine: 16,
    annotationSize: 10.5,
    chroma: 1,
    primary: ['#0067A5', 600],
    secondary: ['#E69F00', 500],
    // After Okabe & Ito's set: blue, sky blue, bluish green, orange, vermilion, reddish purple.
    hues: {
      blue: [248, 0.15],
      sky: [237, 0.11],
      green: [163, 0.13],
      mint: [172, 0.1],
      amber: [72, 0.16],
      orange: [55, 0.16],
      red: [36, 0.18],
      rose: [350, 0.13],
    },
  },
  ink: {
    label: 'Ink',
    description: 'Sumi ink tones with indigo and a vermilion seal, generous spacing',
    dark: false,
    canvas: '#F8F6F1',
    text: '#1A1A1A',
    muted: '#625F5A',
    connection: '#3B3A38',
    node: { fill: '#FFFFFF', stroke: '#C8C5BF', ink: '#1A1A1A' },
    group: { fill: '#EFECE5', stroke: '#D9D5CC', ink: '#3F3D39' },
    paddingX: 22,
    paddingY: 26,
    radius: 3,
    shadow: false,
    titleFont: 'sans',
    annotationFont: 'sans',
    titleSize: 14,
    titleLine: 19,
    annotationSize: 11.5,
    chroma: 0.6,
    primary: ['#2B3A55', 900],
    secondary: ['#C23B22', 600],
  },
  blueprint: {
    label: 'Blueprint',
    description: 'White lines on blueprint blue, cyan and yellow, monospace titles',
    dark: true,
    canvas: '#13233D',
    text: '#EAF1FB',
    muted: '#A6B8D2',
    connection: '#A9C2E6',
    node: { fill: '#1B3154', stroke: '#45679B', ink: '#EAF1FB' },
    group: { fill: '#172A48', stroke: '#2F4C78', ink: '#CFDCEF' },
    paddingX: 16,
    paddingY: 20,
    radius: 3,
    shadow: false,
    titleFont: 'mono',
    annotationFont: 'sans',
    titleSize: 12.5,
    titleLine: 17,
    annotationSize: 11,
    chroma: 0.85,
    primary: ['#7FC4F2', 300],
    secondary: ['#F2C14E', 300],
  },
};

// --- Color math (OKLCH) ------------------------------------------------------------------------

type Lch = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, c => c + c) : hex;
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function hexToLch(hex: string): Lch {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b),
    m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b),
    s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}

function lchToLinear([L, C, H]: Lch): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180),
    b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** OKLCH to hex, lowering chroma until the color is inside sRGB. */
function lchToHex([L, C, H]: Lch): string {
  let c = C,
    rgb = lchToLinear([L, c, H]);
  while (c > 0 && rgb.some(v => v < -0.0005 || v > 1.0005)) {
    c = Math.max(0, c - 0.004);
    rgb = lchToLinear([L, c, H]);
  }
  return (
    '#' +
    rgb
      .map(v =>
        Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, v))))) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  );
}

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string) {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Lightness of each shade, light to dark. Shades fall in two bands with no mid-tones between
 * them: 50–300 are pale fills with dark text, 400–950 are fills dark enough for white text.
 * Mid-tone fills read poorly with either ink, so the scale steps over them.
 */
const LIGHTNESS: Record<Shade, number> = {
  50: 0.975,
  100: 0.945,
  200: 0.9,
  300: 0.84,
  400: 0.62,
  500: 0.56,
  600: 0.5,
  700: 0.44,
  800: 0.38,
  900: 0.32,
  950: 0.26,
};
const isPale = (s: Shade) => s <= 300;

/**
 * Warm hues (orange, amber, gold) turn rust and brown when darkened for white text, so their 400
 * and 500 stay bright and carry dark text instead. 600 and darker carry white text as usual. This
 * also sets orange apart from red by lightness, which red-green color blindness keeps.
 */
const isWarm = (H: number) => H >= 45 && H <= 110;
const BRIGHT: Partial<Record<Shade, number>> = { 400: 0.8, 500: 0.74 };
/** Orange sits a step darker than amber, so the two stay apart without hue. */
const brightAt = (shade: Shade, H: number) =>
  BRIGHT[shade] === undefined ? undefined : BRIGHT[shade] - (H < 65 ? 0.07 : 0);
const darkInked = (s: Shade, H: number) => isPale(s) || (isWarm(H) && s in BRIGHT);

/** Contrast targets (WCAG ratios) every generated color meets. */
export const CONTRAST = {
  /** Dark title text on a pale fill. */
  paleInk: 7,
  /** White title text on a dark fill. */
  darkInk: 4.5,
  /** A shape's outline against the canvas when its fill alone does not separate it. */
  outline: 3,
  /** Connection lines and connection label text against the canvas. */
  connection: 4.5,
  /** A group's frame against the canvas. */
  frame: 2,
} as const;

/** How much of a family's chroma a shade carries: pale and very dark shades are quieter. */
const chromaAt = (L: number) => Math.max(0.18, 1 - ((L - 0.6) / 0.42) ** 2);

/**
 * Hue and chroma of the built-in families. Green leans blue and red leans orange, so the pair
 * stays apart for red-green color blindness; violet sits away from blue for the same reason.
 */
const FAMILY_HUES: Record<string, [number, number]> = {
  slate: [255, 0.03],
  stone: [70, 0.02],
  blue: [258, 0.14],
  sky: [232, 0.1],
  teal: [195, 0.085],
  mint: [168, 0.09],
  green: [155, 0.12],
  amber: [78, 0.14],
  orange: [50, 0.15],
  red: [32, 0.17],
  rose: [358, 0.12],
  violet: [305, 0.13],
};

const DARK_INK = (h: number): string => lchToHex([0.24, 0.035, h]);
const LIGHT_INK = '#FFFFFF';

/**
 * Move a color's lightness away from `against` until it reaches `min` contrast with it. Colors
 * that already meet the target are returned unchanged.
 */
export function ensureContrast(color: string, against: string, min: number): string {
  if (contrast(color, against) >= min) return color;
  const [L, C, H] = hexToLch(color),
    step = luminance(against) > 0.18 ? -0.01 : 0.01;
  let out = color;
  for (let l = L; l > 0 && l < 1 && contrast(out, against) < min; l += step)
    out = lchToHex([l, C, H]);
  return out;
}

/**
 * One shade starting at lightness `L`: a fill that meets its ink target, and an outline visible on
 * the canvas. Returns the lightness the fill ended at.
 */
function swatchAt(
  shade: Shade,
  start: number,
  C: number,
  H: number,
  canvas: string,
  dark: boolean,
  fixed?: string,
): { swatch: Swatch; L: number } {
  const pale = darkInked(shade, H),
    ink = pale ? DARK_INK(H) : LIGHT_INK,
    target = isPale(shade) ? CONTRAST.paleInk : CONTRAST.darkInk;
  let L = fixed ? hexToLch(fixed)[0] : start,
    fill = fixed ?? lchToHex([L, C * chromaAt(L), H]);
  while (contrast(fill, ink) < target && L > 0.05 && L < 0.995) {
    L += pale ? 0.005 : -0.01;
    fill = lchToHex([L, C * chromaAt(L), H]);
  }
  const edge = pale ? L - 0.2 : dark ? L + 0.14 : L - 0.08;
  let stroke = lchToHex([edge, C * chromaAt(edge) * 1.1, H]);
  if (contrast(fill, canvas) < CONTRAST.outline)
    stroke = ensureContrast(stroke, canvas, CONTRAST.outline);
  return { swatch: { fill, stroke, ink }, L };
}

/** Lightness step between neighboring dark shades, so every stop stays distinct. */
const DARK_STEP = 0.055;

/** A family's shades in order; each fill is darker than the one before. */
function ramp(H: number, C: number, canvas: string, dark: boolean, anchor?: [string, Shade]) {
  const out = new Map<Shade, Swatch>();
  let previous = 1;
  for (const shade of SHADES) {
    const bright = isWarm(H) ? brightAt(shade, H) : undefined;
    const start = isPale(shade)
      ? LIGHTNESS[shade]
      : Math.min(bright ?? LIGHTNESS[shade], previous - DARK_STEP);
    let next = swatchAt(
      shade,
      start,
      C,
      H,
      canvas,
      dark,
      anchor?.[1] === shade ? anchor[0] : undefined,
    );
    // An anchor that would break the order gives way to the generated shade.
    if (next.L >= previous - 0.01) next = swatchAt(shade, start, C, H, canvas, dark);
    previous = next.L;
    out.set(shade, next.swatch);
  }
  return out;
}

/** A ramp through a theme's anchor color, which sits at its shade when it meets the targets. */
function anchoredRamp([color, at]: [string, Shade], canvas: string, dark: boolean) {
  const [L, C, H] = hexToLch(color);
  return ramp(H, C / chromaAt(L), canvas, dark, [color.toUpperCase(), at]);
}

const presetFamilies = new Map<string, Map<string, Map<Shade, Swatch>>>();

/** The built-in families of a preset on a canvas color, generated once. */
export function builtInFamilies(
  theme: ThemeId,
  canvas = PRESETS[theme].canvas,
  dark = PRESETS[theme].dark,
): Map<string, Map<Shade, Swatch>> {
  const key = theme + canvas + (dark === PRESETS[theme].dark ? '' : ':' + dark);
  let families = presetFamilies.get(key);
  if (!families) {
    const p = PRESETS[theme];
    families = new Map([
      ['primary', anchoredRamp(p.primary, canvas, dark)],
      ['secondary', anchoredRamp(p.secondary, canvas, dark)],
    ]);
    for (const [name, hue] of Object.entries(FAMILY_HUES)) {
      const [h, c] = p.hues?.[name] ?? hue;
      families.set(name, ramp(h, c * p.chroma, canvas, dark));
    }
    presetFamilies.set(key, families);
  }
  return families;
}

// --- Resolution --------------------------------------------------------------------------------

export interface ResolvedAppearance {
  theme: ThemeId;
  dark: boolean;
  canvas: string;
  text: string;
  muted: string;
  connection: string;
  /** Default node and group colors when nothing names a family. */
  node: Swatch;
  group: Swatch;
  paddingX: number;
  paddingY: number;
  radius: number;
  shadow: boolean;
  title: TypeProfile;
  groupTitle: TypeProfile;
  annotation: TypeProfile;
  /** Space above a group's content; the group title sits in it. */
  groupHeader: number;
  /** Every family and the shades it defines: built-in ones plus the file's own. */
  families: Map<string, Map<Shade, Swatch>>;
  custom: Set<string>;
  /** Strike a removed object's title through (`config strike-removed=on`). */
  strikeRemoved: boolean;
}

/** Height of a group's title band, derived from the title's line height. */
export const groupHeaderFor = (lineHeight: number) => Math.round(lineHeight + 32);

const cache = new Map<string, ResolvedAppearance>();

/** Preset values, then file overrides. Omitted fields inherit from the preset. */
export function resolveAppearance(appearance?: DiagramAppearance): ResolvedAppearance {
  const a = appearance ?? defaultAppearance();
  const key = JSON.stringify(a);
  const known = cache.get(key);
  if (known) return known;
  const p = PRESETS[a.theme] ?? PRESETS[DEFAULT_THEME],
    o = a.overrides;
  const titleFont = o.titleFont ?? p.titleFont,
    annotationFont = o.annotationFont ?? p.annotationFont;
  const host = a.host ?? {};
  const canvas = host.canvas ?? o.canvas ?? p.canvas,
    dark = host.dark ?? p.dark;
  const families = new Map(
    [...builtInFamilies(a.theme, canvas, dark)].map(([name, shades]) => [name, new Map(shades)]),
  );
  const custom = new Set<string>();
  for (const c of [...a.colors, ...(host.colors ?? [])]) {
    if (!families.has(c.family)) {
      families.set(c.family, new Map());
      custom.add(c.family);
    }
    const shades = families.get(c.family)!,
      base = shades.get(c.shade);
    if (base || (c.fill && c.stroke && c.ink))
      shades.set(c.shade, {
        fill: c.fill ?? base!.fill,
        stroke: c.stroke ?? base!.stroke,
        ink: c.ink ?? base!.ink,
      });
  }
  const title = typeProfile(titleFont, true, p.titleSize, p.titleLine);
  const resolved: ResolvedAppearance = {
    theme: a.theme,
    dark,
    // Preset colors are held to the contrast targets against the actual canvas; colors the file
    // sets explicitly are used exactly as written.
    canvas,
    text: o.text ?? ensureContrast(p.text, canvas, 7),
    muted: ensureContrast(p.muted, canvas, CONTRAST.connection),
    connection: o.connection ?? ensureContrast(p.connection, canvas, CONTRAST.connection),
    node: {
      fill: p.node.fill,
      stroke: ensureContrast(p.node.stroke, canvas, CONTRAST.outline),
      ink: o.text ?? ensureContrast(p.node.ink, p.node.fill, CONTRAST.paleInk),
    },
    group: {
      fill: p.group.fill,
      stroke: ensureContrast(p.group.stroke, canvas, CONTRAST.frame),
      ink: ensureContrast(p.group.ink, p.group.fill, CONTRAST.paleInk),
    },
    paddingX: o.paddingX ?? p.paddingX,
    paddingY: o.paddingY ?? p.paddingY,
    radius: o.radius ?? p.radius,
    shadow: p.shadow,
    title,
    groupTitle: title,
    annotation: typeProfile(
      annotationFont,
      false,
      p.annotationSize,
      Math.round(p.annotationSize * 1.4),
    ),
    groupHeader: groupHeaderFor(title.lineHeight),
    families,
    custom,
    strikeRemoved: !!a.config?.strikeRemoved,
  };
  // The host's paint goes over the file's, after the file's colors were held to the canvas.
  if (host.text) resolved.text = resolved.node.ink = host.text;
  if (host.muted) resolved.muted = host.muted;
  if (host.connection) resolved.connection = host.connection;
  if (host.node) resolved.node = { ...resolved.node, ...host.node };
  if (host.group) resolved.group = { ...resolved.group, ...host.group };
  if (cache.size > 50) cache.clear();
  cache.set(key, resolved);
  return resolved;
}

/**
 * Colors for an object. `family` is a family name, or `auto` for the theme's default surface; an
 * omitted shade is 500 for nodes and 100 for groups. Unknown families or shades fall back to the
 * default surface; the file parser reports them before they get here.
 */
export function swatchFor(
  r: ResolvedAppearance,
  family: string | undefined,
  shade: Shade | undefined,
  kind: 'node' | 'group' = 'node',
): Swatch {
  const surface = kind === 'group' ? r.group : r.node;
  if (!family || family === 'auto') {
    if (shade === undefined) return surface;
    family = 'slate';
  }
  return (
    r.families
      .get(family)
      ?.get(shade ?? (kind === 'group' ? groupShadeFor(r.theme, r.dark) : NODE_SHADE)) ?? surface
  );
}

/** Shades a family defines, in numeric order. */
export const shadesOf = (r: ResolvedAppearance, family: string): Shade[] =>
  SHADES.filter(s => r.families.get(family)?.has(s));
