/**
 * Turn a compiled scene into an editor document, and measure the canonical geometry that the
 * CLI and the browser compare. Routes come from the editor's own router, with no prior routes,
 * so a given source always draws the same connections.
 */
import { DEFAULT_SETTINGS, emptyDiagram } from '../model/document';
import { clone } from '../model/geometry';
import { frameRect, makeGeometry, visibleGraph } from '../model/graph';
import { computeRoutes } from '../model/routes';
import type { ColorKey, Diagram, Rect } from '../model/types';
import type { Scene, SceneObject } from './compile';
import { cellsBandFor } from './cells';
import { GROUP_INSET } from './frame';

/** Editor state that is not part of the source and survives a reprojection. */
export type ViewState = Partial<Pick<Diagram, 'settings' | 'camera' | 'theme' | 'collapsed'>>;

/** An object's color family: its own, or the nearest colored group's; `auto` when none is. */
function resolveColor(scene: Scene, o: SceneObject): ColorKey {
  for (let x: SceneObject | undefined = o; x; x = scene.byId.get(x.parent))
    if (x.color !== 'auto') return x.color;
  return 'auto';
}

export function projectScene(scene: Scene, view: ViewState = {}): Diagram {
  const doc = emptyDiagram(scene.title);
  const set = (record: Record<string, unknown>, id: string, value: unknown) =>
    Object.defineProperty(record, id, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  doc.id = 'draft-file';
  doc.appearance = clone(scene.model.appearance);
  const cells = new Set(scene.model.layouts.filter(l => l.algorithm === 'cells').map(l => l.scope)),
    band = cellsBandFor(scene.look.groupTitle.lineHeight);
  const hinted = (type: string, id: string) =>
    scene.model.hints.some(h => h.type === type && 'id' in h && h.id === id);
  for (const o of scene.objects) {
    const entry = {
      id: o.id,
      title: o.label,
      ...(o.was !== undefined ? { was: o.was } : {}),
      ...(o.wasShape !== undefined ? { wasShape: o.wasShape } : {}),
      ...(o.wasCount !== undefined ? { wasCount: o.wasCount } : {}),
      // The file gives the old corner in the parent's content area; the drawing places it there.
      ...(o.wasAt
        ? { wasAt: { x: o.x - o.localX + o.wasAt.x, y: o.y - o.localY + o.wasAt.y } }
        : {}),
      ...(o.wasSize ? { wasSize: { ...o.wasSize } } : {}),
      ...(o.href !== undefined ? { href: o.href } : {}),
      ...(o.count !== undefined ? { count: o.count } : {}),
      ...(o.span !== undefined ? { span: o.span } : {}),
      ...(o.parent !== 'root' ? { parentId: o.parent } : {}),
      ...(o.frame ? { frame: o.frame } : {}),
      ...(o.hull ? { hull: o.hull } : {}),
      ...(o.titleLines ? { titleLines: o.titleLines } : {}),
      ...(o.lifeline ? { lifeline: o.lifeline } : {}),
    };
    if (o.type === 'group') {
      doc.graph.groups.push(entry);
      set(doc.layout.containers, o.id, {
        direction: 'inherit',
        padding: GROUP_INSET,
        manualSize: true,
        ...(cells.has(o.id) ? { cellsBand: band } : {}),
        ...(scene.cells.has(o.id) ? { cellsChrome: clone(scene.cells.get(o.id)!) } : {}),
      });
    } else {
      doc.graph.nodes.push(entry);
      // A marker's label sits above the object it cuts, clear of lines that reach it from below.
      if (o.shape === 'marker') set(doc.layout.labels, o.id, { mode: 'top' });
    }
    set(doc.layout.nodes, o.id, {
      x: o.x,
      y: o.y,
      w: o.w,
      h: o.h,
      manual: hinted('near', o.id) || hinted('nudge', o.id),
      pinned: hinted('pin', o.id),
    });
    set(doc.styles, o.id, {
      shape: o.shape,
      // A cell is drawn on the neutral surface under its group's band unless it names a color.
      color: cells.has(o.parent) && o.color === 'auto' ? 'auto' : resolveColor(scene, o),
      ...(o.shade !== undefined ? { shade: o.shade } : {}),
      icon: '',
      ...(o.status ? { status: o.status } : {}),
    });
  }
  const flow = readingDirections(scene);
  for (const e of scene.edges) {
    doc.graph.edges.push({
      id: e.id,
      from: e.source,
      to: e.target,
      label: e.label,
      ...(e.was !== undefined ? { was: e.was } : {}),
      directed: e.directed !== false,
      ...(e.head ? { head: e.head } : {}),
      ...(e.tail ? { tail: e.tail } : {}),
      emphasis: false,
      dashed: e.dashed,
      ...(e.status ? { status: e.status } : {}),
    });
    set(doc.layout.edges, e.id, {
      ...(e.from !== 'auto' ? { fromSide: e.from } : {}),
      ...(e.to !== 'auto' ? { toSide: e.to } : {}),
      ...(flow(e.source, e.target) ? { flow: flow(e.source, e.target) } : {}),
      ...(e.lane ? { lane: e.lane } : {}),
      ...(e.row !== undefined ? { row: e.row } : {}),
      // An authored route: bends the router passes through; a soft one gives way when blocked.
      ...(e.route
        ? {
            waypoints: e.route.points.map(p => ({ ...p })),
            ...(e.route.strength === 'soft' ? { softRoute: true } : {}),
          }
        : {}),
      ...(e.labelAt ? { labelAt: { ...e.labelAt } } : {}),
    });
  }
  if (scene.sequence) doc.layout.sequence = clone(scene.sequence);
  const groups = new Set(doc.graph.groups.map(g => g.id));
  doc.collapsed = (view.collapsed ?? []).filter(id => groups.has(id));
  doc.settings = clone(view.settings ?? DEFAULT_SETTINGS);
  // The file decides routing, and its root engine recipe is what layout tools start from.
  doc.settings.routing = { ...DEFAULT_SETTINGS.routing, ...scene.model.routing };
  const root = scene.model.layouts.find(l => l.scope === 'root');
  // `auto` reads left to right in the compiler's landscape render context.
  if (root) doc.settings.direction = root.direction === 'down' ? 'DOWN' : 'RIGHT';
  if (root?.engine)
    Object.assign(doc.settings, { algorithm: root.engine.algorithm }, root.engine.params);
  if (view.camera) doc.camera = { ...view.camera };
  if (view.theme) doc.theme = view.theme;
  return doc;
}

/**
 * The declared reading direction for an edge: the root layout's `direction`, when the root layout
 * places both ends. Ends that share a group arranged by its own recipe (a layout line, or the
 * default column under a recipe root) read by that group's arrangement, so they get none.
 */
function readingDirections(scene: Scene) {
  const layouts = scene.model.layouts,
    root = layouts.find(l => l.scope === 'root');
  const direction = root && root.direction !== 'auto' ? root.direction : undefined;
  const chain = (id: string) => {
    const list: string[] = [];
    for (let p = scene.byId.get(id)?.parent; p && p !== 'root'; p = scene.byId.get(p)?.parent)
      list.push(p);
    return list;
  };
  return (a: string, b: string) => {
    if (!direction) return undefined;
    const above = new Set(chain(b));
    const common = chain(a).find(p => above.has(p));
    if (!common) return direction;
    const own = layouts.some(l => l.scope === common) || !root?.engine;
    return own ? undefined : direction;
  };
}

export interface CanonicalGeometry {
  nodes: Array<{ id: string; parent: string; x: number; y: number; w: number; h: number }>;
  routes: Array<{ id: string; points: Array<{ x: number; y: number }> }>;
}

/** Rectangles for everything visible, as the canvas draws them. */
export function visibleRects(doc: Diagram) {
  const vg = visibleGraph(doc),
    geometry = makeGeometry(doc),
    rects = new Map<string, Rect>();
  for (const n of vg.nodes) rects.set(n.id, { ...geometry(n.id) });
  for (const g of vg.groups) rects.set(g.id, frameRect(doc, geometry, g.id));
  return { vg, rects };
}

/**
 * Node rectangles and route points for a projected document. Edge label positions are left out:
 * the browser measures label text with real fonts, which Node cannot reproduce.
 */
export function canonicalGeometry(doc: Diagram): CanonicalGeometry {
  const { vg, rects } = visibleRects(doc);
  const { routes } = computeRoutes(doc, vg, rects, { previous: [] });
  return measured(doc, rects, routes);
}

export function measured(
  doc: Diagram,
  rects: Map<string, Rect>,
  routes: Array<{ id: string; points: Array<{ x: number; y: number }> }>,
): CanonicalGeometry {
  const parent = new Map(
    [...doc.graph.nodes, ...doc.graph.groups].map(o => [o.id, o.parentId ?? 'root']),
  );
  return {
    nodes: [...rects]
      .map(([id, r]) => ({ id, parent: parent.get(id)!, x: r.x, y: r.y, w: r.w, h: r.h }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    routes: routes
      .map(r => ({ id: r.id, points: r.points.map(p => ({ x: p.x, y: p.y })) }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}
