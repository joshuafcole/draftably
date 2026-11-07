/**
 * Document edits. Every function mutates the diagram it is given, so callers run them inside
 * a store transaction (see `state/document.ts`), which records a single undo step.
 */
import { LayoutLab } from '../engines/layout-engine.js';
import { clamp, clone, center, inside, overlaps, rectUnion, rounded } from './geometry';
import { emptyDiagram, normalize, uid } from './document';
import { placeOf } from './route-marks';
import {
  ancestors,
  CONTAINER_HEADER,
  childrenOf,
  descendants,
  findEdge,
  findGroup,
  findNode,
  findObject,
  frameRect,
  inheritedDirection,
  isCollapsed,
  isGroup,
  isHiddenByCollapse,
  makeGeometry,
  objectRect,
  styleOf,
} from './graph';
import { nodeLabel, visualBounds } from './labels';
import { defaultShapeSize } from './styles';
import type {
  ContainerLayout,
  Diagram,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  EdgeLayout,
  IntentPlacement,
  IntentRole,
  NodeLayout,
  NodeStyle,
  Point,
  PortSide,
  Rect,
  Side,
} from './types';

const geometryOf = (doc: Diagram) => makeGeometry(doc);
const rectOf = (doc: Diagram, id: string) => objectRect(doc, geometryOf(doc), id);

export function moveObject(doc: Diagram, id: string, dx: number, dy: number, manual = false) {
  for (const target of [id, ...(isGroup(doc, id) ? descendants(doc, id) : [])]) {
    const p = doc.layout.nodes[target];
    if (p) {
      p.x = rounded(p.x + dx);
      p.y = rounded(p.y + dy);
    }
  }
  if (manual && doc.layout.nodes[id]) doc.layout.nodes[id].manual = true;
}

/** Bounds of a container's direct children, including shape labels. */
export function contentBounds(doc: Diagram, id: string): Rect | null {
  const geometry = geometryOf(doc);
  const rects = childrenOf(doc, id).map(n =>
    isGroup(doc, n.id)
      ? frameRect(doc, geometry, n.id)
      : visualBounds(doc, n.id, n.title, geometry(n.id)),
  );
  return rects.length ? rectUnion(rects) : null;
}

export const containerPadding = (doc: Diagram, id: string) =>
  doc.layout.containers[id]?.padding || 24;

/** Size a container around its contents. Without `shrink`, the frame only grows. */
export function fitContainer(doc: Diagram, id: string, shrink = true) {
  const b = contentBounds(doc, id);
  if (!b) return;
  const pad = containerPadding(doc, id),
    r = doc.layout.nodes[id];
  const next = {
    x: b.x - pad,
    y: b.y - pad - CONTAINER_HEADER,
    w: Math.max(180, b.w + pad * 2),
    h: Math.max(120, b.h + pad * 2 + CONTAINER_HEADER),
  };
  Object.assign(r, shrink ? next : rectUnion([r, next]));
}

/** Grow every enclosing container so the object stays inside. */
export function ensureParentsFit(doc: Diagram, id: string) {
  for (const p of ancestors(doc, id)) fitContainer(doc, p, false);
}

/** The deepest, smallest visible container under the center of `rect`. */
export function dropTarget(
  doc: Diagram,
  id: string,
  rect: Rect,
  frames?: Map<string, Rect>,
): DiagramGroup | undefined {
  const excluded = new Set([id, ...(id && isGroup(doc, id) ? descendants(doc, id) : [])]),
    p = center(rect),
    geometry = geometryOf(doc),
    frame = (gid: string) => frames?.get(gid) || frameRect(doc, geometry, gid);
  return doc.graph.groups
    .filter(
      g =>
        !excluded.has(g.id) &&
        !isCollapsed(doc, g.id) &&
        !isHiddenByCollapse(doc, g.id) &&
        inside(p, frame(g.id)),
    )
    .sort((a, b) => {
      const ra = frameRect(doc, geometry, a.id),
        rb = frameRect(doc, geometry, b.id);
      return ancestors(doc, b.id).length - ancestors(doc, a.id).length || ra.w * ra.h - rb.w * rb.h;
    })[0];
}

export type ResizeHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

/**
 * Resize from a handle. Containers cannot shrink across their contents, and their children
 * stay at the same world coordinates.
 */
export function resizedRect(
  doc: Diagram,
  id: string,
  start: NodeLayout,
  dx: number,
  dy: number,
  handle: ResizeHandle,
  keepAspect = false,
): NodeLayout {
  let left = start.x,
    top = start.y,
    right = start.x + start.w,
    bottom = start.y + start.h;
  if (handle.includes('w')) left += dx;
  if (handle.includes('e')) right += dx;
  if (handle.includes('n')) top += dy;
  if (handle.includes('s')) bottom += dy;
  const container = isGroup(doc, id),
    minW = container ? 180 : 40,
    minH = container ? 100 : 28;
  if (keepAspect && !container) bottom = top + (right - left) * (start.h / start.w);
  if (right - left < minW) {
    if (handle.includes('w')) left = right - minW;
    else right = left + minW;
  }
  if (bottom - top < minH) {
    if (handle.includes('n')) top = bottom - minH;
    else bottom = top + minH;
  }
  if (container) {
    const b = contentBounds(doc, id),
      pad = containerPadding(doc, id);
    if (b) {
      left = Math.min(left, b.x - pad);
      top = Math.min(top, b.y - pad - CONTAINER_HEADER);
      right = Math.max(right, b.x + b.w + pad);
      bottom = Math.max(bottom, b.y + b.h + pad);
    }
  }
  return {
    ...start,
    x: rounded(left),
    y: rounded(top),
    w: rounded(right - left),
    h: rounded(bottom - top),
  };
}

export interface NewNode {
  id?: string;
  title?: string;
  parentId?: string | null;
  image?: string;
  style?: Partial<NodeStyle>;
  /** Top-left corner; defaults to centering the shape on `at`. */
  position?: Point;
  w?: number;
  h?: number;
}

export function addNode(doc: Diagram, partial: NewNode, at: Point): string {
  const id = partial.id || uid('n');
  if (findObject(doc, id) || findEdge(doc, id)) throw Error('ID already exists: ' + id);
  if (partial.parentId && !findGroup(doc, partial.parentId))
    throw Error('Container does not exist.');
  const shape = partial.style?.shape || 'box',
    size = defaultShapeSize(shape),
    w = partial.w || size.w,
    h = partial.h || size.h;
  doc.graph.nodes.push({
    id,
    title: partial.title || 'New box',
    ...(partial.parentId ? { parentId: partial.parentId } : {}),
    ...(partial.image ? { image: partial.image } : {}),
  });
  doc.layout.nodes[id] = {
    x: rounded(partial.position?.x ?? at.x - w / 2),
    y: rounded(partial.position?.y ?? at.y - h / 2),
    w,
    h,
    manual: false,
    pinned: false,
  };
  doc.styles[id] = { shape, color: 'auto', icon: '', ...partial.style };
  if (partial.parentId) ensureParentsFit(doc, id);
  return id;
}

export interface NewEdge {
  id?: string;
  from: string;
  to: string;
  label?: string;
  directed?: boolean;
  emphasis?: boolean;
  dashed?: boolean;
  fromSide?: PortSide;
  toSide?: PortSide;
}

export function addEdge(doc: Diagram, partial: NewEdge): string {
  if (!findNode(doc, partial.from) || !findNode(doc, partial.to))
    throw Error('Both endpoints must exist.');
  const id = partial.id || uid('e');
  if (findObject(doc, id) || findEdge(doc, id)) throw Error('ID already exists: ' + id);
  doc.graph.edges.push({
    id,
    from: partial.from,
    to: partial.to,
    label: partial.label || '',
    directed: partial.directed !== false,
    emphasis: !!partial.emphasis,
    dashed: !!partial.dashed,
  });
  doc.layout.edges[id] = { fromSide: partial.fromSide || 'auto', toSide: partial.toSide || 'auto' };
  return id;
}

/** Nearest spot to `rect` that does not overlap existing objects. Existing objects never move. */
function freePosition(
  doc: Diagram,
  rect: Rect,
  parentId: string | null,
  side: Side,
  ignored: string[] = [],
): Rect {
  const excluded = new Set([parentId, ...(parentId ? ancestors(doc, parentId) : []), ...ignored]);
  const occupied = [...doc.graph.nodes, ...doc.graph.groups]
    .filter(
      n =>
        !excluded.has(n.id) &&
        !ancestors(doc, n.id).some(a => excluded.has(a) && ignored.includes(a)),
    )
    .map(n => rectOf(doc, n.id));
  const gap = doc.settings.nodeGap,
    alongY = side === 'left' || side === 'right';
  for (let i = 0; i < 140; i++) {
    const sign = i % 2 ? 1 : -1,
      step = Math.ceil(i / 2);
    const r = {
      ...rect,
      x: rect.x + (alongY ? 0 : sign * step * (rect.w + gap)),
      y: rect.y + (alongY ? sign * step * (rect.h + gap) : 0),
    };
    if (!occupied.some(o => overlaps(r, o, 12))) return r;
  }
  return { ...rect, y: rect.y + 140 * (rect.h + gap) };
}

export interface ConnectedNode {
  /** Connect from this shape. */
  from?: string | null;
  /** Create a sibling branch: connect from every source of this shape. */
  siblingOf?: string | null;
  side?: Side | null;
  /** Center of the new shape; otherwise it is placed beside the reference shape. */
  at?: Point | null;
  title?: string;
  /** Container for the new shape; `undefined` inherits the reference shape's container. */
  parentId?: string | null;
  style?: Partial<NodeStyle>;
}

/** Add a shape next to another one and connect it. `fallback` is used when nothing is referenced. */
export function addConnectedNode(doc: Diagram, options: ConnectedNode, fallback: Point): string {
  const { from = null, siblingOf = null, at = null, title = 'Next step', style } = options;
  const reference = findNode(doc, siblingOf || from),
    direction = reference ? inheritedDirection(doc, reference.id) : doc.settings.direction;
  const side: Side = options.side || (direction === 'DOWN' ? 'bottom' : 'right');
  const w = 164,
    h = 56,
    r = reference ? doc.layout.nodes[reference.id] : null,
    gap = Math.max(40, doc.settings.rankGap);
  let x = at ? at.x - w / 2 : r ? r.x + r.w + gap : fallback.x - w / 2,
    y = at ? at.y - h / 2 : r ? r.y + (r.h - h) / 2 : fallback.y - h / 2;
  if (r && !at) {
    if (side === 'left') x = r.x - gap - w;
    if (side === 'bottom' || side === 'top') {
      x = r.x + (r.w - w) / 2;
      y = side === 'bottom' ? r.y + r.h + gap : r.y - gap - h;
    }
    if (siblingOf) {
      x = r.x + (direction === 'DOWN' ? r.w + doc.settings.nodeGap : 0);
      y = r.y + (direction === 'DOWN' ? 0 : r.h + doc.settings.nodeGap);
    }
  }
  const parentId = options.parentId === undefined ? reference?.parentId || null : options.parentId;
  const pos = freePosition(doc, { x, y, w, h }, parentId, side),
    id = uid('n');
  doc.graph.nodes.push({ id, title, ...(parentId ? { parentId } : {}) });
  doc.layout.nodes[id] = { ...pos, manual: false, pinned: false };
  doc.styles[id] = {
    shape: 'box',
    color: reference ? styleOf(doc, reference.id).color : 'auto',
    icon: '',
    ...style,
  };
  const sources = siblingOf
    ? doc.graph.edges.filter(e => e.to === siblingOf && e.from !== siblingOf).map(e => e.from)
    : from
      ? [from]
      : [];
  for (const source of new Set(sources)) addEdge(doc, { from: source, to: id });
  ensureParentsFit(doc, id);
  return id;
}

/**
 * Split a connection with a new shape. `routePoints` locates the longest segment
 * when `at` is not given.
 */
export function insertStep(
  doc: Diagram,
  edgeId: string,
  routePoints: Point[] | undefined,
  at: Point | null = null,
): string | undefined {
  const edge = findEdge(doc, edgeId);
  if (!edge) return;
  const cfg = clone(doc.layout.edges[edge.id] || {});
  const longest = (routePoints || [])
    .slice(1)
    .map((b, i) => ({ a: routePoints![i], b }))
    .sort((p, q) => manhattanLength(q) - manhattanLength(p))[0];
  const target =
    at ||
    (longest
      ? { x: (longest.a.x + longest.b.x) / 2, y: (longest.a.y + longest.b.y) / 2 }
      : center(doc.layout.nodes[edge.from]));
  const toAncestors = ancestors(doc, edge.to);
  const common =
    [findNode(doc, edge.from)?.parentId, ...ancestors(doc, edge.from)].find(
      id => id && toAncestors.includes(id),
    ) || null;
  const id = addConnectedNode(
    doc,
    {
      at: target,
      parentId: common,
      title: 'New step',
      style: { color: styleOf(doc, edge.from).color },
    },
    target,
  );
  const to = edge.to,
    { head, tail: _tail, ...ends } = clone(edge);
  edge.to = id;
  delete edge.head;
  doc.layout.edges[edge.id] = { fromSide: cfg.fromSide || 'auto', toSide: 'auto' };
  const second = uid('e');
  // The tail stays at the source and the head stays at the target.
  doc.graph.edges.push({
    ...ends,
    ...(head ? { head } : {}),
    id: second,
    from: id,
    to,
    label: '',
  });
  doc.layout.edges[second] = { fromSide: 'auto', toSide: cfg.toSide || 'auto' };
  return id;
}

const manhattanLength = ({ a, b }: { a: Point; b: Point }) =>
  Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export type BuildMode = 'chain' | 'branches' | 'none';

export interface BuildOptions {
  mode?: BuildMode;
  /** Wrap the new shapes in a container with this title. */
  title?: string;
  /** Continue from this shape. */
  source?: string | null;
  parentId?: string | null;
  /** Where to start when there is no source or container. */
  origin: Point;
  columns: number;
}

/** Create shapes from a list of titles. Returns the ids to select. */
export function buildFromList(doc: Diagram, lines: string[], options: BuildOptions): string[] {
  const { mode = 'chain', title = '', source = null, origin, columns } = options;
  if (
    !Array.isArray(lines) ||
    lines.length < 1 ||
    lines.length > 60 ||
    lines.some(s => typeof s !== 'string' || !s.trim())
  )
    throw Error('Provide 1–60 nonempty titles.');
  if (!['chain', 'branches', 'none'].includes(mode)) throw Error('Unknown quick-build mode.');
  if ((source && !findNode(doc, source)) || (options.parentId && !findGroup(doc, options.parentId)))
    throw Error('Quick-build context no longer exists.');
  const parentId = options.parentId || findNode(doc, source)?.parentId || null;
  const start = source ? doc.layout.nodes[source] : null,
    frame = parentId ? doc.layout.nodes[parentId] : null;
  const base = {
    x: start ? start.x + start.w + 52 : frame ? frame.x + 24 : origin.x - 164,
    y: start ? start.y : frame ? frame.y + 56 : origin.y - 80,
  };
  const ids: string[] = [];
  for (const [i, line] of lines.entries()) {
    const from =
      mode === 'chain' ? ids.at(-1) || source : mode === 'branches' ? source || ids[0] : null;
    const at = {
      x: base.x + (i % columns) * 224 + 82,
      y: base.y + Math.floor(i / columns) * 156 + 28,
    };
    ids.push(addConnectedNode(doc, { title: line.trim(), from, parentId, at }, at));
  }
  if (!title) return ids;
  const r = rectUnion(ids.map(id => rectOf(doc, id))),
    gid = createContainer(
      doc,
      { x: r.x - 24, y: r.y - 52, w: r.w + 48, h: r.h + 76 },
      { roots: ids, parentId, title, fit: false },
    );
  return [gid];
}

/** Remove objects and everything that refers to them. */
function removeObjects(doc: Diagram, ids: Set<string>) {
  doc.graph.edges = doc.graph.edges.filter(
    e => !ids.has(e.id) && !ids.has(e.from) && !ids.has(e.to),
  );
  doc.graph.nodes = doc.graph.nodes.filter(n => !ids.has(n.id));
  doc.graph.groups = doc.graph.groups.filter(g => !ids.has(g.id));
  const kept = new Set(
    [...doc.graph.nodes, ...doc.graph.groups, ...doc.graph.edges].map(n => n.id),
  );
  for (const key of ['nodes', 'edges', 'labels', 'containers'] as const)
    for (const id of Object.keys(doc.layout[key])) if (!kept.has(id)) delete doc.layout[key][id];
  for (const id of Object.keys(doc.styles)) if (!kept.has(id)) delete doc.styles[id];
  doc.collapsed = doc.collapsed.filter(id => kept.has(id));
  for (const role of ['start', 'end'] as const)
    if (doc.layout.intent[role] && !kept.has(doc.layout.intent[role]!.id))
      delete doc.layout.intent[role];
}

function reparent(n: DiagramNode | DiagramGroup, parentId: string | null | undefined) {
  if (parentId) n.parentId = parentId;
  else delete n.parentId;
}

/** Delete objects. Containers release their contents unless `deep` is set. */
export function deleteObjects(doc: Diagram, selected: Iterable<string>, deep = false) {
  const ids = new Set(selected);
  for (const id of [...ids]) {
    const group = findGroup(doc, id);
    if (!group) continue;
    if (deep) descendants(doc, id).forEach(n => ids.add(n));
    else childrenOf(doc, id).forEach(n => reparent(n, group.parentId));
  }
  removeObjects(doc, ids);
}

export function createContainer(
  doc: Diagram,
  rect: Rect,
  {
    roots = [],
    parentId = null,
    title = 'Container',
    fit = true,
  }: { roots?: string[]; parentId?: string | null; title?: string; fit?: boolean } = {},
): string {
  const id = uid('g');
  doc.graph.groups.push({ id, title, ...(parentId ? { parentId } : {}) });
  doc.layout.nodes[id] = { ...rect, manual: false, pinned: false };
  doc.layout.containers[id] = { direction: 'inherit', padding: 24, manualSize: true };
  doc.styles[id] = { shape: 'box', color: 'auto', icon: '' };
  for (const root of roots) {
    const n = findObject(doc, root);
    if (n) n.parentId = id;
  }
  if (fit) fitContainer(doc, id, false);
  ensureParentsFit(doc, id);
  return id;
}

/** Wrap the selected objects in a new container, or add an empty one at `fallback`. */
export function wrapInContainer(doc: Diagram, roots: string[], fallback: Point): string {
  if (!roots.length)
    return createContainer(doc, { x: fallback.x - 170, y: fallback.y - 120, w: 340, h: 240 });
  const b = rectUnion(roots.map(id => rectOf(doc, id))),
    parents = [...new Set(roots.map(id => findObject(doc, id)?.parentId || null))];
  return createContainer(
    doc,
    { x: b.x - 28, y: b.y - 56, w: b.w + 56, h: b.h + 84 },
    { roots, parentId: parents.length === 1 ? parents[0] : null },
  );
}

/** Draw a container: it adopts the objects it fully encloses inside the deepest enclosing container. */
export function drawContainer(doc: Diagram, r: Rect): string {
  const geometry = geometryOf(doc);
  const parent = doc.graph.groups
    .filter(g => {
      const frame = frameRect(doc, geometry, g.id);
      return inside({ x: r.x, y: r.y }, frame) && inside({ x: r.x + r.w, y: r.y + r.h }, frame);
    })
    .sort((a, b) => ancestors(doc, b.id).length - ancestors(doc, a.id).length)[0];
  const roots = childrenOf(doc, parent?.id)
    .filter(n => {
      const p = rectOf(doc, n.id);
      return inside({ x: p.x, y: p.y }, r) && inside({ x: p.x + p.w, y: p.y + p.h }, r);
    })
    .map(n => n.id);
  return createContainer(doc, r, { roots, parentId: parent?.id });
}

export function ungroup(doc: Diagram, selected: Iterable<string>) {
  const ids = new Set([...selected].filter(id => isGroup(doc, id)));
  for (const id of ids) {
    const p = findGroup(doc, id)!.parentId;
    for (const n of childrenOf(doc, id)) reparent(n, p && !ids.has(p) ? p : null);
  }
  removeObjects(doc, ids);
}

export type AlignKind = 'left' | 'top' | 'center' | 'middle' | 'distribute-x' | 'distribute-y';

export function alignObjects(doc: Diagram, ids: string[], kind: AlignKind) {
  const positions = ids.map(id => ({ id, ...rectOf(doc, id) })),
    b = rectUnion(positions);
  if (kind === 'distribute-x' || kind === 'distribute-y') {
    const axis = kind === 'distribute-x' ? 'x' : 'y',
      size = axis === 'x' ? 'w' : 'h';
    positions.sort((p, q) => p[axis] - q[axis]);
    const last = positions.at(-1)!,
      total = positions.reduce((sum, p) => sum + p[size], 0),
      span = last[axis] + last[size] - positions[0][axis],
      gap = Math.max(12, (span - total) / (positions.length - 1));
    let offset = positions[0][axis];
    for (const p of positions) {
      moveObject(doc, p.id, axis === 'x' ? offset - p.x : 0, axis === 'y' ? offset - p.y : 0, true);
      offset += p[size] + gap;
    }
    return;
  }
  for (const p of positions) {
    const dx = kind === 'left' ? b.x - p.x : kind === 'center' ? b.x + b.w / 2 - p.x - p.w / 2 : 0,
      dy = kind === 'top' ? b.y - p.y : kind === 'middle' ? b.y + b.h / 2 - p.y - p.h / 2 : 0;
    moveObject(doc, p.id, dx, dy, true);
    ensureParentsFit(doc, p.id);
  }
}

export function nudge(doc: Diagram, ids: string[], dx: number, dy: number) {
  for (const id of ids) {
    moveObject(doc, id, dx, dy, true);
    ensureParentsFit(doc, id);
  }
}

export function toggleCollapsed(doc: Diagram, id: string) {
  const index = doc.collapsed.indexOf(id);
  if (index < 0) doc.collapsed.push(id);
  else doc.collapsed.splice(index, 1);
}

export function setTitle(doc: Diagram, id: string, title: string) {
  const n = findObject(doc, id);
  if (!n) return;
  n.title = title.trim() || 'Untitled';
  if (!findNode(doc, id)) return;
  // Grow a shape so a centered label still fits inside it.
  const p = doc.layout.nodes[id],
    label = nodeLabel(doc, id, n.title, p);
  if (label.mode === 'center' && label.height + 20 > p.h) p.h = label.height + 20;
  ensureParentsFit(doc, id);
}

export function setEdgeLabel(doc: Diagram, id: string, label: string) {
  const e = findEdge(doc, id);
  if (e) e.label = label.trim();
}

export function setGeometry(doc: Diagram, id: string, key: 'x' | 'y' | 'w' | 'h', value: number) {
  const p = doc.layout.nodes[id];
  if (!p) return;
  if (key === 'x' || key === 'y') {
    moveObject(doc, id, key === 'x' ? value - p.x : 0, key === 'y' ? value - p.y : 0, true);
  } else {
    Object.assign(
      p,
      resizedRect(doc, id, p, key === 'w' ? value - p.w : 0, key === 'h' ? value - p.h : 0, 'se'),
    );
    if (isGroup(doc, id)) doc.layout.containers[id].manualSize = true;
  }
  ensureParentsFit(doc, id);
}

export function setStyle(doc: Diagram, id: string, patch: Partial<NodeStyle>) {
  const style = (doc.styles[id] ||= { shape: 'box', color: 'auto', icon: '' });
  Object.assign(style, patch);
  const p = doc.layout.nodes[id];
  if (patch.shape === 'icon') {
    style.icon ||= 'user';
    p.w = 80;
    p.h = 80;
  }
  if (patch.shape === 'diamond') {
    p.w = p.h = Math.max(p.w, p.h, 112);
  }
}

export function setLabelMode(
  doc: Diagram,
  id: string,
  mode: NonNullable<Diagram['layout']['labels'][string]['mode']>,
) {
  const cfg = (doc.layout.labels[id] ||= {});
  cfg.mode = mode;
  cfg.dx = 0;
  cfg.dy = 0;
  if (mode === 'detached') {
    cfg.dx = 130;
    cfg.dy = -60;
    cfg.leader = true;
  }
}

export function setParent(doc: Diagram, id: string, parentId: string | null) {
  const n = findObject(doc, id);
  if (!n) return;
  reparent(n, parentId);
  ensureParentsFit(doc, id);
}

export function setContainer(doc: Diagram, id: string, patch: Partial<ContainerLayout>) {
  const cfg = doc.layout.containers[id];
  if (!cfg) return;
  if (patch.direction) cfg.direction = patch.direction;
  if (patch.padding !== undefined) cfg.padding = clamp(Number(patch.padding), 12, 80);
}

export function setEdge(
  doc: Diagram,
  id: string,
  patch: Partial<Pick<DiagramEdge, 'directed' | 'dashed' | 'emphasis' | 'head' | 'tail'>>,
) {
  const e = findEdge(doc, id);
  if (!e) return;
  Object.assign(e, patch);
  // Only a directed edge has marks to write, and a default end stays unwritten.
  if (!e.directed || e.head === 'arrow') delete e.head;
  if (!e.directed || e.tail === 'none') delete e.tail;
}

export function setEdgeLayout(doc: Diagram, id: string, patch: Partial<EdgeLayout>) {
  Object.assign((doc.layout.edges[id] ||= {}), patch);
}

export function reverseEdge(doc: Diagram, id: string) {
  const e = findEdge(doc, id);
  if (!e) return;
  [e.from, e.to] = [e.to, e.from];
  const cfg = (doc.layout.edges[id] ||= {});
  [cfg.fromSide, cfg.toSide] = [cfg.toSide || 'auto', cfg.fromSide || 'auto'];
  cfg.waypoints?.reverse();
}

export function useAutomaticPorts(doc: Diagram, edgeIds: string[]) {
  for (const id of edgeIds) setEdgeLayout(doc, id, { fromSide: 'auto', toSide: 'auto' });
}

/** True when the point is too close to a shape to hold a connection bend. */
export const bendInsideShape = (doc: Diagram, p: Point) =>
  doc.graph.nodes.some(n => inside(p, doc.layout.nodes[n.id], 4));

/**
 * Add a bend at `p`. Given the line as drawn, the bend goes between the bends either side of where
 * `p` falls along it, so the line still runs through them in order; otherwise it goes last.
 */
export function addWaypoint(doc: Diagram, id: string, p: Point, drawn?: readonly Point[]) {
  const cfg = (doc.layout.edges[id] ||= {}),
    list = (cfg.waypoints ||= []),
    bend = { x: rounded(p.x), y: rounded(p.y) };
  if (!drawn || drawn.length < 2 || !list.length) return void list.push(bend);
  const along = (q: Point) => placeOf(drawn, q).at,
    at = along(bend),
    index = list.findIndex(w => along(w) > at);
  list.splice(index < 0 ? list.length : index, 0, bend);
}

export function removeWaypoint(doc: Diagram, id: string, index: number) {
  doc.layout.edges[id]?.waypoints?.splice(index, 1);
}

export const INTENT_LABELS: Record<IntentPlacement, string> = {
  'top-left': 'Top left',
  'left-center': 'Left center',
  center: 'Center · branch both ways',
  'top-center': 'Top center',
  'top-right': 'Top right',
  'right-center': 'Right center',
  'bottom-left': 'Bottom left',
  'bottom-center': 'Bottom center',
  'bottom-right': 'Bottom right',
};

/** Placements offered for a role; only a start can sit in the center. */
export const intentPlacements = (role: IntentRole) =>
  (Object.keys(INTENT_LABELS) as IntentPlacement[]).filter(
    key => role === 'start' || key !== 'center',
  );

/** Mark a shape as the preferred start or end, or clear the role when `id` is null. */
export function setIntent(
  doc: Diagram,
  role: IntentRole,
  id: string | null,
  placement?: IntentPlacement,
) {
  if (id && !findNode(doc, id))
    throw Error('Choose a shape for layout intent, not an edge or container.');
  const next = clone(doc.layout.intent || {});
  if (!id) delete next[role];
  else {
    const other = role === 'start' ? 'end' : 'start';
    if (next[other]?.id === id) delete next[other];
    next[role] = {
      id,
      placement:
        placement || next[role]?.placement || (role === 'start' ? 'top-left' : 'bottom-right'),
    };
  }
  doc.layout.intent = LayoutLab.normalizeIntent(next, new Set(doc.graph.nodes.map(n => n.id)));
}

// --- Clipboard -------------------------------------------------------------------------------

export interface ClipboardFragment {
  kind: 'diagram-studio/clipboard';
  nodes: DiagramNode[];
  groups: DiagramGroup[];
  edges: DiagramEdge[];
  layout: Partial<Record<'nodes' | 'edges' | 'labels' | 'containers', Record<string, unknown>>>;
  styles: Record<string, NodeStyle>;
}

/** Copy the selection, including container contents and connections between copied shapes. */
export function copyFragment(doc: Diagram, selected: Iterable<string>): ClipboardFragment {
  const ids = new Set(selected);
  for (const id of [...ids]) if (isGroup(doc, id)) descendants(doc, id).forEach(n => ids.add(n));
  const edges = doc.graph.edges.filter(e => ids.has(e.id) || (ids.has(e.from) && ids.has(e.to)));
  edges.forEach(e => ids.add(e.id));
  const pick = <T>(record: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(record)
        .filter(([id]) => ids.has(id))
        .map(([id, v]) => [id, clone(v)]),
    );
  return {
    kind: 'diagram-studio/clipboard',
    nodes: clone(doc.graph.nodes.filter(n => ids.has(n.id))),
    groups: clone(doc.graph.groups.filter(g => ids.has(g.id))),
    edges: clone(edges),
    layout: {
      nodes: pick(doc.layout.nodes),
      edges: pick(doc.layout.edges),
      labels: pick(doc.layout.labels),
      containers: pick(doc.layout.containers),
    },
    styles: pick(doc.styles),
  };
}

export const isClipboardFragment = (value: unknown): value is ClipboardFragment =>
  (value as ClipboardFragment)?.kind === 'diagram-studio/clipboard';

/**
 * Return a validated document with the fragment pasted at an offset, plus the new ids to select.
 * The fragment is untrusted, so the whole result goes through `normalize`.
 */
export function pasteFragment(doc: Diagram, part: ClipboardFragment) {
  const ids = new Map<string, string>();
  for (const n of part.nodes) ids.set(n.id, uid('n'));
  for (const g of part.groups) ids.set(g.id, uid('g'));
  for (const e of part.edges) ids.set(e.id, uid('e'));
  const candidate = clone(doc),
    selected: string[] = [];
  const existingGroup = (id?: string) => candidate.graph.groups.some(g => g.id === id);
  for (const n of part.nodes) {
    const next = { ...clone(n), id: ids.get(n.id)! };
    next.parentId = ids.get(n.parentId!) || (existingGroup(n.parentId) ? n.parentId : undefined);
    candidate.graph.nodes.push(next);
    selected.push(next.id);
  }
  for (const g of part.groups) {
    const next = { ...clone(g), id: ids.get(g.id)! };
    next.parentId = ids.get(g.parentId!) || (existingGroup(g.parentId) ? g.parentId : undefined);
    candidate.graph.groups.push(next);
    selected.push(next.id);
  }
  const pastedEdges: string[] = [];
  for (const e of part.edges) {
    const from = ids.get(e.from) || e.from,
      to = ids.get(e.to) || e.to;
    if (
      !candidate.graph.nodes.some(n => n.id === from) ||
      !candidate.graph.nodes.some(n => n.id === to)
    )
      continue;
    candidate.graph.edges.push({ ...clone(e), id: ids.get(e.id)!, from, to });
    pastedEdges.push(ids.get(e.id)!);
  }
  const offset = 32;
  for (const [oldId, newId] of ids) {
    for (const key of ['nodes', 'edges', 'labels', 'containers'] as const) {
      const value = part.layout?.[key]?.[oldId];
      if (!value) continue;
      const copy = clone(value) as NodeLayout & EdgeLayout;
      if (key === 'nodes') {
        copy.x += offset;
        copy.y += offset;
        copy.pinned = false;
        copy.manual = true;
      }
      if (key === 'edges' && copy.waypoints)
        copy.waypoints = copy.waypoints.map(p => ({ x: p.x + offset, y: p.y + offset }));
      (candidate.layout[key] as Record<string, unknown>)[newId] = copy;
    }
    if (part.styles?.[oldId]) candidate.styles[newId] = clone(part.styles[oldId]);
  }
  return { doc: normalize(candidate), selected: selected.length ? selected : pastedEdges };
}

export { emptyDiagram };
