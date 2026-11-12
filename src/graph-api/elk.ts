/**
 * ELK JSON in, ELK JSON out, so `new DraftablyELK().layout(graph)` can stand in for
 * `new ELK().layout(graph)` from elkjs. A node with children is a group. Coordinates come back as
 * elkjs gives them: a node's x and y relative to its parent; an edge's sections and labels relative
 * to its `container`, the nearest node that holds both of its ends, which is set on each edge.
 */
import { layout, type EdgeIn, type GraphIn, type LayoutResult } from './core';
import { mirrored, shifted } from './transform';
import type { Side } from '../model/types';

export interface ElkLabel {
  id?: string;
  text?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface ElkPort {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
}

export interface ElkPoint {
  x: number;
  y: number;
}

export interface ElkEdgeSection {
  id: string;
  startPoint: ElkPoint;
  endPoint: ElkPoint;
  bendPoints?: ElkPoint[];
  incomingShape?: string;
  outgoingShape?: string;
}

export interface ElkEdge {
  id: string;
  sources: string[];
  targets: string[];
  labels?: ElkLabel[];
  sections?: ElkEdgeSection[];
  container?: string;
  layoutOptions?: Record<string, string>;
}

export interface ElkNode {
  id: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  children?: ElkNode[];
  ports?: ElkPort[];
  edges?: ElkEdge[];
  labels?: ElkLabel[];
  layoutOptions?: Record<string, string>;
}

/** An ELK option by its short or full key: `elk.direction`, `org.eclipse.elk.direction`, `direction`. */
function option(o: Record<string, string> | undefined, key: string) {
  return o?.[`elk.${key}`] ?? o?.[`org.eclipse.elk.${key}`] ?? o?.[key];
}
const keyOf = (k: string) => k.replace(/^(org\.eclipse\.)?elk\./, '');

/** Options that the adapter reads, or that draftably always honours. */
const KNOWN = new Set([
  'algorithm',
  'direction',
  'spacing.nodeNode',
  'layered.spacing.nodeNodeBetweenLayers',
  'port.side',
  'hierarchyHandling',
  'edgeRouting',
  'portConstraints',
  'nodeSize.constraints',
  'nodeLabels.placement',
]);

const PORT_SIDES: Record<string, Side> = {
  NORTH: 'top',
  SOUTH: 'bottom',
  EAST: 'right',
  WEST: 'left',
};

export interface ElkInput {
  graph: GraphIn;
  warnings: string[];
  /** For each ELK edge, the IDs of its pieces: one per source and target pair. */
  pieces: Map<string, string[]>;
  /** Whether the drawing is mirrored afterwards, for `LEFT` and `UP`. */
  mirror?: 'x' | 'y';
}

export function fromElk(root: ElkNode, extra?: Record<string, string>): ElkInput {
  const nodes: GraphIn['nodes'] = [],
    groups: NonNullable<GraphIn['groups']> = [],
    edges: EdgeIn[] = [],
    warnings: string[] = [],
    unknown = new Set<string>(),
    ports = new Map<string, { node: string; side?: Side }>(),
    pieces = new Map<string, string[]>(),
    options = { ...extra, ...root.layoutOptions };
  const note = (o?: Record<string, string>) => {
    for (const k of Object.keys(o ?? {})) if (!KNOWN.has(keyOf(k))) unknown.add(keyOf(k));
  };
  note(options);
  // ELK never folds a long drawing into rows.
  const graph: GraphIn = { nodes, groups, edges, fold: 'never' };
  const direction = option(options, 'direction');
  let mirror: ElkInput['mirror'];
  if (direction === 'DOWN' || direction === 'UP') graph.direction = 'down';
  else if (direction === 'RIGHT' || direction === 'LEFT') graph.direction = 'right';
  if (direction === 'LEFT') mirror = 'x';
  if (direction === 'UP') mirror = 'y';
  const gap = Number(
    option(options, 'layered.spacing.nodeNodeBetweenLayers') ?? option(options, 'spacing.nodeNode'),
  );
  if (gap > 0) graph.gap = Math.min(300, Math.max(8, gap));
  const algorithm = option(options, 'algorithm');
  if (algorithm && /force|stress/.test(algorithm)) graph.arrange = 'engine:stress';
  else if (algorithm && /mrtree/.test(algorithm)) graph.arrange = 'engine:tree';
  else if (algorithm && /rectpacking|box/.test(algorithm)) graph.arrange = 'engine:grid';
  const walk = (n: ElkNode, parent?: string) => {
    for (const p of n.ports ?? []) {
      note(p.layoutOptions);
      ports.set(p.id, { node: n.id, side: PORT_SIDES[option(p.layoutOptions, 'port.side') ?? ''] });
    }
    if (n !== root) {
      note(n.layoutOptions);
      const label = n.labels?.[0]?.text ?? n.id;
      // A layered ELK graph flows through its clusters, so a group flows too, not the
      // file's default column.
      if (n.children?.length) groups.push({ id: n.id, label, parent, arrange: 'flow' });
      else
        nodes.push({
          id: n.id,
          label,
          parent,
          ...(n.width ? { width: n.width } : {}),
          ...(n.height ? { height: n.height } : {}),
        });
    }
    for (const c of n.children ?? []) walk(c, n === root ? undefined : n.id);
  };
  walk(root);
  const end = (id: string) => ports.get(id) ?? { node: id, side: undefined };
  const collect = (n: ElkNode) => {
    for (const e of n.edges ?? []) {
      note(e.layoutOptions);
      // A hyperedge becomes one line per source and target pair.
      const pairs = e.sources.flatMap(s => e.targets.map(t => [end(s), end(t)] as const)),
        ids = pairs.map((_, i) => (pairs.length > 1 ? `${e.id}#${i}` : e.id));
      pieces.set(e.id, ids);
      pairs.forEach(([s, t], i) =>
        edges.push({
          id: ids[i],
          source: s.node,
          target: t.node,
          label: e.labels?.[0]?.text,
          sourceSide: s.side,
          targetSide: t.side,
        }),
      );
    }
    for (const c of n.children ?? []) collect(c);
  };
  collect(root);
  if (unknown.size)
    warnings.push(`These ELK options are not used: ${[...unknown].sort().join(', ')}.`);
  return { graph, warnings, pieces, mirror };
}

export function toElk(root: ElkNode, out: LayoutResult, { pieces }: ElkInput): ElkNode {
  const abs = new Map<string, ElkPoint>([[root.id, { x: 0, y: 0 }]]),
    parent = new Map<string, string>();
  const place = (n: ElkNode, from: ElkPoint): ElkNode => {
    const b = n === root ? undefined : (out.nodes[n.id] ?? out.groups[n.id]),
      at = b ? { x: b.x, y: b.y } : from;
    abs.set(n.id, at);
    for (const c of n.children ?? []) parent.set(c.id, n.id);
    const children = n.children?.map(c => place(c, at));
    return {
      ...n,
      ...(n === root
        ? {
            x: 0,
            y: 0,
            width: out.bounds.x + out.bounds.width,
            height: out.bounds.y + out.bounds.height,
          }
        : { x: at.x - from.x, y: at.y - from.y, width: b?.width, height: b?.height }),
      ...(children ? { children } : {}),
    };
  };
  const placed = place(root, { x: 0, y: 0 });
  // A port's own node, for an edge that names the port.
  const owner = new Map<string, string>();
  const ports = (n: ElkNode) => {
    for (const p of n.ports ?? []) owner.set(p.id, n.id);
    n.children?.forEach(ports);
  };
  ports(root);
  const chain = (id: string) => {
    const list: string[] = [];
    for (let p = parent.get(owner.get(id) ?? id); p; p = parent.get(p)) list.push(p);
    return list;
  };
  // The container: the nearest node that holds both ends, as elkjs sets it.
  const containerOf = (e: ElkEdge) => {
    const a = chain(e.sources[0]),
      b = new Set(chain(e.targets[0]));
    return a.find(id => b.has(id)) ?? root.id;
  };
  const withEdges = (n: ElkNode): ElkNode => ({
    ...n,
    ...(n.edges
      ? {
          edges: n.edges.map(e => {
            const container = containerOf(e),
              o = abs.get(container) ?? { x: 0, y: 0 },
              rel = (p: ElkPoint) => ({ x: p.x - o.x, y: p.y - o.y }),
              routes = (pieces.get(e.id) ?? [e.id]).map(id => out.edges[id]).filter(Boolean),
              label = routes[0]?.label;
            return {
              ...e,
              container,
              sections: routes.map((r, i) => ({
                id: `${e.id}_s${i}`,
                startPoint: rel(r.points[0]),
                endPoint: rel(r.points.at(-1)!),
                bendPoints: r.points.slice(1, -1).map(rel),
                incomingShape: r.source,
                outgoingShape: r.target,
              })),
              ...(e.labels?.length && label
                ? {
                    labels: e.labels.map((l, i) =>
                      i ? l : { ...l, ...rel(label), width: label.width, height: label.height },
                    ),
                  }
                : {}),
            };
          }),
        }
      : {}),
    ...(n.children ? { children: n.children.map(withEdges) } : {}),
  });
  return withEdges(placed);
}

/** Lay out an ELK graph with draftably and return it as elkjs would. */
export async function layoutElk(
  root: ElkNode,
  extra?: Record<string, string>,
  common?: Partial<GraphIn>,
) {
  const input = fromElk(root, extra),
    raw = await layout({ ...input.graph, ...common }),
    // ELK draws from (0, 0) down and right.
    result = shifted(input.mirror ? mirrored(raw, input.mirror) : raw);
  result.warnings.unshift(...input.warnings);
  return { elk: toElk(root, result, input), result };
}

/**
 * A stand-in for elkjs's `ELK` class: the same `layout(graph, { layoutOptions })` call, with
 * draftably's layout and router. Options draftably does not use are listed in `warnings`.
 */
export class DraftablyELK {
  /** Warnings from the last `layout` call, such as ELK options that were not used. */
  warnings: string[] = [];
  constructor(private options: { defaultLayoutOptions?: Record<string, string> } = {}) {}
  async layout(graph: ElkNode, args: { layoutOptions?: Record<string, string> } = {}) {
    const { elk, result } = await layoutElk(graph, {
      ...this.options.defaultLayoutOptions,
      ...args.layoutOptions,
    });
    this.warnings = result.warnings;
    return elk;
  }
  knownLayoutAlgorithms() {
    return Promise.resolve([{ id: 'draftably.flow', name: 'Draftably flow' }]);
  }
  terminateWorker() {}
}
