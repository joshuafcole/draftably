/**
 * Draftably's layout and router for any graph: plain data in, geometry out.
 *
 * `layout(graph)` places and routes a graph with no positions. It builds the statements a `.draft`
 * file parses to, so the file compiler runs unchanged, and it returns that file as `draft`.
 * `route(graph)` draws lines between boxes the caller already placed.
 */
import { checkSource, compile, type Scene } from '../dsl/compile';
import { projectScene, visibleRects } from '../dsl/project';
import { bare, parseModel, printSource, quoted, type SourceLine, type Word } from '../dsl/syntax';
import { emptyDiagram } from '../model/document';
import type { VisibleGraph } from '../model/graph';
import { computeRoutes } from '../model/routes';
import { placedItems } from '../runtime/geometry';
import type { Diagram, Point, Rect, RoutingSettings, Side } from '../model/types';

export type Shape = 'box' | 'pill' | 'circle' | 'diamond' | 'text';
/** How a scope arranges its children: a recipe, or a layout engine as `engine:<name>`. */
export type Arrange = 'flow' | 'row' | 'column' | 'lanes' | 'sequence' | `engine:${string}`;
/**
 * How hard the router works. `full` repairs crossings and evens out lanes; `quick` routes each
 * line once. `auto` (the default) routes quickly first, and fully when that will stay fast.
 */
export type Quality = 'auto' | 'full' | 'quick';

export interface RoutingOptions extends Partial<RoutingSettings> {
  quality?: Quality;
}

export interface NodeIn {
  id: string;
  label?: string;
  parent?: string;
  shape?: Shape;
  /** Fixed size, kept within 40–1200 by 24–1200. Without one, the box fits its label. */
  width?: number;
  height?: number;
}

export interface GroupIn {
  id: string;
  label?: string;
  parent?: string;
  /** How the group arranges its own children; `column` by default. */
  arrange?: Arrange;
  direction?: 'right' | 'down';
  gap?: number;
}

export interface EdgeIn {
  /** Unique among edges. Without one, the edge is `e1`, `e2`, … by position. */
  id?: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
  sourceSide?: Side;
  targetSide?: Side;
}

export interface GraphIn {
  nodes: NodeIn[];
  groups?: GroupIn[];
  edges?: EdgeIn[];
  /** How the top level is arranged; `flow` by default. */
  arrange?: Arrange;
  direction?: 'right' | 'down';
  gap?: number;
  fit?: 'wide' | 'slide' | 'square' | 'page' | 'tall';
  /**
   * `auto` (the default) folds a long `flow` into rows, like lines of text, when it is much
   * wider than a 1100×720 page; `never` keeps one row.
   */
  fold?: 'auto' | 'never';
  routing?: RoutingOptions;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedBox extends Box {
  parent?: string;
}

export interface EdgeOut {
  source: string;
  target: string;
  sourceSide: Side;
  targetSide: Side;
  /** From the source's outline to the target's. The host draws the arrowhead at the last point. */
  points: Point[];
  /** SVG path data with the rounded corners draftably draws. */
  path: string;
  /** The label's box. Draw a backing behind it: other lines may pass under it. */
  label: Box | null;
  /** True when the router found no clear way and drew a fallback line. */
  blocked: boolean;
}

export interface Routed {
  edges: Record<string, EdgeOut>;
  /** The router mode that drew the lines. */
  quality: 'full' | 'quick';
  warnings: string[];
}

export interface LayoutResult extends Routed {
  nodes: Record<string, PlacedBox>;
  groups: Record<string, PlacedBox>;
  /** Everything drawn: boxes, lines and labels. */
  bounds: Box;
  /** The `.draft` file this graph is. Open it in the viewer, or pass it to `renderSvg`. */
  draft: string;
}

const ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

/** Caller IDs as file IDs and back. An ID such as `1` or `a b` gets a safe alias. */
function aliases(ids: string[], kind: string) {
  const to = new Map<string, string>(),
    back = new Map<string, string>(),
    taken = new Set(ids.filter(id => ID.test(id)));
  let n = 0;
  for (const id of ids) {
    if (typeof id !== 'string' || !id) throw Error(`Every ${kind} needs a string id.`);
    if (to.has(id)) throw Error(`Duplicate ${kind} id "${id}".`);
    let safe = id;
    if (!ID.test(id)) {
      do safe = `_${n++}`;
      while (taken.has(safe));
      taken.add(safe);
    }
    to.set(id, safe);
    back.set(safe, id);
  }
  return {
    of: (id: string, from: string) => {
      const safe = to.get(id);
      if (!safe) throw Error(`${from} refers to unknown id "${id}".`);
      return safe;
    },
    back: (safe: string) => back.get(safe) ?? safe,
  };
}

/** Edge IDs, numbering the ones without an ID after those the caller gave. */
function edgeIds(edges: EdgeIn[]) {
  const given = new Set(edges.flatMap(e => (e.id ? [e.id] : [])));
  let n = 0;
  return edges.map(e => {
    if (e.id) return e.id;
    let id;
    do id = `e${++n}`;
    while (given.has(id));
    return id;
  });
}

const kebab = (key: string) => key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);

function statement(command: string, args: Word[], attrs: Record<string, unknown> = {}): SourceLine {
  return {
    kind: 'statement',
    command,
    args,
    attrs: Object.entries(attrs)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => [
        k,
        typeof v === 'string' && !/^[\w.-]+$/.test(v) ? quoted(v) : bare(String(v)),
      ]),
    line: 0,
  };
}

function layoutLine(scope: string, arrange: Arrange, attrs: Record<string, unknown>) {
  const engine = arrange.startsWith('engine:') ? arrange.slice(7) : undefined;
  return statement('layout', engine ? [bare(scope)] : [bare(scope), bare(arrange)], {
    ...(engine ? { engine } : {}),
    ...attrs,
  });
}

/**
 * `auto` routes fully when the quick routes predict a full pass within the budget. The full
 * pass reroutes each line with a crossing or crowded lane against all the others, so its cost
 * grows with lines times conflicts; this limit keeps it near the 1 s load budget.
 */
export const AUTO_FULL_LIMIT = 1200;

function routesFor(
  doc: Diagram,
  vg: VisibleGraph,
  rects: Map<string, Rect>,
  quality: Quality = 'auto',
) {
  if (quality === 'full')
    return { ...computeRoutes(doc, vg, rects, { previous: [] }), quality: 'full' as const };
  const quick = computeRoutes(doc, vg, rects, { previous: [], quick: true }),
    { edges, crossings, lanePairs, shared } = quick.result.report,
    work = edges * (1 + crossings + lanePairs + (shared ? 1 : 0));
  if (quality === 'quick' || work > AUTO_FULL_LIMIT) return { ...quick, quality: 'quick' as const };
  return { ...computeRoutes(doc, vg, rects, { previous: [] }), quality: 'full' as const };
}

/** Geometry for every node, group and edge of a projected document, under the caller's IDs. */
function placed(
  doc: Diagram,
  quality: Quality | undefined,
  objectId: (id: string) => string,
  edgeId: (id: string) => string,
) {
  const { vg, rects } = visibleRects(doc),
    routed = routesFor(doc, vg, rects, quality),
    out = placedItems(doc, rects, routed.routes, objectId, edgeId),
    blocked = Object.values(out.edges).filter(e => e.blocked).length;
  return {
    ...out,
    quality: routed.quality,
    warnings: blocked ? [`${blocked} line${blocked > 1 ? 's' : ''} found no clear way.`] : [],
  };
}

/** A file message with each alias it names written as the caller's ID. */
function named(message: string, ids: string[], back: (id: string) => string) {
  let out = message;
  for (const id of ids)
    if (back(id) !== id) out = out.replace(new RegExp(`\\b${id}\\b`, 'g'), `"${back(id)}"`);
  return out;
}

/** A size kept within what a file allows, with a warning when it had to change. */
function sized(n: NodeIn, warnings: string[]) {
  const fit = (v: number | undefined, lo: number, hi: number, what: string) => {
    if (v === undefined || !Number.isFinite(v)) return undefined;
    const kept = Math.round(Math.min(hi, Math.max(lo, v)));
    if (kept !== Math.round(v))
      warnings.push(`Node "${n.id}" ${what} ${v} is outside ${lo}–${hi}; drawn at ${kept}.`);
    return kept;
  };
  return { width: fit(n.width, 40, 1200, 'width'), height: fit(n.height, 24, 1200, 'height') };
}

/** The file a graph is, parsed, with what is needed to report its result under the caller's IDs. */
function build(graph: GraphIn) {
  const groups = graph.groups ?? [],
    nodes = graph.nodes ?? [],
    edges = graph.edges ?? [],
    ids = edgeIds(edges),
    objects = aliases([...groups.map(g => g.id), ...nodes.map(n => n.id)], 'node or group'),
    lines = aliases(ids, 'edge'),
    of = objects.of,
    { quality, ...routing } = graph.routing ?? {},
    warnings: string[] = [];
  const doc: SourceLine[] = [
    ...groups.map(g =>
      statement('group', [bare(of(g.id, 'group')), quoted(g.label ?? g.id)], {
        in: g.parent && of(g.parent, `Group "${g.id}"`),
        fold: graph.fold === 'never' ? 'never' : undefined,
      }),
    ),
    ...nodes.map(n =>
      statement('node', [bare(of(n.id, 'node')), quoted(n.label ?? n.id)], {
        in: n.parent && of(n.parent, `Node "${n.id}"`),
        shape: n.shape,
      }),
    ),
    ...edges.map((e, i) =>
      statement(
        'edge',
        [
          bare(lines.of(ids[i], 'edge')),
          bare(of(e.source, `Edge "${ids[i]}"`)),
          bare('->'),
          bare(of(e.target, `Edge "${ids[i]}"`)),
          ...(e.label ? [quoted(e.label)] : []),
        ],
        { kind: e.dashed ? 'async' : undefined, from: e.sourceSide, to: e.targetSide },
      ),
    ),
    // A file with no layout line spaces its root flow 48px apart; a layout line without `gap=`
    // only 28px, too tight for a line into a group below its title band.
    layoutLine('root', graph.arrange ?? 'flow', {
      gap: graph.gap ?? ((graph.arrange ?? 'flow') === 'flow' ? 48 : undefined),
      direction: graph.direction,
      fit: graph.fit,
      fold: graph.fold === 'never' ? 'never' : undefined,
    }),
    ...groups
      .filter(g => g.arrange || g.direction || g.gap)
      .map(g =>
        layoutLine(of(g.id, 'group'), g.arrange ?? 'column', {
          gap: g.gap,
          direction: g.direction,
        }),
      ),
    ...nodes.flatMap(n => {
      const { width, height } = sized(n, warnings);
      return width || height
        ? [
            statement('size', [bare(of(n.id, 'node'))], {
              width: width ?? 176,
              height: height ?? 'auto',
            }),
          ]
        : [];
    }),
    ...(Object.keys(routing).length
      ? [
          statement(
            'routing',
            [],
            Object.fromEntries(Object.entries(routing).map(([k, v]) => [kebab(k), v])),
          ),
        ]
      : []),
  ];
  const draft = printSource({ lines: doc });
  // Parse first so a bad graph fails with the file's own message, not a layout error.
  return { draft, model: parseModel({ lines: doc }), quality, objects, lines, warnings };
}

function finish(
  { draft, model, quality, objects, lines, warnings }: ReturnType<typeof build>,
  scene: Scene,
): LayoutResult {
  const out = placed(projectScene(scene), quality, objects.back, lines.back);
  return {
    ...out,
    draft,
    warnings: [
      ...warnings,
      ...model.warnings.map(w => w.message),
      // A caller's size is the host's to fill: whether draftably's text fits it says nothing.
      ...scene.diagnostics
        .filter(d => d.level !== 'info' && d.code !== 'text-overflow')
        .map(d => named(d.message, d.ids, objects.back)),
      ...out.warnings,
    ],
  };
}

/** Place and route a graph the way a `.draft` file with the same content draws. */
export async function layout(graph: GraphIn): Promise<LayoutResult> {
  const built = build(graph);
  return finish(built, await compile(built.draft));
}

/**
 * `layout` without a promise, for callers that cannot wait, such as a stand-in for a synchronous
 * library. It cannot run a layout engine (`engine:` arrangements) or `fit`, which need `layout`.
 */
export function layoutSync(graph: GraphIn): LayoutResult {
  const built = build(graph);
  if (built.model.layouts.some(l => l.engine || l.fit))
    throw Error('layoutSync cannot run layout engines or fit; use layout().');
  return finish(built, checkSource(built.draft));
}

export interface PlacedNodeIn extends Box {
  id: string;
  parent?: string;
  shape?: Shape;
}

export interface PlacedGroupIn extends Box {
  id: string;
  parent?: string;
  /** The title, so lines keep out of its band at the top of the group. */
  label?: string;
}

export interface RouteIn {
  nodes: PlacedNodeIn[];
  groups?: PlacedGroupIn[];
  edges: EdgeIn[];
  routing?: RoutingOptions;
}

/** Route lines between boxes the caller placed. Nothing moves. */
export function route(graph: RouteIn): Routed {
  const doc = emptyDiagram(),
    groups = graph.groups ?? [],
    known = new Set<string>(),
    { quality, ...routing } = graph.routing ?? {},
    ids = edgeIds(graph.edges);
  doc.settings.routing = { ...doc.settings.routing, ...routing };
  for (const o of [...groups, ...graph.nodes]) {
    if (known.has(o.id)) throw Error(`Duplicate node or group id "${o.id}".`);
    known.add(o.id);
  }
  const check = (id: string | undefined, from: string) => {
    if (id !== undefined && !known.has(id)) throw Error(`${from} refers to unknown id "${id}".`);
  };
  for (const g of groups) {
    check(g.parent, `Group "${g.id}"`);
    doc.graph.groups.push({
      id: g.id,
      title: g.label ?? '',
      ...(g.parent ? { parentId: g.parent } : {}),
    });
    doc.layout.containers[g.id] = { direction: 'inherit', padding: 0, manualSize: true };
  }
  for (const n of graph.nodes) {
    check(n.parent, `Node "${n.id}"`);
    doc.graph.nodes.push({ id: n.id, title: '', ...(n.parent ? { parentId: n.parent } : {}) });
    doc.styles[n.id] = { shape: n.shape ?? 'box', color: 'auto', icon: '' };
  }
  for (const o of [...groups, ...graph.nodes])
    doc.layout.nodes[o.id] = { x: o.x, y: o.y, w: o.width, h: o.height };
  graph.edges.forEach((e, i) => {
    const id = ids[i];
    check(e.source, `Edge "${id}"`);
    check(e.target, `Edge "${id}"`);
    doc.graph.edges.push({
      id,
      from: e.source,
      to: e.target,
      label: e.label ?? '',
      directed: true,
      emphasis: false,
      dashed: !!e.dashed,
    });
    doc.layout.edges[id] = {
      ...(e.sourceSide ? { fromSide: e.sourceSide } : {}),
      ...(e.targetSide ? { toSide: e.targetSide } : {}),
    };
  });
  const {
    edges,
    quality: used,
    warnings,
  } = placed(
    doc,
    quality,
    id => id,
    id => id,
  );
  return { edges, quality: used, warnings };
}
