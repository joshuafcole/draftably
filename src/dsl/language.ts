/**
 * The `.draft` language as data: every statement `parseModel` accepts, the attributes each takes,
 * and what each attribute's value may be. `parseModel` reads its attribute lists and its closed
 * vocabularies from `LANGUAGE`, so a host can list the language without reading the parser, and the
 * list cannot disagree with it.
 *
 * What stays in the parser is how a statement reads: how many words it takes, the ranges of its
 * numbers, and the rules between attributes, such as `min-height` needing `height=auto`.
 */
import { LEGEND_LINES, THEME_IDS } from '../model/appearance';
import { FONT_ROLES } from '../model/fonts';
import { EDITORS } from '../model/link';
import { MARKERS } from '../model/markers';
import { NOTE_SIDES } from '../model/note';
import type { LayoutAlgorithmId, LayoutSettings, PortSide, RoutingSettings } from '../model/types';
import type { DslShape } from './syntax';

/** Image shapes a drawing can aim for (`fit=`, `vary --fit`): width over height. */
export const FITS = { wide: 2, slide: 1.78, square: 1, page: 0.77, tall: 0.6 } as const;
export type Fit = keyof typeof FITS;

/** `config` keys and the setting each sets. */
export const CONFIG_KEYS = {
  'link-base': 'linkBase',
  editor: 'editor',
  'strike-removed': 'strikeRemoved',
} as const;

/** Theme attributes in the file and the override each sets. */
export const THEME_ATTRS = {
  'padding-x': 'paddingX',
  'padding-y': 'paddingY',
  radius: 'radius',
  'title-font': 'titleFont',
  'annotation-font': 'annotationFont',
  canvas: 'canvas',
  text: 'text',
  connection: 'connection',
} as const;

// --- Engine and routing parameters ------------------------------------------------------------

export type Param<K extends string> =
  { key: K; min: number; max: number } | { key: K; choices: readonly string[] };

/**
 * Layout engines a file can name. `separate` is left out: it only repairs overlaps in the current
 * drawing, so it cannot be recomputed from the source.
 */
export const ENGINES = [
  'compound-flow',
  'boundary-align',
  'compound-spring',
  'tidy',
  'stress',
  'force',
  'flow',
  'layered',
  'tree',
  'grid',
] as const satisfies readonly LayoutAlgorithmId[];

const ENGINE_TABLE = {
  'rank-gap': { key: 'rankGap', min: 12, max: 220 },
  'group-gap': { key: 'groupGap', min: 12, max: 180 },
  'node-gap': { key: 'nodeGap', min: 4, max: 160 },
  'boundary-pull': { key: 'boundaryPull', min: 0, max: 100 },
  'hierarchy-sweeps': { key: 'hierarchySweeps', min: 1, max: 4 },
  'edge-length': { key: 'edgeLength', min: 20, max: 260 },
  repulsion: { key: 'repulsion', min: 0, max: 100 },
  'flow-strength': { key: 'flowStrength', min: 0, max: 100 },
  alignment: { key: 'alignment', min: 0, max: 100 },
  compactness: { key: 'compactness', min: 0, max: 100 },
  'grid-strength': { key: 'gridStrength', min: 0, max: 100 },
  ordering: { key: 'ordering', choices: ['stable', 'crossings'] },
  fold: { key: 'fold', choices: ['auto', 'never'] },
  aspect: { key: 'aspect', choices: ['1', '1.333', '1.6', '2', '0.75'] },
  root: { key: 'rootId', choices: [] },
} as const satisfies Record<string, Param<keyof LayoutSettings>>;

const ROUTING_TABLE = {
  clearance: { key: 'clearance', min: 4, max: 30 },
  'port-gap': { key: 'portGap', min: 6, max: 28 },
  'edge-gap': { key: 'edgeGap', min: 4, max: 48 },
  'bend-penalty': { key: 'bendPenalty', min: 0, max: 100 },
  'crossing-penalty': { key: 'crossingPenalty', min: 0, max: 1200 },
  'shared-penalty': { key: 'sharedPenalty', min: 0, max: 20 },
  'parallel-penalty': { key: 'parallelPenalty', min: 0, max: 60 },
  'port-stability': { key: 'portStability', min: 0, max: 150 },
  'fanout-penalty': { key: 'fanoutPenalty', min: 0, max: 160 },
  passes: { key: 'passes', min: 1, max: 5 },
  'corner-radius': { key: 'cornerRadius', min: 0, max: 16 },
  standoff: { key: 'standoff', min: 0, max: 40 },
  bundle: { key: 'bundle', min: 2, max: 12 },
  hops: { key: 'hops', choices: ['off', 'on'] },
} as const satisfies Record<string, Param<keyof RoutingSettings>>;

/** Engine settings by source attribute. Ranges match the engine's own limits. */
export const ENGINE_PARAMS: Record<string, Param<keyof LayoutSettings>> = ENGINE_TABLE;

/** Router settings by source attribute. Ranges match the router's own limits. */
export const ROUTING_PARAMS: Record<string, Param<keyof RoutingSettings>> = ROUTING_TABLE;

// --- Shapes, frames and sides -----------------------------------------------------------------

export const DSL_SHAPES = [
  'box',
  'pill',
  'circle',
  'diamond',
  'text',
  'marker',
  'portal',
] as const satisfies readonly DslShape[];
/** Shapes a node's box can draw as it was: a marker's box is a thin cut, so it has no other shape. */
export const PAST_SHAPES = ['box', 'pill', 'circle', 'diamond', 'text'] as const satisfies Exclude<
  (typeof DSL_SHAPES)[number],
  'marker' | 'portal'
>[];
export const FRAMES = ['box', 'soft', 'none'] as const;
export const SIDES = [
  'auto',
  'left',
  'right',
  'top',
  'bottom',
] as const satisfies readonly PortSide[];

// --- The table --------------------------------------------------------------------------------

/**
 * An attribute value that is not one of a closed list of words:
 * - `number`: a bare number, within a range the parser checks.
 * - `text`: any word, usually quoted.
 * - `id`: one stable identifier; `ids`: several in one word, `a,b,c`.
 * - `color`: `auto`, a built-in color family or a `theme-color` name.
 * - `shade`: one of the shades `50` to `950`.
 * - `hex`: `"#rrggbb"`, in double quotes.
 * - `count`: a number, or a short symbol such as `N` for an unknown number.
 * - `span`: a number of columns, or `var` for a field of variable length.
 * - `height`: a number, or `auto` for the title's height at that width.
 * - `pair`: two numbers, `a,b`; `points`: up to `ROUTE_POINTS` pairs, `x1,y1;x2,y2`.
 */
export type OpenValue =
  | 'number'
  | 'text'
  | 'id'
  | 'ids'
  | 'color'
  | 'shade'
  | 'hex'
  | 'count'
  | 'span'
  | 'height'
  | 'pair'
  | 'points';

/** What an attribute's value may be: a closed vocabulary of words, or an open kind of word. */
export type AttributeValue = readonly string[] | OpenValue;

export interface StatementSpec {
  /** Every attribute the statement takes in any of its forms, and what its value may be. */
  readonly attrs: Readonly<Record<string, AttributeValue>>;
  /** Closed vocabularies of positional words, by the role of the word. */
  readonly words?: Readonly<Record<string, readonly string[]>>;
  /**
   * A statement whose forms take different attributes: the attributes of each part, which the
   * parser puts together by form. Every attribute is in at least one part.
   */
  readonly forms?: Readonly<Record<string, readonly string[]>>;
  /** Whether the statement takes a change mark, `+ - ~ .`, before it. */
  readonly marks?: true;
}

type ParamValue<P> = P extends { choices: infer C extends readonly string[] }
  ? C extends readonly []
    ? 'id'
    : C
  : 'number';

/** A parameter table's attributes as table values: a closed list of choices, or an open kind. */
function paramValues<T extends Record<string, Param<string>>>(table: T) {
  return Object.fromEntries(
    Object.entries(table).map(([attr, p]) => [
      attr,
      'min' in p ? 'number' : p.choices.length ? p.choices : 'id',
    ]),
  ) as { readonly [K in keyof T]: ParamValue<T[K]> };
}

const ON_OFF = ['on', 'off'] as const;
const TRUE_FALSE = ['true', 'false'] as const;
const DIRECTIONS = ['auto', 'right', 'down'] as const;
const STRENGTHS = ['prefer', 'required'] as const;
const FOLDS = ['auto', 'never'] as const;
/** The names of `FITS`, as a list; the test holds it to `FITS`. */
export const FIT_NAMES = [
  'wide',
  'slide',
  'square',
  'page',
  'tall',
] as const satisfies readonly Fit[];

/**
 * Every statement `parseModel` accepts, in the order the parser reads them. `view`,
 * `snapshot` and `box` are not here: the parser names them only to refuse them.
 */
export const LANGUAGE = {
  diagram: { attrs: { version: 'number', width: 'number' } },
  compare: { attrs: { direction: DIRECTIONS, aspect: 'number' } },
  config: {
    attrs: {
      'link-base': 'text',
      editor: EDITORS,
      'strike-removed': ON_OFF,
    } satisfies Record<keyof typeof CONFIG_KEYS, AttributeValue>,
  },
  state: { attrs: { rest: ['dim', 'plain'], chips: ['shown', 'hidden'], context: 'ids' } },
  phase: { attrs: {} },
  'was-order': { attrs: {} },
  subtitle: { attrs: {} },
  node: {
    marks: true,
    attrs: {
      in: 'id',
      color: 'color',
      shade: 'shade',
      shape: DSL_SHAPES,
      was: 'text',
      'was-shape': PAST_SHAPES,
      'was-count': 'count',
      'was-at': 'pair',
      'was-size': 'pair',
      href: 'text',
      count: 'count',
      span: 'span',
    },
  },
  group: {
    marks: true,
    attrs: {
      in: 'id',
      color: 'color',
      shade: 'shade',
      was: 'text',
      'was-at': 'pair',
      href: 'text',
      frame: FRAMES,
      fold: FOLDS,
    },
  },
  edge: {
    marks: true,
    attrs: {
      kind: ['sync', 'async'],
      from: SIDES,
      to: SIDES,
      was: 'text',
      constraint: TRUE_FALSE,
      directed: TRUE_FALSE,
      head: MARKERS,
      tail: MARKERS,
    },
  },
  layout: {
    attrs: {
      // Engine settings first, so that `fold`, which a recipe line takes too, reads as one word.
      ...paramValues(ENGINE_TABLE),
      direction: DIRECTIONS,
      'min-width': 'number',
      'min-height': 'number',
      fit: FIT_NAMES,
      gap: 'number',
      fold: FOLDS,
      columns: 'number',
      unit: ['bit', 'byte'],
      'unit-width': 'number',
      ruler: ON_OFF,
      engine: ENGINES,
    },
    words: { recipe: ['flow', 'row', 'column', 'lanes', 'sequence', 'cells'] },
    // Every layout line takes `common`, and the root's takes `root`. An `engine=` line adds
    // `engine`; otherwise a `cells` line adds `cells`, any other recipe `recipe`, and `flow` `flow`.
    forms: {
      common: ['direction', 'min-width', 'min-height'],
      root: ['fit'],
      engine: ['engine', ...Object.keys(ENGINE_TABLE)],
      cells: ['columns', 'unit', 'unit-width', 'ruler'],
      recipe: ['gap'],
      flow: ['fold'],
    },
  },
  theme: {
    attrs: {
      'padding-x': 'number',
      'padding-y': 'number',
      radius: 'number',
      'title-font': FONT_ROLES,
      'annotation-font': FONT_ROLES,
      canvas: 'hex',
      text: 'hex',
      connection: 'hex',
    } satisfies Record<keyof typeof THEME_ATTRS, AttributeValue>,
    words: { name: THEME_IDS },
  },
  'theme-color': { attrs: { shade: 'shade', fill: 'hex', stroke: 'hex', ink: 'hex' } },
  legend: {
    attrs: { shade: 'shade' },
    words: { line: LEGEND_LINES },
    // `legend family "meaning" shade=`, or `legend line dashed "meaning"`.
    forms: { family: ['shade'], line: [] },
  },
  note: {
    attrs: { near: 'id', side: NOTE_SIDES, width: 'number', states: 'ids', leader: ON_OFF },
  },
  footnote: { attrs: {} },
  routing: { attrs: paramValues(ROUTING_TABLE) },
  bundle: { attrs: {} },
  route: { attrs: { via: 'points', strength: ['soft', 'required'] } },
  label: { attrs: { at: 'number', offset: 'number' } },
  order: { attrs: {} },
  align: { attrs: { strength: STRENGTHS }, words: { axis: ['x', 'y'] } },
  near: {
    attrs: {
      side: ['right', 'left', 'above', 'below'],
      gap: 'number',
      offset: 'number',
      strength: STRENGTHS,
    },
  },
  nudge: { attrs: { dx: 'number', dy: 'number' } },
  stay: { attrs: { x: 'number', y: 'number', weight: 'number' } },
  pin: { attrs: { x: 'number', y: 'number' } },
  size: { attrs: { width: 'number', height: 'height', 'min-height': 'number' } },
} as const satisfies Record<string, StatementSpec>;

/** A statement the language has. */
export type LanguageStatement = keyof typeof LANGUAGE;
/** An attribute statement `S` takes. */
export type LanguageAttribute<S extends LanguageStatement> = keyof (typeof LANGUAGE)[S]['attrs'] &
  string;

/** The attributes statement `command` takes, or undefined when the language has no such statement. */
export const statementSpec = (command: string): StatementSpec | undefined =>
  Object.hasOwn(LANGUAGE, command) ? LANGUAGE[command as LanguageStatement] : undefined;

/** The attribute names statement `command` takes in any form. */
export const attributesOf = (command: LanguageStatement): string[] =>
  Object.keys(LANGUAGE[command].attrs);
