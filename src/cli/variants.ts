/**
 * Layout variants for `draftably vary`: alternative `layout` and `routing` lines for a file,
 * each compiled, routed and measured as the CLI draws it, then ranked against the file as it is.
 *
 * A variant is a list of line edits, so applying one changes only the lines it names and keeps
 * comments, IDs and refinements. Everything here is deterministic: the same source gives the same
 * variants, in the same order, with the same numbers.
 */
import { computeRoutes, type DrawnRoute } from '../model/routes';
import type { VisibleGraph } from '../model/graph';
import type { Diagram, Rect } from '../model/types';
import { compile, type Diagnostic, type Scene } from '../dsl/compile';
import { findConflicts, sceneConflicts } from '../dsl/conflicts';
import { projectScene, visibleRects } from '../dsl/project';
import { declaration, layoutStatement, statements } from '../dsl/source-edits';
import { ExplorerLab } from '../engines/explorer-engine.js';
import { LayoutLab } from '../engines/layout-engine.js';
import {
  bare,
  ENGINE_PARAMS,
  ENGINES,
  printStatement,
  readSource,
  ROUTING_PARAMS,
  type Statement,
  type Word,
} from '../dsl/syntax';
import { renderSvg } from './svg';

/** One change to the source: attributes to set (a value) or remove (null) on one statement. */
export type Edit =
  | { kind: 'layout'; scope: string; attrs: Record<string, string | null> }
  | { kind: 'routing'; attrs: Record<string, string | null> }
  | { kind: 'compare'; attrs: Record<string, string | null> }
  /** Attributes on a group's declaration, such as `frame=soft`. */
  | { kind: 'group'; id: string; attrs: Record<string, string | null> }
  /** Remove a line, such as a refinement that `check` blames for a conflict. */
  | { kind: 'drop'; line: number };

/** A changed line: its number in the original file (0 for an added line), before and after. */
export interface LineChange {
  line: number;
  before?: string;
  after?: string;
}

export interface Metrics {
  width: number;
  height: number;
  crossings: number;
  bends: number;
  length: number;
  /** Warnings `check` would print: layout diagnostics and drawing conflicts. */
  warnings: number;
  /** Mean distance, in px, each box moved from where the current file draws it. */
  moved: number;
}

export interface Variant {
  id: string;
  /** Short name, such as `layered down`. */
  title: string;
  /** Why it was tried, from the diagram's shape. */
  why: string;
  edits: Edit[];
  lines: LineChange[];
  metrics?: Metrics;
  /** Set when the variant does not compile; it is listed but never ranked first. */
  error?: string;
  tags: string[];
}

export interface Measured {
  variant: Variant;
  source: string;
  svg: string;
}

export type Prefer = 'fewer-crossings' | 'compact' | 'stable';

/** `--fit` targets: the width-to-height ratio the whole image should come close to. */
export { FITS, type Fit } from '../dsl/syntax';
import { FITS, type Fit } from '../dsl/syntax';

/** What "best" means for a run: the preference, and the target aspect when `--fit` is given. */
export interface Goal {
  prefer: Prefer;
  fit?: Fit;
}

/** How far an image's shape is from the target, on a log scale: 0 is a perfect fit. */
export const fitError = (m: Pick<Metrics, 'width' | 'height'>, fit: Fit) =>
  Math.abs(Math.log(m.width / m.height / FITS[fit]));

// --- Edits -------------------------------------------------------------------------------------

/** Settings a built-in recipe keeps when an engine replaces it. */
const KEPT = ['direction', 'fold', 'min-width', 'min-height'];

function merged(s: Statement, attrs: Record<string, string | null>): Statement {
  const next: Statement = { ...s, args: [...s.args], attrs: [...s.attrs] };
  // An engine replaces a built-in recipe (`layout root flow gap=48`): drop the recipe and its gap.
  if ('engine' in attrs && s.command === 'layout' && s.args.length > 1) {
    next.args = next.args.slice(0, 1);
    next.attrs = next.attrs.filter(([k]) => KEPT.includes(k));
  }
  for (const [key, value] of Object.entries(attrs)) {
    const i = next.attrs.findIndex(([k]) => k === key);
    if (value === null) {
      if (i >= 0) next.attrs.splice(i, 1);
    } else if (i >= 0) next.attrs[i] = [key, bare(value)];
    else if (key === 'engine') next.attrs.unshift([key, bare(value)]);
    else next.attrs.push([key, bare(value)]);
  }
  return next;
}

const fresh = (command: string, args: Word[], attrs: Record<string, string | null>): Statement => ({
  kind: 'statement',
  command,
  args,
  attrs: Object.entries(attrs).flatMap(([k, v]) =>
    v === null ? [] : [[k, bare(v)] as [string, Word]],
  ),
  line: 0,
});

/**
 * Apply edits to `source` line by line. Untouched lines keep their exact text, so the result
 * differs from the file only where an edit names a statement. New statements go after the last
 * `layout` line, or at the end of the file.
 */
export function applyEdits(source: string, edits: Edit[]) {
  const doc = readSource(source),
    texts: Array<string | null> = source.split(/\r?\n/),
    added: string[] = [],
    changes: LineChange[] = [];
  const replace = (s: Statement, next: Statement) => {
    const after = printStatement(next);
    if (after === texts[s.line - 1]) return;
    changes.push({ line: s.line, before: texts[s.line - 1]!, after });
    texts[s.line - 1] = after;
  };
  for (const edit of edits) {
    if (edit.kind === 'drop') {
      const text = texts[edit.line - 1];
      if (text === undefined || text === null) continue;
      changes.push({ line: edit.line, before: text });
      texts[edit.line - 1] = null;
      continue;
    }
    const existing =
      edit.kind === 'layout'
        ? layoutStatement(doc, edit.scope)
        : edit.kind === 'group'
          ? declaration(doc, edit.id)
          : statements(doc).find(s => s.command === edit.kind);
    if (existing) replace(existing, merged(existing, edit.attrs));
    // A missing group has nothing to change; layout, routing and compare lines are added.
    else if (edit.kind !== 'group') {
      const next =
        edit.kind === 'layout'
          ? // Without an engine a layout line needs a recipe; `flow` is the one with a direction.
            fresh(
              'layout',
              edit.attrs.engine ? [bare(edit.scope)] : [bare(edit.scope), bare('flow')],
              edit.attrs,
            )
          : fresh(edit.kind, [], edit.attrs);
      if (next.attrs.length) added.push(printStatement(next));
    }
  }
  if (added.length) {
    const layouts = statements(doc).filter(s => s.command === 'layout' || s.command === 'routing');
    const at = layouts.length ? layouts.at(-1)!.line : texts.length;
    // Without layout lines, keep a blank line between the declarations and the new ones.
    const block = layouts.length ? added : ['', ...added];
    if (!layouts.length && texts.at(-1) === '') texts.splice(texts.length - 1, 0, ...block);
    else texts.splice(at, 0, ...block);
    for (const after of added) changes.push({ line: 0, after });
  }
  return { source: texts.filter(t => t !== null).join('\n'), changes };
}

// --- Shape -------------------------------------------------------------------------------------

/** What the diagram looks like, for choosing variants worth trying. */
export interface Shape {
  nodes: number;
  /** Framed groups: the ones that arrange their own members. */
  groups: number;
  /** Rank count along the longest chain of connections, ignoring returns. */
  ranks: number;
  /** Every node has at most one incoming connection and there is one start. */
  tree: boolean;
  /** Mean edge label length, in characters. */
  labels: number;
  /** The scope the variants arrange: `root`, or a group given with `--scope`. */
  scope: string;
  /** The scope's recipe, when it is one an engine cannot replace (lanes, sequence, cells). */
  fixed?: string;
  /** The scope's current engine, or its recipe name. */
  layout: string;
  /** The scope's engine, when it has one rather than a built-in recipe. */
  engine?: string;
  direction: 'auto' | 'right' | 'down';
}

/** Ids inside `scope`'s subtree, or every object for `root`. */
function within(scene: Scene, scope: string) {
  const inside = (id: string): boolean => {
    for (let p = scene.byId.get(id)?.parent; p; p = scene.byId.get(p)?.parent) {
      if (p === scope) return true;
      if (p === 'root') return false;
    }
    return false;
  };
  return new Set(scene.model.objects.filter(o => scope === 'root' || inside(o.id)).map(o => o.id));
}

/**
 * Longest chain of connections starting at each node, by depth-first search; an edge back into
 * the current path is a return and is not followed.
 */
function depths(edges: Array<{ source: string; target: string }>) {
  const out = new Map<string, string[]>();
  for (const e of edges) out.set(e.source, [...(out.get(e.source) ?? []), e.target]);
  const depth = new Map<string, number>(),
    open = new Set<string>();
  let cyclic = false;
  const visit = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    open.add(id);
    let best = 1;
    for (const next of out.get(id) ?? []) {
      if (open.has(next)) {
        cyclic = true;
        continue;
      }
      best = Math.max(best, 1 + visit(next));
    }
    open.delete(id);
    depth.set(id, best);
    return best;
  };
  for (const e of edges) visit(e.source);
  return { depth, cyclic };
}

/** The shape of `scope`'s subtree: the whole diagram for `root`. */
export function shapeOf(scene: Scene, scope = 'root'): Shape {
  const m = scene.model,
    members = within(scene, scope),
    nodes = m.objects.filter(o => o.type === 'node' && members.has(o.id)),
    ids = new Set(nodes.map(n => n.id)),
    edges = m.edges.filter(e => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
  const incoming = new Map<string, number>();
  for (const e of edges) incoming.set(e.target, (incoming.get(e.target) ?? 0) + 1);
  const { depth, cyclic } = depths(edges);
  const ranks = Math.max(0, ...nodes.map(n => depth.get(n.id) ?? 1));
  const starts = nodes.filter(n => !incoming.get(n.id)).length;
  const root = m.layouts.find(l => l.scope === scope);
  const labelled = edges.filter(e => e.label);
  return {
    nodes: nodes.length,
    groups: m.objects.filter(o => o.type === 'group' && !o.frame && members.has(o.id)).length,
    ranks,
    tree: !cyclic && starts === 1 && nodes.every(n => (incoming.get(n.id) ?? 0) <= 1),
    labels: labelled.length
      ? labelled.reduce((sum, e) => sum + e.label.length, 0) / labelled.length
      : 0,
    scope,
    ...(root && ['lanes', 'sequence', 'cells'].includes(root.algorithm) && !root.engine
      ? { fixed: root.algorithm }
      : {}),
    layout: root?.engine?.algorithm ?? root?.algorithm ?? (scope === 'root' ? 'flow' : 'column'),
    ...(root?.engine ? { engine: root.engine.algorithm } : {}),
    direction: root?.direction ?? 'auto',
  };
}

// --- Candidates --------------------------------------------------------------------------------

/** The engine a scope's sweeps use when they don't name one. */
const defaultEngine = (shape: Shape) =>
  shape.engine ?? (shape.groups ? 'compound-flow' : 'layered');

/** Name a variant by the settings it sets. */
export const titleOf = (edits: Edit[]) =>
  edits
    .map(e =>
      e.kind === 'drop'
        ? `no line ${e.line}`
        : (e.kind === 'group' ? `${e.id} ` : e.kind === 'compare' ? 'compare ' : '') +
          Object.entries(e.attrs)
            .map(([k, v]) =>
              v === null ? `no ${k}` : k === 'engine' || k === 'direction' ? v : `${k}=${v}`,
            )
            .join(' '),
    )
    .join(', ');

/**
 * Variants likely to suit this shape: an engine for its structure in both reading directions,
 * plus a few settings aimed at what the shape suggests. More are tried than shown; ranking keeps
 * the best ones that differ.
 */
export function suggestions(
  shape: Shape,
  base: Pick<Metrics, 'crossings'>,
  goal: Goal = { prefer: 'fewer-crossings' },
): Array<Pick<Variant, 'edits' | 'why'>> {
  const out: Array<Pick<Variant, 'edits' | 'why'>> = [];
  // A stricter router only helps a drawing that has crossings; routing is the whole file's.
  const router =
    base.crossings && shape.scope === 'root'
      ? [
          {
            edits: [{ kind: 'routing', attrs: { 'crossing-penalty': '900' } } as Edit],
            why: `keep the layout, route around its ${base.crossings} crossing${base.crossings > 1 ? 's' : ''} harder`,
          },
        ]
      : [];
  if (shape.fixed) {
    if (shape.scope === 'root')
      out.push(...router, {
        edits: [{ kind: 'routing', attrs: { 'edge-gap': '28' } }],
        why: `a ${shape.fixed} root keeps its layout; more room between parallel lines`,
      });
    return out;
  }
  const layout = (attrs: Record<string, string | null>): Edit => ({
    kind: 'layout',
    scope: shape.scope,
    attrs,
  });
  const engine = defaultEngine(shape),
    because = shape.groups ? `${shape.groups} group${shape.groups > 1 ? 's' : ''}` : 'no groups';
  // A wide target reads across first, a tall one down; ties keep the reading direction of rows.
  const tall = goal.fit !== undefined && FITS[goal.fit] < 1.2,
    lead = tall ? 'down' : 'right';
  for (const direction of tall ? ['down', 'right'] : ['right', 'down'])
    out.push({ edits: [layout({ engine, direction })], why: `${because}, reading ${direction}` });
  if (goal.fit) {
    // Only the spring and grid engines follow `aspect`; the ranked engines keep their bands.
    const aspect = ENGINE_PARAMS.aspect as { choices: readonly string[] },
      near = [...aspect.choices].sort(
        (a, b) =>
          Math.abs(Math.log(+a / FITS[goal.fit!])) - Math.abs(Math.log(+b / FITS[goal.fit!])),
      )[0],
      shaped = shape.groups ? 'compound-spring' : 'grid';
    out.push({
      edits: [layout({ engine: shaped, aspect: near })],
      why: `--fit ${goal.fit}: ${shaped} follows aspect ${near}`,
    });
  }
  out.push({
    edits: [layout({ engine, direction: lead, ordering: 'crossings' })],
    why: 'order each rank to cut crossings',
  });
  if (shape.groups)
    out.push({
      edits: [layout({ engine: 'layered', direction: 'right' })],
      why: 'ignore group packing, rank by connections',
    });
  if (shape.ranks >= 5 && shape.ranks >= shape.nodes * 0.6) {
    out.push({
      edits: [layout({ engine: 'flow', direction: 'right' })],
      why: `a chain of ${shape.ranks} steps`,
    });
    out.push({
      edits: [layout({ engine: 'flow', direction: 'right', fold: 'never' })],
      why: `a chain of ${shape.ranks} steps, kept on one line`,
    });
  }
  if (shape.tree && shape.nodes >= 4)
    out.push({
      edits: [layout({ engine: 'tree', direction: 'down' })],
      why: 'a tree with one start',
    });
  if (shape.labels > 14)
    out.push({
      edits: [layout({ engine, direction: 'right', 'rank-gap': '88' })],
      why: `long connection labels (${Math.round(shape.labels)} characters on average)`,
    });
  out.push(...router);
  return out;
}

/** One `--try` axis: a source setting and the values to try. */
export interface Axis {
  key: string;
  values: string[];
}

const DIRECTIONS = ['right', 'down'];

/** The shared step values for a setting: the same ones the viewer's Compare sweeps. */
function steps(key: string): string[] | undefined {
  if (key === 'engine') return [...ENGINES];
  if (key === 'direction') return DIRECTIONS;
  const engine = ENGINE_PARAMS[key],
    route = ROUTING_PARAMS[key];
  const def = engine
    ? ExplorerLab.layoutParams[engine.key]
    : route && ExplorerLab.routeParams[route.key];
  if (def) return def.values.map(String);
  const p = engine ?? route;
  if (p && 'choices' in p && p.choices.length) return [...p.choices];
  return undefined;
}

/**
 * Read `--try key=a,b`, or `--try key` for the shared steps. Keys are source attribute names:
 * `engine`, `direction`, a `layout` engine setting or a `routing` setting.
 */
export function parseTry(text: string): Axis {
  const [key, list] = text.split('=', 2);
  const engine = ENGINE_PARAMS[key],
    route = ROUTING_PARAMS[key];
  if (key !== 'engine' && key !== 'direction' && (!engine || key === 'root') && !route)
    throw Error(
      `--try ${key}: not a setting. Use engine, direction, ${Object.keys(ENGINE_PARAMS)
        .filter(k => k !== 'root')
        .join(', ')}, or a routing setting (${Object.keys(ROUTING_PARAMS).join(', ')}).`,
    );
  const values =
    list === undefined
      ? steps(key)
      : list
          .split(',')
          .map(v => v.trim())
          .filter(Boolean);
  if (!values?.length) throw Error(`--try ${key} needs values: --try ${key}=a,b.`);
  const p = engine ?? route;
  for (const v of values) {
    const ok =
      key === 'engine'
        ? ENGINES.includes(v as never)
        : key === 'direction'
          ? [...DIRECTIONS, 'auto'].includes(v)
          : 'choices' in p!
            ? p.choices.includes(v)
            : Number.isFinite(Number(v)) && +v >= p!.min && +v <= p!.max;
    if (!ok)
      throw Error(
        `--try ${key}=${v}: ${
          key === 'engine'
            ? `use ${ENGINES.join(', ')}`
            : key === 'direction'
              ? 'use right, down or auto'
              : 'choices' in p!
                ? `use ${p.choices.join(', ')}`
                : `use ${p!.min} to ${p!.max}`
        }.`,
      );
  }
  return { key, values: [...new Set(values)] };
}

/**
 * Every combination of one or two axes, in order: the first axis varies fastest. A layout
 * setting on a scope without an engine also sets the scope's engine, since built-in recipes
 * take no engine settings.
 */
export function sweep(shape: Shape, axes: Axis[]): Array<Pick<Variant, 'edits' | 'why'>> {
  if (axes.length > 2) throw Error('Use at most two --try axes.');
  if (axes.length === 2 && axes[0].key === axes[1].key)
    throw Error('Use two different --try settings.');
  const count = axes.reduce((n, a) => n * a.values.length, 1);
  if (count > 12) throw Error(`That sweep has ${count} variants. Keep it to 12 or fewer.`);
  const layoutKeys = axes.filter(a => !ROUTING_PARAMS[a.key]);
  if (layoutKeys.length && shape.fixed && shape.fixed !== 'lanes')
    throw Error(`The ${shape.scope} scope uses ${shape.fixed}; only routing settings vary there.`);
  const needsEngine =
    layoutKeys.some(a => a.key !== 'direction') &&
    !layoutKeys.some(a => a.key === 'engine') &&
    !shape.engine;
  const [a, b] = axes;
  const out: Array<Pick<Variant, 'edits' | 'why'>> = [];
  for (const bv of b ? b.values : [undefined])
    for (const av of a.values) {
      const set: Array<[string, string]> = [
        [a.key, av],
        ...(b ? [[b.key, bv!] as [string, string]] : []),
      ];
      const layoutAttrs: Record<string, string> = needsEngine
          ? { engine: defaultEngine(shape) }
          : {},
        routingAttrs: Record<string, string> = {};
      for (const [k, v] of set) (ROUTING_PARAMS[k] ? routingAttrs : layoutAttrs)[k] = v;
      const edits: Edit[] = [
        ...(Object.keys(layoutAttrs).length
          ? [{ kind: 'layout', scope: shape.scope, attrs: layoutAttrs } as Edit]
          : []),
        ...(Object.keys(routingAttrs).length
          ? [{ kind: 'routing', attrs: routingAttrs } as Edit]
          : []),
      ];
      out.push({
        edits,
        why: `--try ${set.map(([k, v]) => `${k}=${v}`).join(' ')}${needsEngine ? ` (with engine=${defaultEngine(shape)})` : ''}`,
      });
    }
  return out;
}

/**
 * The documented broad sweep: `layered`, `compound-flow` and `flow`, plus `tree` for a tree with
 * one start, each reading right and then down. Always the same list for the same shape.
 */
export function grid(shape: Shape): Array<Pick<Variant, 'edits' | 'why'>> {
  // Lanes are one more option: the file as it is (v0) keeps them, the grid tries engines.
  if (shape.fixed && shape.fixed !== 'lanes')
    throw Error(`The ${shape.scope} scope uses ${shape.fixed}; --grid varies engines.`);
  const engines = ['layered', 'compound-flow', 'flow', ...(shape.tree ? ['tree'] : [])];
  return engines.flatMap(engine =>
    DIRECTIONS.map(direction => ({
      edits: [{ kind: 'layout', scope: shape.scope, attrs: { engine, direction } } as Edit],
      why: `--grid: ${engine} reading ${direction}`,
    })),
  );
}

type AttrEdit = Exclude<Edit, { kind: 'drop' }>;

/** The statement an edit changes, as a key: `layout:root`, `group:ns_ops`, `routing:`. */
const target = (e: AttrEdit) =>
  `${e.kind}:${e.kind === 'layout' ? e.scope : e.kind === 'group' ? e.id : ''}`;

/**
 * Variants the file itself calls for, beyond its layout lines:
 *
 * - **Conflicting refinements:** when `check` blames refinement lines for drawing conflicts,
 *   one variant drops those lines and lets layout place the objects.
 * - **Compare panels:** a file with a `compare` line gets both panel directions.
 * - **Fewer containers:** soften leaf groups and groups whose members span more than one rank,
 *   never the group that holds most of the drawing. Only groups with no `layout` or position
 *   lines of their own qualify, so applying it changes only `group` lines.
 */
export function autoVariants(scene: Scene, conflicts: Diagnostic[]) {
  const m = scene.model,
    out: Array<Pick<Variant, 'edits' | 'why'>> = [];
  const hintLines = new Set(m.hints.map(h => h.line)),
    blamed = [
      ...new Set(conflicts.flatMap(d => (d.line && hintLines.has(d.line) ? [d.line] : []))),
    ];
  if (blamed.length)
    out.push({
      edits: blamed.sort((a, b) => a - b).map(line => ({ kind: 'drop', line }) as Edit),
      why: `drop the refinement${blamed.length > 1 ? 's' : ''} on line${blamed.length > 1 ? 's' : ''} ${blamed.join(', ')} that check blames for ${conflicts.length} conflict${conflicts.length > 1 ? 's' : ''}`,
    });
  // A marked file draws one merged picture unless a `compare` line splits it into panels.
  const compare = m.appearance.compare,
    marked = [...m.objects, ...m.edges].some(o => o.status);
  if (compare || marked)
    for (const direction of ['right', 'down'])
      if (compare?.direction !== direction)
        out.push({
          edits: [{ kind: 'compare', attrs: { direction } }],
          why: `${compare ? 'compare' : 'change marks as'} panels ${direction === 'right' ? 'side by side' : 'stacked'}`,
        });
  const root = m.layouts.find(l => l.scope === 'root');
  if (root && ['lanes', 'sequence'].includes(root.algorithm)) return out;
  const groups = m.objects.filter(o => o.type === 'group'),
    nodes = m.objects.filter(o => o.type === 'node'),
    parent = new Map(m.objects.map(o => [o.id, o.parent]));
  const inside = (id: string, g: string) => {
    for (let p = parent.get(id); p && p !== 'root'; p = parent.get(p)) if (p === g) return true;
    return false;
  };
  const placed = new Set([
    ...m.layouts.map(l => l.scope),
    ...m.hints.flatMap(h => [
      ...('ids' in h ? h.ids : [h.id]),
      ...('ref' in h ? [h.ref] : []),
      ...('scope' in h ? [h.scope] : []),
    ]),
  ]);
  const { depth } = depths(m.edges.filter(e => e.source !== e.target));
  const members = (g: string) => nodes.filter(n => inside(n.id, g));
  const biggest = [...groups].sort((a, b) => members(b.id).length - members(a.id).length)[0];
  const open = groups.filter(
    g =>
      !g.frame && !placed.has(g.id) && !(g === biggest && members(g.id).length * 2 >= nodes.length),
  );
  const leaves = open.filter(g => !groups.some(o => o.parent === g.id)),
    spanning = open.filter(g => new Set(members(g.id).map(n => depth.get(n.id) ?? 1)).size > 1);
  // Leaf groups alone first: softening a group that holds boxes moves those boxes too.
  const sets = [leaves, [...new Set([...leaves, ...spanning])]].filter(
    (set, i, all) => set.length && (i === 0 || set.length !== all[0].length),
  );
  for (const set of sets)
    out.push({
      edits: set.map(g => ({ kind: 'group', id: g.id, attrs: { frame: 'soft' } }) as Edit),
      why: `fewer containers: soften ${set.length > 1 ? 'groups' : 'group'} ${set.map(g => g.id).join(', ')}`,
    });
  return out;
}

/** Merge edits: later attributes win on the same statement. */
function combine(a: Edit[], b: AttrEdit[]): Edit[] {
  const out = a.map(e => (e.kind === 'drop' ? e : { ...e, attrs: { ...e.attrs } }));
  for (const e of b) {
    const same = out.find((x): x is AttrEdit => x.kind !== 'drop' && target(x) === target(e));
    if (same) Object.assign(same.attrs, e.attrs);
    else out.push({ ...e, attrs: { ...e.attrs } });
  }
  return out;
}

/** The shared steps just above and below a setting's current value (or the engine default). */
function nextSteps(key: string, current: string | null | undefined) {
  const list = steps(key)!.map(Number),
    now = Number(
      current ?? LayoutLab.defaults[ENGINE_PARAMS[key].key as keyof typeof LayoutLab.defaults],
    );
  return [list.find(x => x > now), [...list].reverse().find(x => x < now)].flatMap(x =>
    x === undefined ? [] : [String(x)],
  );
}

/**
 * Small changes around a variant from an earlier run (`--from`): the variant itself, the other
 * direction, the other rank ordering and folding, a gap step either way, and a stricter router.
 * Each keeps the variant's own edits, so applying one still changes only those lines.
 */
export function neighbors(
  shape: Shape,
  from: { id: string; edits: Edit[] },
): Array<Pick<Variant, 'edits' | 'why'>> {
  const own = from.edits.find(e => e.kind === 'layout') as
      Extract<Edit, { kind: 'layout' }> | undefined,
    attrs = own?.attrs ?? {},
    engine = attrs.engine ?? shape.engine,
    layout = (set: Record<string, string>) =>
      combine(from.edits, [
        {
          kind: 'layout',
          scope: shape.scope,
          attrs: { ...(engine ? {} : { engine: defaultEngine(shape) }), ...set },
        },
      ]);
  // Ids are given again after this run, so name the variant this one came from plainly.
  const was = `the earlier ${from.id}`;
  const out: Array<Pick<Variant, 'edits' | 'why'>> = [
    { edits: from.edits, why: `${was} as it was` },
  ];
  if (!shape.fixed) {
    const direction = attrs.direction ?? shape.direction;
    out.push({
      edits: layout({ direction: direction === 'down' ? 'right' : 'down' }),
      why: `${was}, the other direction`,
    });
    out.push({
      edits: layout({ ordering: attrs.ordering === 'crossings' ? 'stable' : 'crossings' }),
      why: `${was}, the other rank ordering`,
    });
    if (['flow', 'layered', 'compound-flow'].includes(engine ?? defaultEngine(shape)))
      out.push({
        edits: layout({ fold: attrs.fold === 'never' ? 'auto' : 'never' }),
        why: `${was}, ${attrs.fold === 'never' ? 'folding long runs' : 'one line, no folding'}`,
      });
    for (const key of ['rank-gap', 'node-gap', ...(shape.groups ? ['group-gap'] : [])])
      for (const v of nextSteps(key, attrs[key]))
        out.push({ edits: layout({ [key]: v }), why: `${was}, ${key}=${v}` });
  }
  if (shape.scope === 'root')
    for (const [key, v] of [
      ['crossing-penalty', '900'],
      ['edge-gap', '28'],
    ])
      out.push({
        edits: combine(from.edits, [{ kind: 'routing', attrs: { [key]: v } }]),
        why: `${was}, routing ${key}=${v}`,
      });
  return out;
}

// --- Measuring ---------------------------------------------------------------------------------

const centers = (rects: Map<string, Rect>) => {
  const all = [...rects.values()],
    x0 = Math.min(...all.map(r => r.x)),
    y0 = Math.min(...all.map(r => r.y));
  return new Map(
    [...rects].map(([id, r]) => [id, { x: r.x + r.w / 2 - x0, y: r.y + r.h / 2 - y0 }]),
  );
};

export interface Drawn {
  scene: Scene;
  /** The projected document, and the objects it shows. */
  doc: Diagram;
  vg: VisibleGraph;
  metrics: Omit<Metrics, 'moved'>;
  routes: DrawnRoute[];
  rects: Map<string, Rect>;
  /** Node ids, for the per-node checks. */
  nodes: string[];
  centers: Map<string, { x: number; y: number }>;
  /** Rounded geometry, to spot variants that draw the same picture. */
  key: string;
  svg: string;
}

/** Compile, route and draw `source` as the CLI does, and measure the drawing. */
export async function draw(source: string): Promise<Drawn> {
  const scene = await compile(source);
  const errors = scene.diagnostics.filter(d => d.level === 'error');
  if (errors.length) throw Error(errors.map(d => d.message).join(' '));
  return drawScene(scene);
}

/** Route and draw a compiled scene as the CLI does, and measure the drawing. */
export function drawScene(scene: Scene): Drawn {
  const doc = projectScene(scene),
    { vg, rects } = visibleRects(doc),
    { routes, result } = computeRoutes(doc, vg, rects, { previous: [] });
  // A soft group drawn in pieces no longer reads as one group, so it counts against a variant
  // even though `check` only notes it.
  const warnings =
    scene.diagnostics.filter(d => d.level === 'warning' || d.code === 'soft-split').length +
    findConflicts(scene, doc, rects, routes).length;
  const svg = renderSvg(doc);
  const size = /width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(svg)!;
  const c = centers(rects);
  return {
    scene,
    doc,
    vg,
    metrics: {
      width: Math.round(Number(size[1])),
      height: Math.round(Number(size[2])),
      crossings: result.report.crossings,
      bends: result.report.bends,
      length: Math.round(result.report.length),
      warnings,
    },
    routes,
    rects,
    nodes: doc.graph.nodes.map(n => n.id),
    centers: c,
    // The image size too: compare panels change the picture, not the geometry.
    key: [`${size[1]}x${size[2]}`, ...c]
      .map(x =>
        typeof x === 'string' ? x : `${x[0]}:${Math.round(x[1].x / 4)},${Math.round(x[1].y / 4)}`,
      )
      .concat(
        routes.map(r =>
          r.points.map(p => `${Math.round(p.x / 4)},${Math.round(p.y / 4)}`).join(' '),
        ),
      )
      .join('|'),
    svg,
  };
}

/** A route's length, along its points. */
const routeLength = (r: DrawnRoute) =>
  r.points
    .slice(1)
    .reduce((n, p, i) => n + Math.abs(p.x - r.points[i].x) + Math.abs(p.y - r.points[i].y), 0);

/** Gap between two boxes, 0 when they touch or overlap. */
const gapBetween = (a: Rect, b: Rect) =>
  Math.hypot(
    Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)),
    Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h)),
  );

/** A route longer than this many times the distance between its ends, and this much longer, is a detour. */
const DETOUR_RATIO = 2.5,
  DETOUR_EXTRA = 300;
/** A node this far from every node it connects to is stranded. */
const STRANDED_GAP = 480;
/** Without `--fit`, an image taller than this many times its width is extreme. */
const EXTREME_ASPECT = 3;
/**
 * Most diagrams are read in a page or chat column about this wide. A drawing wider than this and
 * wider than WIDE_ASPECT:1 shrinks to fit it, and its text shrinks with it.
 */
const COLUMN_WIDTH = 960,
  WIDE_ASPECT = 2;

/** Whether a drawing shrinks, text and all, to fit a page or chat column. */
export const tooWide = (m: Pick<Metrics, 'width' | 'height'>) =>
  m.width / m.height > WIDE_ASPECT && m.width > COLUMN_WIDTH;

/**
 * Warnings about how a drawing reads, beyond what `check` reports by default: lines that cross,
 * routes that detour far past the distance between their ends, a node far from everything it
 * connects to, and an aspect ratio far from `fit` (or extreme without one).
 */
export function qualityNotes(d: Drawn, fit?: Fit): Diagnostic[] {
  const notes: Diagnostic[] = [],
    warn = (code: string, message: string, ids: string[]) =>
      notes.push({ level: 'warning', code, message, ids });
  // Crossings: an upright segment of one route strictly across a level segment of another.
  const segs = d.routes.map(r => r.points.slice(1).map((p, i) => [r.points[i], p] as const));
  for (let i = 0; i < d.routes.length; i++)
    for (let j = i + 1; j < d.routes.length; j++) {
      const a = d.routes[i],
        b = d.routes[j];
      if ([a.from, a.to].some(e => e === b.from || e === b.to)) continue;
      const hit = segs[i].some(s => segs[j].some(t => crosses(s, t) || crosses(t, s)));
      if (hit) warn('crossing', `Edges ${a.id} and ${b.id} cross.`, [a.id, b.id]);
    }
  for (const r of d.routes) {
    const p = r.points[0],
      q = r.points[r.points.length - 1],
      straight = Math.abs(p.x - q.x) + Math.abs(p.y - q.y),
      length = routeLength(r);
    if (length > DETOUR_RATIO * straight && length - straight > DETOUR_EXTRA)
      warn(
        'detour',
        `Edge ${r.id} (${r.from} -> ${r.to}) runs ${Math.round(length)}px to cover ${Math.round(straight)}px.`,
        [r.id],
      );
  }
  const neighbours = new Map<string, Set<string>>();
  for (const r of d.routes)
    for (const [a, b] of [
      [r.from, r.to],
      [r.to, r.from],
    ])
      neighbours.set(a, (neighbours.get(a) ?? new Set()).add(b));
  for (const id of d.nodes) {
    const box = d.rects.get(id),
      near = [...(neighbours.get(id) ?? [])].flatMap(n =>
        d.rects.get(n) ? [d.rects.get(n)!] : [],
      );
    if (!box || !near.length) continue;
    const gap = Math.min(...near.map(n => gapBetween(box, n)));
    if (gap > STRANDED_GAP)
      warn('stranded', `${id} is ${Math.round(gap)}px from the nearest node it connects to.`, [id]);
  }
  const aspect = d.metrics.width / d.metrics.height;
  if (fit) {
    const target = FITS[fit],
      off = Math.max(aspect / target, target / aspect);
    if (off > 1.5)
      warn(
        'aspect',
        `The drawing is ${d.metrics.width}×${d.metrics.height} (aspect ${aspect.toFixed(2)}); --fit ${fit} wants about ${target}. Try draftably vary --fit ${fit}.`,
        [],
      );
  } else if (tooWide(d.metrics))
    warn(
      'aspect',
      `The drawing is ${d.metrics.width}×${d.metrics.height} (aspect ${aspect.toFixed(2)}). In a ${COLUMN_WIDTH}px page or chat column it draws at ${Math.round((COLUMN_WIDTH / d.metrics.width) * 100)}% of its size, so its text shrinks. Add fit=slide to the layout root line, or run draftably vary, unless the user wants a wide drawing.`,
      [],
    );
  else if (aspect < 1 / EXTREME_ASPECT)
    warn(
      'aspect',
      `The drawing is ${d.metrics.width}×${d.metrics.height} (aspect ${aspect.toFixed(2)}). Try draftably vary --fit page (or square).`,
      [],
    );
  return notes;
}

/** Whether level segment `s` and upright segment `t` cross strictly inside both. */
function crosses(
  s: readonly [{ x: number; y: number }, { x: number; y: number }],
  t: readonly [{ x: number; y: number }, { x: number; y: number }],
) {
  if (s[0].y !== s[1].y || t[0].x !== t[1].x) return false;
  const [x0, x1] = [Math.min(s[0].x, s[1].x), Math.max(s[0].x, s[1].x)],
    [y0, y1] = [Math.min(t[0].y, t[1].y), Math.max(t[0].y, t[1].y)];
  return t[0].x > x0 && t[0].x < x1 && s[0].y > y0 && s[0].y < y1;
}

const movedFrom = (base: Drawn['centers'], next: Drawn['centers']) => {
  const ds = [...next].flatMap(([id, p]) => {
    const q = base.get(id);
    return q ? [Math.hypot(p.x - q.x, p.y - q.y)] : [];
  });
  return ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : 0;
};

// --- Ranking -----------------------------------------------------------------------------------

const area = (m: Metrics) => m.width * m.height;

/** Sort keys for a preference, most important first. Warnings always come first. */
function keys(m: Metrics, goal: Goal): number[] {
  // With --fit, closeness to the target (in steps of 0.1) comes right after warnings.
  const fit = goal.fit ? [Math.round(fitError(m, goal.fit) * 10)] : [];
  if (goal.prefer === 'compact') return [m.warnings, ...fit, area(m), m.crossings, m.bends];
  if (goal.prefer === 'stable') return [m.warnings, ...fit, m.moved, m.crossings, area(m)];
  return [m.warnings, ...fit, m.crossings, area(m), m.bends];
}

const compareKeys = (a: number[], b: number[]) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

/**
 * Whether `m` is at least as good as the current file on warnings, crossings and size, and
 * better on one of them. Only such a variant is recommended over keeping the file as it is.
 * Fewer warnings with no more crossings is always better: a conflict outweighs room.
 * With `--fit`, size means closeness to the target shape, so a variant may grow to fit it, but
 * by at most half: reshaping the same content needs little more room, and more is empty space.
 */
export function improves(m: Metrics, base: Metrics, fit?: Fit) {
  if (m.warnings > base.warnings || m.crossings > base.crossings) return false;
  if (m.warnings < base.warnings) return true;
  const fewer = m.crossings < base.crossings;
  if (!fit) return area(m) <= area(base) && (fewer || area(m) < area(base));
  const [now, was] = [fitError(m, fit), fitError(base, fit)];
  return area(m) <= area(base) * 1.5 && now <= was + 0.01 && (fewer || now < was - 0.05);
}

/** Label what stands out in each variant: the fewest crossings, the smallest, the least moved. */
function tag(list: Variant[], fit?: Fit) {
  const ok = list.filter(v => v.metrics && !v.error);
  const best = (label: string, score: (m: Metrics) => number) => {
    if (ok.length < 2) return;
    const low = Math.min(...ok.map(v => score(v.metrics!)));
    const winners = ok.filter(v => score(v.metrics!) === low);
    // A tag most variants share tells the reader nothing.
    if (winners.length <= Math.max(1, Math.floor(ok.length / 2)))
      for (const v of winners) v.tags.push(label);
  };
  best('fewest crossings', m => m.crossings);
  best('smallest', area);
  best('fewest bends', m => m.bends);
  if (fit) best('best fit', m => Math.round(fitError(m, fit) * 100));
  const others = ok.filter(v => v.id !== 'v0');
  if (others.length > 1) {
    const low = Math.min(...others.map(v => v.metrics!.moved));
    others.filter(v => v.metrics!.moved === low).forEach(v => v.tags.push('least moved'));
  }
}

export interface VaryOptions {
  /** How many variants to keep besides the current file (suggestions only). */
  limit?: number;
  prefer?: Prefer;
  /** `--try` axes: try exactly these settings, in order, instead of suggesting. */
  axes?: Axis[];
  /** `--grid`: the documented engine and direction sweep. */
  grid?: boolean;
  /** The scope whose `layout` line varies: `root` (default) or a framed group. */
  scope?: string;
  /** `--fit`: the shape the image should take. */
  fit?: Fit;
  /** `--from`: search around this variant of an earlier run. */
  from?: { id: string; edits: Edit[] };
  /** `--budget`: stop trying new variants after this many milliseconds; keep what was found. */
  budget?: number;
  /** Called as each variant finishes: its title, metrics (or error), and how many are left. */
  progress?: (
    done: { title: string; metrics?: Metrics; error?: string; ms: number },
    left: number,
  ) => void;
}

export interface VaryResult {
  shape: Shape;
  mode: 'suggest' | 'try' | 'grid' | 'from';
  /** `v0` (the file as it is) first, then the kept variants: ranked, or in sweep order. */
  variants: Variant[];
  /** The variant to apply, or `v0` when none improves on the file. */
  recommended: string;
  tried: number;
  /** Variants that did not compile, with the reason. */
  failed: Array<{ title: string; error: string }>;
  /** Candidates left untried when `--budget` ran out. */
  skipped: number;
  /** Source and SVG for each listed variant, by id. */
  drawn: Map<string, Measured>;
}

/** Refuse a `--scope` that is not the root or a framed group. */
function checkScope(scene: Scene, scope: string) {
  if (scope === 'root') return;
  const o = scene.byId.get(scope) ?? scene.model.objects.find(x => x.id === scope);
  if (!o || o.type !== 'group')
    throw Error(
      `--scope ${scope}: not a group. Groups: ${scene.model.objects
        .filter(x => x.type === 'group')
        .map(x => x.id)
        .join(', ')}.`,
    );
  if (o.frame) throw Error(`--scope ${scope}: a ${o.frame} group has no layout of its own.`);
}

/**
 * Try variants of `source` and measure each one. Suggestions drop duplicates of earlier drawings
 * and are ranked against the file as it is; `--try` and `--grid` keep every variant in sweep
 * order and tag repeats.
 */
export async function vary(source: string, opts: VaryOptions = {}): Promise<VaryResult> {
  const goal: Goal = { prefer: opts.prefer ?? 'fewer-crossings', fit: opts.fit },
    scope = opts.scope ?? opts.from?.edits.find(e => e.kind === 'layout')?.scope ?? 'root',
    mode = opts.axes?.length ? 'try' : opts.grid ? 'grid' : opts.from ? 'from' : 'suggest',
    ranked = mode === 'suggest' || mode === 'from',
    limit = ranked ? (opts.limit ?? 4) : 12;
  const scene = await compile(source);
  checkScope(scene, scope);
  const shape = shapeOf(scene, scope),
    base = await draw(source);
  const v0: Variant = {
    id: 'v0',
    title: 'current',
    why: 'the file as it is',
    edits: [],
    lines: [],
    metrics: { ...base.metrics, moved: 0 },
    tags: [],
  };
  // The first variant to draw each picture; ids are given after ranking, so keep the objects.
  const seen = new Map<string, Variant>([[base.key, v0]]),
    drawn = new Map<string, Measured>([['v0', { variant: v0, source, svg: base.svg }]]),
    found: Array<{ variant: Variant; measured: Measured; same?: Variant }> = [],
    failed: VaryResult['failed'] = [];
  const candidates =
    mode === 'try'
      ? sweep(shape, opts.axes!)
      : mode === 'grid'
        ? grid(shape)
        : mode === 'from'
          ? neighbors(shape, opts.from!)
          : [
              ...suggestions(shape, base.metrics, goal),
              ...(scope === 'root' ? autoVariants(scene, sceneConflicts(scene)) : []),
            ];
  const start = Date.now();
  let skipped = 0;
  for (const [i, c] of candidates.entries()) {
    if (opts.budget !== undefined && Date.now() - start > opts.budget) {
      skipped = candidates.length - i;
      break;
    }
    const began = Date.now(),
      left = candidates.length - i - 1;
    const { source: next, changes } = applyEdits(source, c.edits);
    const variant: Variant = {
      id: '',
      title: titleOf(c.edits),
      why: c.why,
      edits: c.edits,
      lines: changes,
      tags: [],
    };
    if (!changes.length && ranked) continue;
    try {
      const d = await draw(next);
      const same = seen.get(d.key);
      variant.metrics = { ...d.metrics, moved: movedFrom(base.centers, d.centers) };
      opts.progress?.(
        { title: variant.title, metrics: variant.metrics, ms: Date.now() - began },
        left,
      );
      if (same && ranked) continue;
      found.push({ variant, measured: { variant, source: next, svg: d.svg }, same });
      if (!same) seen.set(d.key, variant);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      opts.progress?.({ title: variant.title, error: message, ms: Date.now() - began }, left);
      failed.push({ title: variant.title, error: message });
    }
  }
  const better = (v: Variant) => improves(v.metrics!, v0.metrics!, goal.fit);
  if (ranked)
    found.sort(
      (a, b) =>
        Number(better(b.variant)) - Number(better(a.variant)) ||
        compareKeys(keys(a.variant.metrics!, goal), keys(b.variant.metrics!, goal)),
    );
  const kept = found.slice(0, limit);
  kept.forEach((f, i) => {
    f.variant.id = `v${i + 1}`;
    drawn.set(f.variant.id, f.measured);
  });
  // Sweeps keep repeats in place so the order stays the documented one; say which they repeat.
  for (const f of kept) if (f.same) f.variant.tags.push(`same as ${f.same.id}`);
  const variants = [v0, ...kept.map(f => f.variant)];
  tag(
    variants.filter(v => !v.tags.some(t => t.startsWith('same as'))),
    goal.fit,
  );
  const pick = kept
    .map(f => f.variant)
    .filter(v => better(v) && !v.tags.some(t => t.startsWith('same as')))
    .sort((a, b) => compareKeys(keys(a.metrics!, goal), keys(b.metrics!, goal)))[0];
  const recommended = pick?.id ?? 'v0';
  variants.find(v => v.id === recommended)!.tags.unshift('recommended');
  return {
    shape,
    mode,
    variants,
    recommended,
    tried: candidates.length - skipped,
    failed,
    skipped,
    drawn,
  };
}
