import type {
  Diagram,
  DiagramEdge,
  DiagramGroup,
  DiagramNode,
  Direction,
  Entity,
  NodeLayout,
  NodeStyle,
  Rect,
} from './types';
import { resolveAppearance } from './appearance';
import { DEFAULT_STYLE } from './styles';

export const findNode = (doc: Diagram, id: string | null | undefined): DiagramNode | undefined =>
  id ? doc.graph.nodes.find(n => n.id === id) : undefined;
export const findGroup = (doc: Diagram, id: string | null | undefined): DiagramGroup | undefined =>
  id ? doc.graph.groups.find(g => g.id === id) : undefined;
export const findEdge = (doc: Diagram, id: string | null | undefined): DiagramEdge | undefined =>
  id ? doc.graph.edges.find(e => e.id === id) : undefined;
export const findObject = (doc: Diagram, id: string | null | undefined) =>
  findNode(doc, id) ?? findGroup(doc, id);
export const findEntity = (doc: Diagram, id: string | null | undefined): Entity | undefined =>
  findNode(doc, id) ?? findGroup(doc, id) ?? findEdge(doc, id);

export const isNode = (doc: Diagram, id: string) => !!findNode(doc, id);
export const isGroup = (doc: Diagram, id: string) => !!findGroup(doc, id);
export const isEdge = (doc: Diagram, id: string) => !!findEdge(doc, id);

export const styleOf = (doc: Diagram, id: string): NodeStyle => ({
  ...DEFAULT_STYLE,
  ...doc.styles[id],
});

/** Direct children (shapes and containers) of a container, or of the diagram root. */
/** The title band of a `cells` group; undefined for any other group. */
export const cellsBandOf = (doc: Diagram, id: string | null | undefined) =>
  id ? doc.layout.containers[id]?.cellsBand : undefined;

/** Whether a cell is a field of variable length in a byte or bit layout. */
export const isOpenCell = (doc: Diagram, id: string) =>
  !!doc.layout.containers[findNode(doc, id)?.parentId ?? '']?.cellsChrome?.open?.includes(id);

/** Whether a node is a cell of a `cells` group, which holds it in place edge to edge. */
export const isCell = (doc: Diagram, id: string) =>
  cellsBandOf(doc, findNode(doc, id)?.parentId) !== undefined;

export function childrenOf(doc: Diagram, parentId: string | null | undefined) {
  const parent = parentId || null;
  return [...doc.graph.groups, ...doc.graph.nodes].filter(n => (n.parentId || null) === parent);
}

export function descendants(doc: Diagram, id: string): string[] {
  const result: string[] = [];
  const walk = (parent: string) => {
    for (const child of childrenOf(doc, parent)) {
      result.push(child.id);
      if (isGroup(doc, child.id)) walk(child.id);
    }
  };
  walk(id);
  return result;
}

/** Containers enclosing an object, nearest first. */
export function ancestors(doc: Diagram, id: string): string[] {
  const out: string[] = [];
  for (let p = findObject(doc, id)?.parentId; p; p = findGroup(doc, p)?.parentId) out.push(p);
  return out;
}

export const isCollapsed = (doc: Diagram, id: string) => doc.collapsed.includes(id);

export const isHiddenByCollapse = (doc: Diagram, id: string) =>
  ancestors(doc, id).some(a => isCollapsed(doc, a));

/** The visible object that stands in for `id`: its outermost collapsed container, if any. */
export function visibleProxy(doc: Diagram, id: string) {
  let proxy = id;
  for (const a of ancestors(doc, id)) if (isCollapsed(doc, a)) proxy = a;
  return proxy;
}

export interface VisibleEdge extends DiagramEdge {
  /** Visible source, which may be a collapsed container. */
  a: string;
  /** Visible target, which may be a collapsed container. */
  b: string;
}

export interface VisibleGraph {
  nodes: DiagramNode[];
  groups: DiagramGroup[];
  edges: VisibleEdge[];
}

/** Objects and connections that are not hidden inside a collapsed container. */
export function visibleGraph(doc: Diagram): VisibleGraph {
  const nodes = doc.graph.nodes.filter(n => visibleProxy(doc, n.id) === n.id);
  const groups = doc.graph.groups
    .filter(g => !isHiddenByCollapse(doc, g.id))
    .sort((a, b) => ancestors(doc, a.id).length - ancestors(doc, b.id).length);
  const edges = doc.graph.edges
    .map(e => ({ ...e, a: visibleProxy(doc, e.from), b: visibleProxy(doc, e.to) }))
    .filter(e => e.a !== e.b || e.from === e.to);
  return { nodes, groups, edges };
}

/** Selected shapes and containers whose own container is not also selected. */
export function selectionRoots(doc: Diagram, selected: Iterable<string>) {
  const set = new Set(selected);
  return [...set].filter(id => findObject(doc, id) && !ancestors(doc, id).some(a => set.has(a)));
}

/** Layout direction for the contents of an object's container. */
export function inheritedDirection(doc: Diagram, id: string): Direction {
  for (const p of [id, ...ancestors(doc, id)]) {
    const direction = doc.layout.containers[p]?.direction;
    if (direction && direction !== 'inherit') return direction;
  }
  return doc.settings.direction;
}

export const COLLAPSED_HEIGHT = 58;
export const CONTAINER_HEADER = 28;

/** Read geometry for an object, preferring a temporary override (preview, animation, brush). */
export type GeometryLookup = (id: string) => NodeLayout;

export function makeGeometry(doc: Diagram, override?: Record<string, NodeLayout> | null) {
  return (id: string): NodeLayout =>
    override?.[id] ?? doc.layout.nodes[id] ?? { x: 0, y: 0, w: 176, h: 68 };
}

/**
 * Container frame as drawn: collapsed containers shrink to their title band plus a line for the
 * shape count, so the title stays where it was in the open frame.
 */
export function frameRect(doc: Diagram, geometry: GeometryLookup, id: string): NodeLayout {
  const r = { ...geometry(id) };
  if (isCollapsed(doc, id)) {
    r.w = Math.min(r.w, 210);
    r.h = Math.max(COLLAPSED_HEIGHT, resolveAppearance(doc.appearance).groupHeader + 10);
  }
  return r;
}

export const objectRect = (doc: Diagram, geometry: GeometryLookup, id: string): Rect =>
  isGroup(doc, id) ? frameRect(doc, geometry, id) : geometry(id);

/**
 * An object's box before a change (`was-at=`, `was-size=`), from its box now, or undefined when
 * it has neither.
 */
export function pastRect(doc: Diagram, id: string, now: Rect): Rect | undefined {
  const o = findNode(doc, id) ?? findGroup(doc, id),
    at = o?.wasAt,
    size = o && 'wasSize' in o ? o.wasSize : undefined;
  if (!at && !size) return undefined;
  return { x: at?.x ?? now.x, y: at?.y ?? now.y, w: size?.w ?? now.w, h: size?.h ?? now.h };
}
