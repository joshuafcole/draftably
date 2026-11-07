/**
 * The `.draft` diagram language: a line-based source format that keeps comments, plus a model
 * parser and a formatter. Adapted from the Meld 0.1 prototype in `reference/meld/original`.
 *
 * Source is kept as a list of lines so that edits can change single statements and formatting
 * keeps every comment and unrelated statement.
 */
import {
  BUILT_IN_FAMILIES,
  defaultAppearance,
  groupShadeFor,
  NODE_SHADE,
  HEX_COLOR,
  isBuiltInFamily,
  LEGEND_LINES,
  OVERRIDE_LIMITS,
  SHADES,
  THEME_IDS,
  type DiagramAppearance,
  type LegendLine,
  type Shade,
  type ThemeId,
} from '../model/appearance';
import { FONT_ROLES, type FontRole } from '../model/fonts';
import { MARKERS, type EndMarker } from '../model/markers';
import { EDITORS } from '../model/link';
import { NOTE_SIDES, NOTE_WIDTH } from '../model/note';
import type { Status } from '../model/status';
import type {
  ColorKey,
  LayoutAlgorithmId,
  LayoutSettings,
  PortSide,
  RoutingSettings,
  ShapeKind,
} from '../model/types';

export class DslError extends Error {
  constructor(
    message: string,
    readonly line = 0,
    readonly column = 0,
  ) {
    super((line ? `Line ${line}${column ? `, column ${column}` : ''}: ` : '') + message);
    this.name = 'DslError';
  }
}

/** Change marks before `node`, `group` and `edge`, read like a diff, and the status each sets. */
export const MARKS = { '+': 'added', '-': 'removed', '~': 'changed', '.': 'context' } as const;
export type Mark = keyof typeof MARKS;

/** A word in a statement. Quoted words are strings; bare words are identifiers and numbers. */
export interface Word {
  value: string;
  quoted: boolean;
}

export interface Statement {
  kind: 'statement';
  command: string;
  /** Change mark written before the command, as in a diff: `+`, `-`, `~` or `.`. */
  mark?: Mark;
  args: Word[];
  attrs: Array<[string, Word]>;
  /** Inline comment including its `#` or `//` marker. */
  comment?: string;
  /** 1-based line in the source this statement was parsed from; 0 when added by an edit. */
  line: number;
}

export type SourceLine = { kind: 'blank' } | { kind: 'comment'; text: string } | Statement;

export interface SourceDoc {
  lines: SourceLine[];
}

export const bare = (value: string | number): Word => ({ value: String(value), quoted: false });
export const quoted = (value: string): Word => ({ value, quoted: true });

// --- Tokens ------------------------------------------------------------------------------------

const INNER_QUOTE =
  'A quote inside a quoted string needs a backslash: write \\" for each inner quote.';

/**
 * Split one line into raw tokens, each with its 1-based start column, and a trailing comment.
 * Quoted tokens keep their quotes.
 */
export function tokenize(
  text: string,
  line = 0,
): { tokens: string[]; columns: number[]; comment?: string } {
  const tokens: string[] = [],
    columns: number[] = [];
  let token = '',
    start = 0,
    open = 0,
    inQuote = false,
    escaped = false;
  const push = () => {
    if (token) {
      tokens.push(token);
      columns.push(start + 1);
    }
    token = '';
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (!token) start = i;
    if (escaped) {
      token += c;
      escaped = false;
      continue;
    }
    if (inQuote && c === '\\') {
      token += c;
      escaped = true;
      continue;
    }
    if (c === '"') {
      // A closing quote ends the word; text right after it means the label had a bare inner quote.
      if (
        inQuote &&
        i + 1 < text.length &&
        !/[\s#]/.test(text[i + 1]) &&
        !text.startsWith('//', i + 1)
      )
        throw new DslError(INNER_QUOTE, line, i + 1);
      if (!inQuote) open = i;
      inQuote = !inQuote;
      token += c;
      continue;
    }
    // `//` inside a bare word is text, so an unquoted URL keeps its path.
    const slashes = c === '/' && text[i + 1] === '/' && !/[^\s"]/.test(text[i - 1] ?? ' ');
    if (!inQuote && (c === '#' || slashes)) {
      push();
      return { tokens, columns, comment: text.slice(i).trim() };
    }
    if (!inQuote && /\s/.test(c)) push();
    else token += c;
  }
  if (inQuote) throw new DslError('Unclosed quoted string.', line, open + 1);
  push();
  return { tokens, columns };
}

function word(raw: string, line: number, column: number): Word {
  if (!raw.startsWith('"')) return bare(raw);
  try {
    return quoted(JSON.parse(raw));
  } catch {
    throw new DslError(
      'Invalid escape in a quoted string. Use \\" for a quote, \\\\ for a backslash and \\n for a line break.',
      line,
      column,
    );
  }
}

/** Read source text into lines. Only lexical errors are reported here. */
export function readSource(source: string): SourceDoc {
  if (typeof source !== 'string') throw new DslError('Source must be text.');
  if (source.length > 300_000) throw new DslError('Limit: 300,000 source characters.');
  const lines: SourceLine[] = source.split(/\r?\n/).map((text, i) => {
    const line = i + 1,
      { tokens, columns, comment } = tokenize(text, line);
    if (!tokens.length) return comment ? { kind: 'comment', text: comment } : { kind: 'blank' };
    const [first, ...rest] = tokens,
      mark = MARKS[first[0] as Mark] && first.length > 1 ? (first[0] as Mark) : undefined,
      command = mark ? first.slice(1) : first,
      args: Word[] = [],
      attrs: Array<[string, Word]> = [];
    rest.forEach((raw, i) => {
      const eq = raw.indexOf('='),
        col = columns[i + 1];
      if (eq > 0 && !raw.startsWith('"')) {
        const key = raw.slice(0, eq);
        if (attrs.some(([k]) => k === key)) throw new DslError(`Duplicate attribute ${key}.`, line);
        attrs.push([key, word(raw.slice(eq + 1), line, col + eq + 1)]);
      } else args.push(word(raw, line, col));
    });
    return { kind: 'statement', command, ...(mark ? { mark } : {}), args, attrs, comment, line };
  });
  return { lines };
}

// --- Formatting --------------------------------------------------------------------------------

const BARE = /^[A-Za-z0-9_.+-]+$|^->$/;
const printWord = (w: Word) =>
  w.quoted || !BARE.test(w.value) ? JSON.stringify(w.value) : w.value;

export function printStatement(s: Statement): string {
  const parts = [
    (s.mark ?? '') + s.command,
    ...s.args.map(printWord),
    ...s.attrs.map(([k, v]) => k + '=' + printWord(v)),
  ];
  return parts.join(' ') + (s.comment ? ' ' + s.comment : '');
}

/**
 * Print source consistently: one space between words, no indentation, at most one blank line in a
 * row, and a final newline. Comments and statement order are kept.
 */
export function printSource(doc: SourceDoc): string {
  const out: string[] = [];
  for (const line of doc.lines) {
    if (line.kind === 'blank') {
      if (out.length && out.at(-1) !== '') out.push('');
    } else out.push(line.kind === 'comment' ? line.text : printStatement(line));
  }
  while (out.at(-1) === '') out.pop();
  return out.join('\n') + '\n';
}

/** Format source text. Throws `DslError` for lexical errors; semantics are not checked. */
export const formatSource = (source: string) => printSource(readSource(source));

// --- Model -------------------------------------------------------------------------------------

export type DslColor = ColorKey | 'auto';
export type DslShape = Exclude<ShapeKind, 'icon' | 'image'>;
/** `cells` lays a group's members edge to edge as one object: a sequence, table or byte layout. */
export type Algorithm = 'flow' | 'row' | 'column' | 'lanes' | 'sequence' | 'cells';

export interface ModelObject {
  id: string;
  type: 'node' | 'group';
  label: string;
  parent: string;
  color: DslColor;
  /** Explicit shade; omitted means the default for the object type. */
  shade?: Shade;
  shape: DslShape;
  /** From a change mark; unchanged when omitted. */
  status?: Status;
  /** With `~`: the label before the change. */
  was?: string;
  /** With `~`, nodes only: the shape before the change. */
  wasShape?: DslShape;
  /** With `~`, nodes only: the count before the change; 1 means a single box. */
  wasCount?: number | string;
  /** A link to open from exported drawings, such as a source file or URL. */
  href?: string;
  /**
   * Nodes only: how many things this one box stands for, drawn as a stack with a badge. A short
   * symbol such as `N` or `many` stands for an unknown number.
   */
  count?: number | string;
  /**
   * Groups only: `soft` draws a tint behind the members and `none` draws nothing. Either way the
   * group is not a layout scope: its members are laid out with the nearest framed container's.
   */
  frame?: 'soft' | 'none';
  /** Groups only: `fold=never` keeps the group's chain in one column even when it is much the tallest. */
  fold?: 'never';
  /** Set by the compiler: the soft groups this object sits in below its layout scope, outermost first. */
  soft?: string[];
  /** Cells only: how many columns (or units) of its group's grid the cell covers; `var` for a
   * field of variable length in a byte or bit layout. */
  span?: number | 'var';
  line: number;
}

export interface ModelEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  dashed: boolean;
  from: PortSide;
  to: PortSide;
  /** From a change mark; unchanged when omitted. */
  status?: Status;
  /** With `~`: the label before the change. */
  was?: string;
  /** `directed=false`: an undirected connection, drawn without an arrowhead. */
  directed?: false;
  /** `head=`: the mark at the target end, when it isn't the plain arrow. */
  head?: EndMarker;
  /** `tail=`: the mark at the source end, when it has one. */
  tail?: EndMarker;
  /** `constraint=false`: drawn and routed, but layout doesn't rank or order by it. */
  constraint?: false;
  line: number;
}

/** A layout engine run cold over a scope's subtree; see `src/engines/layout-engine.js`. */
export interface EngineRecipe {
  algorithm: LayoutAlgorithmId;
  params: Partial<LayoutSettings>;
}

/** Image shapes a drawing can aim for (`fit=`, `vary --fit`): width over height. */
export const FITS = { wide: 2, slide: 1.78, square: 1, page: 0.77, tall: 0.6 } as const;
export type Fit = keyof typeof FITS;

export interface ModelLayout {
  scope: string;
  algorithm: Algorithm;
  /** Set when the scope is arranged by a layout engine instead of a built-in recipe. */
  engine?: EngineRecipe;
  direction: 'auto' | 'right' | 'down';
  /** `cells` only: columns in each row of the grid; one row or column without it. */
  columns?: number;
  /** `cells` only: a byte or bit layout, where each column is one unit of the same width. */
  unit?: 'bit' | 'byte';
  /** With `unit`: the width of one unit, and whether unit numbers run above the first row. */
  unitWidth?: number;
  ruler?: boolean;
  /** `flow` only: whether a long run of ranks folds into bands. Engines take `fold` as a param. */
  fold: 'auto' | 'never';
  /** Root only: the image shape to aim for; compile tries direction and folding to get closest. */
  fit?: Fit;
  gap: number;
  minWidth: number;
  minHeight: number;
  line: number;
}

export type Hint =
  | { type: 'order'; scope: string; ids: string[]; line: number }
  | { type: 'align'; axis: 'x' | 'y'; ids: string[]; strength: Strength; line: number }
  | {
      type: 'near';
      id: string;
      ref: string;
      side: NearSide;
      gap: number;
      offset: number;
      strength: Strength;
      line: number;
    }
  | { type: 'nudge'; id: string; dx: number; dy: number; line: number }
  | { type: 'stay'; id: string; x: number; y: number; weight: number; line: number }
  | { type: 'pin'; id: string; x: number; y: number; line: number }
  /** `height` is unset for `height=auto`: the title's height at that width, as without a size. */
  | { type: 'size'; id: string; width: number; height?: number; minHeight?: number; line: number };

export type Strength = 'prefer' | 'required';

/**
 * What `near id ref` places against: `ref` itself when it is a sibling of `id`, else the group
 * around `ref` that is `id`'s sibling. Undefined when `ref` is not inside one.
 */
export function nearAnchor(by: Map<string, ModelObject>, id: string, ref: string) {
  const scope = layoutParent(by, id);
  for (let at: string | undefined = ref; at && at !== 'root'; at = layoutParent(by, at))
    if (layoutParent(by, at) === scope) return at === id ? undefined : at;
  return undefined;
}
export type NearSide = 'right' | 'left' | 'above' | 'below';
export type HintType = Hint['type'];
export const POSITION_HINTS: HintType[] = ['near', 'nudge', 'stay', 'pin'];

export interface Model {
  title: string;
  objects: ModelObject[];
  edges: ModelEdge[];
  layouts: ModelLayout[];
  hints: Hint[];
  /** Router settings from a `routing` statement. */
  routing: Partial<RoutingSettings>;
  /** Theme, overrides and color definitions from `theme` and `theme-color` statements. */
  appearance: DiagramAppearance;
  /** Source line of the `theme` statement, and of each `theme-color` by `family:shade`. */
  themeLine: number;
  colorLines: Map<string, number>;
  /** Source line of each `legend` entry, in order. */
  legendLines: number[];
  /** Source line of each `note`, in order. */
  noteLines: number[];
  /** Source line of each `footnote`, in order. */
  footnoteLines: number[];
  /** Source line of each ID an emphasis state lists, by `state:id`. */
  stateLines: Map<string, number>;
  /** Sequence diagrams: `phase` statements, each a run of messages drawn as a row band. */
  phases: Array<{ id: string; label: string; ids: string[]; line: number }>;
  /** Sequence diagrams: the `was-order` statement, the older version's message order. */
  wasOrder?: { ids: string[]; line: number };
  /** Problems that do not stop the file from drawing, such as a `config` key set twice. */
  warnings: { code: string; message: string; line: number }[];
}

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

type Param<K extends string> =
  { key: K; min: number; max: number } | { key: K; choices: readonly string[] };

/**
 * Layout engines a file can name. `separate` is left out: it only repairs overlaps in the current
 * drawing, so it cannot be recomputed from the source.
 */
export const ENGINES: readonly LayoutAlgorithmId[] = [
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
];

/** Engine settings by source attribute. Ranges match the engine's own limits. */
export const ENGINE_PARAMS: Record<string, Param<keyof LayoutSettings>> = {
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
};

/** Router settings by source attribute. Ranges match the router's own limits. */
export const ROUTING_PARAMS: Record<string, Param<keyof RoutingSettings>> = {
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
};

/** What to write instead of a layout attribute that a line does not take. */
function layoutHint(key: string, engine: boolean) {
  if (engine && key === 'gap') return 'Engine lines space boxes with node-gap= and rank-gap=.';
  if (!engine && key in ENGINE_PARAMS)
    return `${key}= needs an engine: add engine=layered or another engine.`;
  if (key === 'fit') return 'fit= goes on the layout root line.';
  return 'draftably skill print lists the layout settings.';
}

/** Source attribute for an engine or router setting. */
export const paramAttr = (table: Record<string, Param<string>>, key: string) =>
  Object.keys(table).find(attr => table[attr].key === key);

const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
export const isIdentifier = (s: string) => ID.test(s);

export const COLORS: DslColor[] = ['auto', ...BUILT_IN_FAMILIES];
const FAMILY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
export const DSL_SHAPES: DslShape[] = ['box', 'pill', 'circle', 'diamond', 'text', 'marker'];
/** Shapes a node's box can draw as it was: a marker's box is a thin cut, so it has no other shape. */
export const PAST_SHAPES = DSL_SHAPES.filter(s => s !== 'marker');
const FRAMES = ['box', 'soft', 'none'] as const;
/** A `count=` symbol for an unknown number: a letter or a short word, such as `N` or `many`. */
const COUNT_SYMBOL = /^[A-Za-z]{1,8}$/;
const SIDES: PortSide[] = ['auto', 'left', 'right', 'top', 'bottom'];

/** Parse and validate source. Throws `DslError` with a line number for the first problem. */
export function parseModel(source: string | SourceDoc): Model {
  const doc = typeof source === 'string' ? readSource(source) : source;
  const m: Model = {
    title: 'Untitled diagram',
    objects: [],
    edges: [],
    layouts: [],
    hints: [],
    routing: {},
    appearance: defaultAppearance(),
    themeLine: 0,
    colorLines: new Map(),
    legendLines: [],
    noteLines: [],
    footnoteLines: [],
    stateLines: new Map(),
    phases: [],
    warnings: [],
  };
  const configLines = new Map<string, number>();
  const objectIds = new Set<string>(),
    edgeIds = new Set<string>(),
    unique = new Set<string>();
  let diagramLine = 0;

  for (const s of doc.lines) {
    if (s.kind !== 'statement') continue;
    const line = s.line,
      { command, args } = s,
      attrs = new Map(s.attrs);
    const fail = (message: string): never => {
      throw new DslError(message, line);
    };
    const assert = (ok: unknown, message: string) => {
      if (!ok) fail(message);
    };
    const allow = (allowed: string[]) => {
      for (const key of attrs.keys())
        assert(allowed.includes(key), `Unknown ${command} attribute: ${key}.`);
    };
    const count = (lo: number, hi = lo) =>
      assert(args.length >= lo && args.length <= hi, `Wrong number of arguments for ${command}.`);
    const id = (w: Word | undefined) => {
      assert(
        w && !w.quoted && ID.test(w.value),
        'Expected a stable identifier (letters, digits, _, . or -).',
      );
      return w!.value;
    };
    const text = (w: Word | undefined) => w?.value ?? '';
    const num = (key: string, fallback: number, min = -100_000, max = 100_000) => {
      const w = attrs.get(key);
      if (w === undefined) return fallback;
      const n = Number(w.value);
      assert(
        !w.quoted && Number.isFinite(n) && n >= min && n <= max,
        `Expected ${key} from ${min} to ${max}; got ${w.value}.`,
      );
      return n;
    };
    const countOf = (key: string, min: number) => {
      const w = attrs.get(key)!;
      return !w.quoted && COUNT_SYMBOL.test(w.value) ? w.value : num(key, min, min, 1_000_000);
    };
    const choice = <T extends string>(key: string, fallback: T, choices: readonly T[]): T => {
      const value = (attrs.get(key)?.value ?? fallback) as T;
      assert(choices.includes(value), `Expected ${key}=${choices.join('|')}; got ${value}.`);
      return value;
    };
    const shadeOf = (w: Word) => {
      const n = Number(w.value);
      assert(
        !w.quoted && SHADES.includes(n as Shade),
        `Expected shade=${SHADES.join('|')}; got ${w.value}.`,
      );
      return n as Shade;
    };
    const hex = (key: string) => {
      const w = attrs.get(key)!;
      assert(
        w.quoted && HEX_COLOR.test(w.value),
        `Expected ${key}="#rrggbb" in double quotes; got ${w.value || 'nothing'}.`,
      );
      return w.value.toUpperCase();
    };
    const once = (key: string) => {
      assert(!unique.has(key), `Duplicate declaration: ${key}. Edit the existing line instead.`);
      unique.add(key);
    };
    const status: Status | undefined = s.mark && MARKS[s.mark];
    assert(
      !s.mark || ['node', 'group', 'edge'].includes(command),
      `Only node, group and edge lines take a ${s.mark} mark.`,
    );
    const was = () => {
      for (const key of ['was', 'was-shape', 'was-count'])
        assert(!attrs.has(key) || s.mark === '~', `${key}= belongs on a changed (~) line.`);
      return {
        ...(attrs.has('was') ? { was: attrs.get('was')!.value } : {}),
        ...(attrs.has('was-shape')
          ? { wasShape: choice('was-shape', 'box', PAST_SHAPES) as DslShape }
          : {}),
        ...(attrs.has('was-count') ? { wasCount: countOf('was-count', 1) } : {}),
      };
    };
    const readParams = <K extends string>(table: Record<string, Param<K>>) => {
      const out: Record<string, string | number> = {};
      for (const [attr, p] of Object.entries(table)) {
        if (!attrs.has(attr)) continue;
        if ('min' in p) out[p.key] = num(attr, 0, p.min, p.max);
        else if (p.choices.length) out[p.key] = choice(attr, p.choices[0], p.choices);
        else out[p.key] = id(attrs.get(attr));
      }
      return out as never;
    };

    switch (command) {
      case 'diagram':
        count(1);
        allow(['version', 'width']);
        assert(!diagramLine, 'Only one diagram declaration is allowed.');
        diagramLine = line;
        m.title = text(args[0]);
        num('version', 1, 1, 1);
        if (m.title) (m.appearance.heading ??= {}).title = m.title;
        if (attrs.has('width')) (m.appearance.heading ??= {}).width = num('width', 0, 160, 8000);
        break;
      case 'compare': {
        count(0, 2);
        allow(['direction', 'aspect']);
        once('compare');
        const direction = choice('direction', 'auto', ['auto', 'right', 'down'] as const);
        m.appearance.compare = {
          before: text(args[0]) || 'Before',
          after: text(args[1]) || 'After',
          ...(direction !== 'auto' ? { direction } : {}),
          ...(attrs.has('aspect') ? { aspect: num('aspect', 1.6, 0.25, 8) } : {}),
        };
        break;
      }
      case 'config': {
        count(0);
        allow(Object.keys(CONFIG_KEYS));
        assert(attrs.size, `config needs a setting: ${Object.keys(CONFIG_KEYS).join(', ')}.`);
        const config = (m.appearance.config ??= {});
        for (const [key, w] of attrs) {
          const earlier = configLines.get(key);
          if (earlier)
            m.warnings.push({
              code: 'config-repeated',
              message: `config ${key} is also set on line ${earlier}; this line wins.`,
              line,
            });
          configLines.set(key, line);
          if (key === 'editor') config.editor = choice('editor', 'vscode', EDITORS);
          else if (key === 'strike-removed')
            config.strikeRemoved = choice(key, 'off', ['on', 'off'] as const) === 'on';
          else {
            assert(w.quoted, `Expected ${key}="path" in double quotes.`);
            config.linkBase = w.value;
          }
        }
        break;
      }
      case 'state': {
        assert(args.length >= 1, 'A state needs an ID: state write "Write path" api orders.');
        allow(['rest']);
        const sid = id(args[0]),
          label = args[1]?.quoted ? args[1].value : undefined,
          ids = args.slice(label === undefined ? 1 : 2).map(w => id(w)),
          states = (m.appearance.states ??= []);
        let state = states.find(x => x.id === sid);
        // A long state continues on more lines with the same ID; its label comes from the first.
        if (!state) {
          state = { id: sid, label: label ?? sid, ids: [], rest: 'dim' };
          states.push(state);
        }
        if (attrs.has('rest')) state.rest = choice('rest', 'dim', ['dim', 'plain'] as const);
        for (const x of ids) {
          assert(!state.ids.includes(x), `${x} is already in state ${sid}.`);
          state.ids.push(x);
          m.stateLines.set(`${sid}:${x}`, line);
        }
        break;
      }
      case 'phase': {
        assert(
          args.length >= 3 && args[1]?.quoted,
          'A phase needs an ID, a label and its messages: phase preview "Preview" m1 m2.',
        );
        allow([]);
        const pid = id(args[0]);
        assert(!m.phases.some(p => p.id === pid), `Duplicate phase ${pid}.`);
        m.phases.push({ id: pid, label: args[1].value, ids: args.slice(2).map(w => id(w)), line });
        break;
      }
      case 'was-order':
        assert(args.length, 'was-order lists the older message order: was-order m2 m1.');
        allow([]);
        once('was-order');
        m.wasOrder = { ids: args.map(w => id(w)), line };
        break;
      case 'subtitle':
        count(1);
        allow([]);
        once('subtitle');
        assert(text(args[0]).trim(), 'A subtitle needs its text in quotes.');
        (m.appearance.heading ??= {}).subtitle = text(args[0]);
        break;
      case 'node':
      case 'group': {
        count(2);
        allow(
          command === 'node'
            ? [
                'in',
                'color',
                'shade',
                'shape',
                'was',
                'was-shape',
                'was-count',
                'href',
                'count',
                'span',
              ]
            : ['in', 'color', 'shade', 'was', 'href', 'frame', 'fold'],
        );
        const oid = id(args[0]);
        assert(oid !== 'root', 'root is reserved for the outer layout scope.');
        assert(!objectIds.has(oid), `Duplicate node/group id ${oid}.`);
        objectIds.add(oid);
        const color = attrs.get('color')?.value ?? 'auto';
        assert(
          !attrs.get('color')?.quoted && FAMILY.test(color),
          `Expected color=auto, a built-in color (${BUILT_IN_FAMILIES.join(', ')}) or a theme-color name; got ${color}.`,
        );
        const shade = attrs.has('shade') ? shadeOf(attrs.get('shade')!) : undefined;
        m.objects.push({
          id: oid,
          type: command,
          label: text(args[1]),
          parent: attrs.has('in') ? id(attrs.get('in')) : 'root',
          color,
          ...(shade !== undefined ? { shade } : {}),
          shape: command === 'node' ? choice('shape', 'box', DSL_SHAPES) : 'box',
          ...(s.mark ? { status } : {}),
          ...was(),
          ...(attrs.has('href') ? { href: text(attrs.get('href')) } : {}),
          ...(attrs.has('count') ? { count: countOf('count', 2) } : {}),
          ...(command === 'group' && choice('fold', 'auto', ['auto', 'never']) === 'never'
            ? { fold: 'never' as const }
            : {}),
          ...(command === 'group' && choice('frame', 'box', FRAMES) !== 'box'
            ? { frame: choice('frame', 'box', FRAMES) as 'soft' | 'none' }
            : {}),
          ...(attrs.has('span')
            ? {
                span:
                  attrs.get('span')!.value === 'var' ? ('var' as const) : num('span', 1, 1, 4096),
              }
            : {}),
          line,
        });
        break;
      }
      case 'edge': {
        count(4, 5);
        allow(['kind', 'from', 'to', 'was', 'constraint', 'directed', 'head', 'tail']);
        assert(
          args[2]?.value === '->' && !args[2].quoted,
          'Edges use: edge id source -> target "label".',
        );
        const eid = id(args[0]);
        assert(!edgeIds.has(eid), `Duplicate edge id ${eid}.`);
        edgeIds.add(eid);
        const undirected = choice('directed', 'true', ['true', 'false']) === 'false',
          head = choice('head', 'arrow', MARKERS),
          tail = choice('tail', 'none', MARKERS);
        assert(
          !undirected || !(attrs.has('head') || attrs.has('tail')),
          `Edge ${eid} has directed=false, so it has no ends to mark. Remove head= and tail=, or remove directed=false.`,
        );
        m.edges.push({
          id: eid,
          source: id(args[1]),
          target: id(args[3]),
          label: text(args[4]),
          dashed: choice('kind', 'sync', ['sync', 'async']) === 'async',
          from: choice('from', 'auto', SIDES),
          to: choice('to', 'auto', SIDES),
          ...(undirected ? { directed: false as const } : {}),
          ...(head !== 'arrow' ? { head } : {}),
          ...(tail !== 'none' ? { tail } : {}),
          ...(choice('constraint', 'true', ['true', 'false']) === 'false'
            ? { constraint: false as const }
            : {}),
          ...(s.mark ? { status } : {}),
          ...was(),
          line,
        });
        break;
      }
      case 'layout': {
        const scope = id(args[0]);
        // A layout line only moves things, so a mistake in one is a warning, not a failure:
        // a repeated scope keeps the later line, and an attribute it does not take is ignored.
        const named = attrs.get('engine')?.value as LayoutAlgorithmId | undefined;
        const earlier = m.layouts.findIndex(l => l.scope === scope);
        if (earlier >= 0) {
          m.warnings.push({
            code: 'layout-repeated',
            message: `layout ${scope} is also set on line ${m.layouts[earlier].line}; this line wins.`,
            line,
          });
          m.layouts.splice(earlier, 1);
        }
        const allow = (allowed: string[]) => {
          for (const key of [...attrs.keys()])
            if (!allowed.includes(key)) {
              m.warnings.push({
                code: 'layout-attribute',
                message: `This layout line does not take ${key}=, so it is ignored. ${layoutHint(key, named !== undefined)}`,
                line,
              });
              attrs.delete(key);
            }
        };
        const common = [
          'direction',
          'min-width',
          'min-height',
          ...(scope === 'root' ? ['fit'] : []),
        ];
        let engine: EngineRecipe | undefined;
        if (named !== undefined) {
          count(1);
          assert(
            ENGINES.includes(named),
            `Unknown layout engine ${named}; use ${ENGINES.join(', ')}.`,
          );
          allow(['engine', ...common, ...Object.keys(ENGINE_PARAMS)]);
          engine = { algorithm: named, params: readParams(ENGINE_PARAMS) };
        } else {
          count(2);
          const recipe = args[1]?.value;
          allow(
            recipe === 'cells'
              ? ['columns', 'unit', 'unit-width', 'ruler', ...common]
              : ['gap', ...(recipe === 'flow' ? ['fold'] : []), ...common],
          );
        }
        const algorithm = (named ? 'flow' : args[1]?.value) as Algorithm;
        assert(
          ['flow', 'row', 'column', 'lanes', 'sequence', 'cells'].includes(algorithm),
          `The ${algorithm} recipe is not supported; use flow, row, column, lanes, sequence or cells, or engine=.`,
        );
        assert(
          !['lanes', 'sequence'].includes(algorithm) || scope === 'root',
          `${algorithm} arranges the whole diagram: write layout root ${algorithm}.`,
        );
        assert(
          algorithm !== 'cells' || scope !== 'root',
          'Cells lay out a group; give the cells a group and use layout <group> cells.',
        );
        m.layouts.push({
          scope,
          algorithm,
          ...(engine ? { engine } : {}),
          direction: choice('direction', 'auto', ['auto', 'right', 'down'] as const),
          fold: named ? 'auto' : choice('fold', 'auto', ['auto', 'never'] as const),
          ...(attrs.has('fit') ? { fit: choice('fit', 'slide', Object.keys(FITS) as Fit[]) } : {}),
          ...(attrs.has('columns') ? { columns: num('columns', 1, 1, 512) } : {}),
          ...(attrs.has('unit')
            ? {
                unit: choice('unit', 'byte', ['bit', 'byte'] as const),
                ruler: choice('ruler', 'on', ['on', 'off'] as const) === 'on',
                ...(attrs.has('unit-width') ? { unitWidth: num('unit-width', 24, 8, 200) } : {}),
              }
            : {}),
          gap: num('gap', 28, 8, 300),
          minWidth: num('min-width', 0, 0, 10_000),
          minHeight: num('min-height', 0, 0, 10_000),
          line,
        });
        break;
      }
      case 'theme': {
        count(1);
        allow(Object.keys(THEME_ATTRS));
        once('theme');
        const name = args[0].value as ThemeId;
        assert(THEME_IDS.includes(name), `Unknown theme ${name}; use ${THEME_IDS.join(', ')}.`);
        m.appearance.theme = name;
        m.themeLine = line;
        const o = m.appearance.overrides;
        for (const [attr, key] of Object.entries(THEME_ATTRS)) {
          if (!attrs.has(attr)) continue;
          if (key === 'paddingX' || key === 'paddingY' || key === 'radius')
            o[key] = num(attr, 0, OVERRIDE_LIMITS[key].min, OVERRIDE_LIMITS[key].max);
          else if (key === 'titleFont' || key === 'annotationFont')
            o[key] = choice<FontRole>(attr, 'sans', FONT_ROLES);
          else o[key] = hex(attr);
        }
        break;
      }
      case 'theme-color': {
        count(1);
        allow(['shade', 'fill', 'stroke', 'ink']);
        const family = args[0].value;
        assert(
          !args[0].quoted && FAMILY.test(family) && family !== 'auto',
          'Expected a color family name (letters, digits, _ or -).',
        );
        const shade = attrs.has('shade') ? shadeOf(attrs.get('shade')!) : 500;
        once(`theme-color:${family}:${shade}`);
        const def = { family, shade } as DiagramAppearance['colors'][number];
        for (const key of ['fill', 'stroke', 'ink'] as const)
          if (attrs.has(key)) def[key] = hex(key);
        assert(
          isBuiltInFamily(family) || (def.fill && def.stroke && def.ink),
          `${family} is not a built-in color, so shade ${shade} needs fill, stroke and ink.`,
        );
        assert(def.fill || def.stroke || def.ink, 'Set at least one of fill, stroke and ink.');
        m.appearance.colors.push(def);
        m.colorLines.set(`${family}:${shade}`, line);
        break;
      }
      case 'legend': {
        if (args[0]?.value === 'line' && !args[0].quoted) {
          // `legend line dashed "meaning"`: a short connection in that style, then its meaning.
          count(3);
          allow([]);
          const style = args[1].value as LegendLine;
          assert(
            !args[1].quoted && LEGEND_LINES.includes(style),
            `Expected legend line ${LEGEND_LINES.join('|')} "meaning".`,
          );
          once(`legend:line:${style}`);
          assert(text(args[2]).trim(), 'A legend entry needs its meaning in quotes.');
          (m.appearance.legend ??= []).push({ line: style, label: text(args[2]) });
          m.legendLines.push(line);
          break;
        }
        count(2);
        allow(['shade']);
        const family = args[0].value;
        assert(
          !args[0].quoted && FAMILY.test(family) && family !== 'auto',
          `Expected legend family "meaning", with a built-in color (${BUILT_IN_FAMILIES.join(', ')}) or a theme-color name.`,
        );
        once(`legend:${family}:${attrs.get('shade')?.value ?? ''}`);
        const shade = attrs.has('shade') ? shadeOf(attrs.get('shade')!) : undefined;
        assert(text(args[1]).trim(), 'A legend entry needs its meaning in quotes.');
        (m.appearance.legend ??= []).push({
          family,
          label: text(args[1]),
          ...(shade !== undefined ? { shade } : {}),
        });
        m.legendLines.push(line);
        break;
      }
      case 'note': {
        count(1);
        allow(['near', 'side', 'width']);
        assert(args[0].quoted && args[0].value.trim(), 'A note needs its text in quotes.');
        assert(attrs.has('near') || !attrs.has('side'), 'side= places a note beside near=<id>.');
        (m.appearance.notes ??= []).push({
          text: args[0].value,
          ...(attrs.has('near') ? { near: id(attrs.get('near')) } : {}),
          ...(attrs.has('side') ? { side: choice('side', 'below', NOTE_SIDES) } : {}),
          ...(attrs.has('width') ? { width: num('width', NOTE_WIDTH, 80, 1200) } : {}),
        });
        m.noteLines.push(line);
        break;
      }
      case 'footnote': {
        // `footnote "text"`, or `footnote 1 "text"` with a marker that labels point at as [1].
        count(1, 2);
        allow([]);
        const body = args[args.length - 1],
          mark = args.length === 2 ? args[0] : undefined;
        assert(body.quoted && body.value.trim(), 'A footnote needs its text in quotes.');
        assert(
          !mark || (!mark.quoted && /^[A-Za-z0-9*]{1,3}$/.test(mark.value)),
          'A footnote marker is a short word: footnote 1 "text".',
        );
        if (mark) once(`footnote:${mark.value}`);
        (m.appearance.footnotes ??= []).push({
          text: body.value,
          ...(mark ? { mark: mark.value } : {}),
        });
        m.footnoteLines.push(line);
        break;
      }
      case 'routing':
        count(0);
        allow(Object.keys(ROUTING_PARAMS));
        once('routing');
        m.routing = readParams(ROUTING_PARAMS);
        break;
      case 'order':
        count(2, 300);
        allow([]);
        m.hints.push({ type: 'order', scope: id(args[0]), ids: args.slice(1).map(id), line });
        once('order:' + args[0].value);
        break;
      case 'align': {
        count(3, 300);
        allow(['strength']);
        const axis = args[0]?.value;
        assert(axis === 'x' || axis === 'y', 'Expected align x or align y.');
        const ids = args.slice(1).map(id);
        once(`align:${axis}:${ids.join(',')}`);
        m.hints.push({
          type: 'align',
          axis: axis as 'x' | 'y',
          ids,
          strength: choice('strength', 'prefer', ['prefer', 'required'] as const),
          line,
        });
        break;
      }
      case 'near':
      case 'nudge':
      case 'stay':
      case 'pin':
      case 'size': {
        count(command === 'near' ? 2 : 1);
        const hid = id(args[0]);
        once(`${command}:${hid}`);
        if (command === 'near') {
          allow(['side', 'gap', 'offset', 'strength']);
          const ref = id(args[1]);
          assert(ref !== hid, 'An object cannot be placed relative to itself.');
          m.hints.push({
            type: 'near',
            id: hid,
            ref,
            side: choice('side', 'right', ['right', 'left', 'above', 'below'] as const),
            gap: num('gap', 28, 0, 2000),
            offset: num('offset', 0),
            strength: choice('strength', 'prefer', ['prefer', 'required'] as const),
            line,
          });
        } else if (command === 'nudge') {
          allow(['dx', 'dy']);
          m.hints.push({ type: 'nudge', id: hid, dx: num('dx', 0), dy: num('dy', 0), line });
        } else if (command === 'stay') {
          allow(['x', 'y', 'weight']);
          m.hints.push({
            type: 'stay',
            id: hid,
            // The root has no frame, so an arrangement can place objects left of or above 0,0.
            x: num('x', 0),
            y: num('y', 0),
            weight: num('weight', 8, 1, 100),
            line,
          });
        } else if (command === 'pin') {
          allow(['x', 'y']);
          m.hints.push({ type: 'pin', id: hid, x: num('x', 0, 0), y: num('y', 0, 0), line });
        } else {
          allow(['width', 'height', 'min-height']);
          const auto = attrs.get('height')?.value === 'auto';
          assert(
            auto || !attrs.has('min-height'),
            'min-height is a floor under height=auto. Write height=auto, or remove min-height.',
          );
          m.hints.push({
            type: 'size',
            id: hid,
            width: num('width', 164, 40, 1200),
            ...(auto ? {} : { height: num('height', 56, 24, 1200) }),
            ...(attrs.has('min-height') ? { minHeight: num('min-height', 24, 24, 1200) } : {}),
            line,
          });
        }
        break;
      }
      case 'view':
      case 'snapshot':
      case 'box':
        fail(`${command} statements are not supported yet. Remove them to open this file.`);
        break;
      default:
        fail(`Unknown statement ${command}.`);
    }
  }

  if (m.objects.length > 500) throw new DslError('Limit: 500 nodes and groups.');
  if (m.edges.length > 1200) throw new DslError('Limit: 1,200 edges.');
  validateReferences(m);
  return m;
}

/**
 * The container that lays an object out: its parent, or the nearest framed container above it
 * when its parent is a soft or frameless group. Soft groups are never layout scopes.
 */
export function layoutParent(by: Map<string, ModelObject>, id: string): string {
  let p = by.get(id)?.parent ?? 'root';
  while (p !== 'root' && by.get(p)?.frame) p = by.get(p)!.parent;
  return p;
}

function validateReferences(m: Model) {
  const by = new Map(m.objects.map(o => [o.id, o]));
  const framed = (id: string, line: number, what: string) =>
    assert(
      !by.get(id)?.frame,
      `${id} is a ${by.get(id)?.frame} group, so it has no ${what} of its own. Use frame=box, or ${what === 'layout' ? 'set the layout of the container around it' : 'place its members'}.`,
      line,
    );
  const parentOf = (id: string) => layoutParent(by, id);
  const assert = (ok: unknown, message: string, line: number) => {
    if (!ok) throw new DslError(message, line);
  };
  const exists = (id: string, line: number) =>
    assert(by.has(id), `Unknown node/group ${id}.`, line);
  const scope = (id: string, line: number) =>
    assert(id === 'root' || by.get(id)?.type === 'group', `Unknown container ${id}.`, line);
  const defined = new Map<string, Set<number>>();
  for (const c of m.appearance.colors) {
    if (!defined.has(c.family)) defined.set(c.family, new Set());
    defined.get(c.family)!.add(c.shade);
  }
  (m.appearance.legend ?? []).forEach((e, i) => {
    if (!e.family || isBuiltInFamily(e.family)) return;
    const shades = defined.get(e.family),
      shade = e.shade ?? NODE_SHADE;
    assert(
      shades?.has(shade),
      shades
        ? `${e.family} has no shade ${shade}; it defines ${[...shades].sort((a, b) => a - b).join(', ')}.`
        : `Unknown color ${e.family}. Define it with theme-color ${e.family} shade=… fill= stroke= ink=.`,
      m.legendLines[i],
    );
  });
  for (const o of m.objects) {
    if (o.color !== 'auto' && !isBuiltInFamily(o.color)) {
      const shades = defined.get(o.color),
        shade = o.shade ?? (o.type === 'group' ? groupShadeFor(m.appearance.theme) : NODE_SHADE);
      assert(
        shades,
        `Unknown color ${o.color}. Define it with theme-color ${o.color} shade=… fill= stroke= ink=.`,
        o.line,
      );
      assert(
        shades!.has(shade),
        `${o.color} has no shade ${shade}${o.shade === undefined ? ' (the default)' : ''}; it defines ${[...shades!].sort((a, b) => a - b).join(', ')}.`,
        o.line,
      );
    }
    scope(o.parent, o.line);
    const seen = new Set<string>();
    for (let x: ModelObject | undefined = o; x; x = by.get(x.parent)) {
      assert(!seen.has(x.id), `Containment cycle at ${x.id}.`, o.line);
      seen.add(x.id);
      assert(seen.size <= 12, 'Limit: 12 nesting levels.', o.line);
    }
  }
  // Lanes: every top-level object is a boxed group, so every node sits in a lane.
  if (m.layouts.some(l => l.scope === 'root' && l.algorithm === 'lanes'))
    for (const o of m.objects) {
      if (o.parent !== 'root') continue;
      assert(
        o.type === 'group',
        `In a lanes diagram every node sits in a lane; put ${o.id} in= one of the top-level groups.`,
        o.line,
      );
      assert(!o.frame, `${o.id} is a lane, so it needs its frame; remove frame=.`, o.line);
    }
  // Sequence: participants and messages only.
  const sequence = m.layouts.some(l => l.scope === 'root' && l.algorithm === 'sequence');
  if (sequence)
    // Groups gather participants into column bands; they hold nodes and sit at the top level.
    for (const o of m.objects) {
      assert(
        o.type === 'node' ? by.get(o.parent)?.type !== 'node' : o.parent === 'root' && !o.frame,
        `In a sequence diagram a group is a band of participants: put ${o.id} at the top level and its participants in=${o.id}.`,
        o.line,
      );
      assert(
        o.type === 'node' || m.objects.some(x => x.parent === o.id),
        `Group ${o.id} has no participants, so it has no band to draw. Put a participant in=${o.id} or remove the group.`,
        o.line,
      );
    }
  const messageIds = new Set(m.edges.map(e => e.id)),
    phased = new Set<string>();
  for (const p of m.phases) {
    assert(
      sequence,
      'A phase groups messages in a sequence diagram; use layout root sequence.',
      p.line,
    );
    for (const x of p.ids) {
      assert(
        messageIds.has(x),
        `Unknown message ${x} in phase ${p.id}; a phase lists edge IDs.`,
        p.line,
      );
      assert(!phased.has(x), `${x} is already in another phase.`, p.line);
      phased.add(x);
    }
    // A phase's band runs from its first message to its last, so it covers all those between.
    const at = m.edges.flatMap((e, i) => (p.ids.includes(e.id) ? [i] : [])),
      skipped = m.edges
        .slice(at[0], at[at.length - 1] + 1)
        // A `-` message is only the older version's, so it breaks no run of the newer one.
        .filter(e => !p.ids.includes(e.id) && e.status !== 'removed')
        .map(e => e.id);
    assert(
      !skipped.length,
      `Phase ${p.id} skips ${skipped.join(', ')}: a phase is a run of consecutive messages. Include it or split the phase.`,
      p.line,
    );
  }
  if (m.wasOrder) {
    const { ids, line } = m.wasOrder,
      edge = (id: string) => m.edges.find(e => e.id === id),
      warn = (message: string) => m.warnings.push({ code: 'was-order', message, line });
    assert(
      m.layouts.some(l => l.scope === 'root' && l.algorithm === 'sequence'),
      'was-order gives the older order of a sequence diagram; use layout root sequence.',
      line,
    );
    assert(new Set(ids).size === ids.length, 'was-order lists a message twice.', line);
    for (const x of ids) {
      assert(edge(x)?.status !== 'added', `${x} is added, so was-order can't list it.`, line);
      if (!edge(x)) warn(`was-order lists ${x}, which is not a message. The panels skip it.`);
    }
    for (const e of m.edges)
      if (e.status !== 'added' && !ids.includes(e.id))
        warn(`was-order leaves out ${e.id}, so the older panel keeps it on its new row.`);
  }
  for (const e of m.edges)
    for (const end of [e.source, e.target]) {
      exists(end, e.line);
      // A line may end on a boxed group's frame, but not on a tint or on a group around its other end.
      const o = by.get(end)!,
        other = end === e.source ? e.target : e.source;
      assert(
        !sequence || o.type === 'node',
        `A message joins participants, and ${end} is a group. End ${e.id} on one of its participants.`,
        e.line,
      );
      assert(
        o.type === 'node' || !o.frame,
        `${end} is a ${o.frame} group, which has no frame for a line to end on. Connect to one of its members, or use frame=box.`,
        e.line,
      );
      let around = false;
      for (let p = by.get(other)?.parent; p && p !== 'root'; p = by.get(p)?.parent)
        if (p === end) around = true;
      assert(
        !around,
        `${other} is inside ${end}, so a line between them has nowhere to go.`,
        e.line,
      );
    }
  (m.appearance.notes ?? []).forEach((n, i) => {
    if (!n.near || by.has(n.near)) return;
    if (!messageIds.has(n.near)) return exists(n.near, m.noteLines[i]);
    assert(
      sequence,
      `near=${n.near} names a connection. Only a sequence diagram anchors a note to a message; use a node or group here.`,
      m.noteLines[i],
    );
  });
  const edgeIds = new Set(m.edges.map(e => e.id));
  for (const s of m.appearance.states ?? [])
    for (const x of s.ids) {
      const line = m.stateLines.get(`${s.id}:${x}`)!;
      assert(
        by.has(x) || edgeIds.has(x),
        `Unknown node, group or edge ${x} in state ${s.id}.`,
        line,
      );
    }
  const cells = new Map(m.layouts.filter(l => l.algorithm === 'cells').map(l => [l.scope, l]));
  for (const o of m.objects) {
    const grid = cells.get(o.parent);
    if (grid) {
      assert(
        o.type === 'node',
        `Cells are nodes; ${o.id} is a group inside cells ${o.parent}.`,
        o.line,
      );
      assert(
        o.shape !== 'marker' || ((grid.columns ?? 0) <= 1 && !grid.unit),
        grid.unit
          ? `A marker cuts a sequence of cells; ${o.parent} is a ${grid.unit} layout.`
          : `A marker cuts one row or column of cells; ${o.parent} has ${grid.columns} columns.`,
        o.line,
      );
      assert(
        o.span !== 'var' || !!grid.unit,
        `span=var is for a byte or bit layout; give ${o.parent} unit=byte or unit=bit.`,
        o.line,
      );
    } else {
      assert(
        o.shape !== 'marker',
        `A marker sits between cells; put ${o.id} in a group with layout cells.`,
        o.line,
      );
      assert(o.span === undefined, `span= is for cells; ${o.parent} has no layout cells.`, o.line);
    }
  }
  for (const l of m.layouts) {
    scope(l.scope, l.line);
    framed(l.scope, l.line, 'layout');
    const root = l.engine?.params.rootId;
    if (root) {
      exists(root, l.line);
      assert(by.get(root)!.type === 'node', `The tree root ${root} must be a node.`, l.line);
    }
  }
  for (const h of m.hints) {
    if (h.type === 'order') {
      scope(h.scope, h.line);
      framed(h.scope, h.line, 'layout');
      for (const id of h.ids) {
        exists(id, h.line);
        framed(id, h.line, 'position');
        assert(parentOf(id) === h.scope, `${id} is not a direct child of ${h.scope}.`, h.line);
      }
    } else if (h.type === 'align') {
      h.ids.forEach(id => exists(id, h.line));
      h.ids.forEach(id => framed(id, h.line, 'position'));
      assert(new Set(h.ids).size === h.ids.length, 'Duplicate member in align.', h.line);
      const parent = parentOf(h.ids[0]);
      assert(
        h.ids.every(id => parentOf(id) === parent),
        'Members of align must be direct siblings.',
        h.line,
      );
    } else {
      exists(h.id, h.line);
      framed(h.id, h.line, 'position');
      if (h.type === 'near') {
        exists(h.ref, h.line);
        framed(h.ref, h.line, 'position');
        // The reference may sit inside a sibling group: compile places against that group,
        // lined up with the reference.
        assert(
          nearAnchor(by, h.id, h.ref) !== undefined,
          `Relative placement is between siblings, or with something inside a sibling group. ${h.id} is inside ${parentOf(h.id)}; place ${parentOf(h.id)} relative to ${h.ref} instead.`,
          h.line,
        );
      }
      if (h.type === 'size')
        assert(
          by.get(h.id)!.type === 'node',
          'Use layout min-width/min-height to reserve room in a group.',
          h.line,
        );
    }
  }
}
