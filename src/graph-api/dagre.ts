/**
 * A stand-in for `dagre.layout(g)`: it reads a graphlib graph and writes the results back into
 * it the way dagre does, so code that reads `g.node(v).x` or `g.edge(e).points` keeps working.
 * Node `x` and `y` are centres; edge `points` run from outline to outline; the graph gets `width`
 * and `height`. Clusters (compound parents) are groups and get a box too.
 */
import { layoutSync, type GraphIn, type LayoutResult, type RoutingOptions } from './core';
import { mirrored, shifted } from './transform';

type Label = { [key: string]: unknown };

/** The graphlib `Graph` methods this reads, from `@dagrejs/graphlib` or `dagre.graphlib`. */
export interface DagreGraph {
  nodes(): string[];
  node(v: string): Label | undefined;
  edges(): Array<{ v: string; w: string; name?: string }>;
  edge(e: { v: string; w: string; name?: string }): Label | undefined;
  graph(): Label | undefined;
  parent?(v: string): string | undefined | void;
  children?(v?: string): string[] | undefined;
}

const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
const text = (v: unknown) => (typeof v === 'string' ? v : undefined);

/** Lay out a graphlib graph in place, as `dagre.layout(g)` does. Returns the full result too. */
export function dagreLayout(
  g: DagreGraph,
  options: { routing?: RoutingOptions } = {},
): LayoutResult {
  const ids = g.nodes(),
    parentOf = (v: string) => g.parent?.(v) || undefined,
    clusters = new Set(ids.filter(v => g.children?.(v)?.length)),
    info = g.graph() ?? {},
    rankdir = text(info.rankdir)?.toUpperCase() ?? 'TB',
    links = g.edges(),
    key = (e: { v: string; w: string; name?: string }) =>
      `${e.v}->${e.w}${e.name ? `:${e.name}` : ''}`;
  const graph: GraphIn = {
    // dagre never folds a long drawing into rows, and its clusters flow like the rest.
    fold: 'never',
    direction: rankdir === 'LR' || rankdir === 'RL' ? 'right' : 'down',
    ...(num(info.ranksep) ? { gap: Math.min(300, Math.max(8, num(info.ranksep)!)) } : {}),
    groups: ids
      .filter(v => clusters.has(v))
      .map(v => ({
        id: v,
        label: text(g.node(v)?.label) ?? v,
        parent: parentOf(v),
        arrange: 'flow' as const,
      })),
    nodes: ids
      .filter(v => !clusters.has(v))
      .map(v => {
        const n = g.node(v) ?? {};
        return {
          id: v,
          label: text(n.label) ?? v,
          parent: parentOf(v),
          ...(num(n.width) ? { width: num(n.width) } : {}),
          ...(num(n.height) ? { height: num(n.height) } : {}),
        };
      }),
    edges: links.map(e => ({
      id: key(e),
      source: e.v,
      target: e.w,
      label: text(g.edge(e)?.label),
    })),
    routing: options.routing,
  };
  let out = layoutSync(graph);
  if (rankdir === 'BT') out = mirrored(out, 'y');
  if (rankdir === 'RL') out = mirrored(out, 'x');
  out = shifted(out);
  for (const v of ids) {
    const b = out.nodes[v] ?? out.groups[v],
      n = g.node(v);
    if (!b || !n) continue;
    Object.assign(n, {
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
      width: b.width,
      height: b.height,
    });
  }
  for (const e of links) {
    const r = out.edges[key(e)],
      label = g.edge(e);
    if (!r || !label) continue;
    Object.assign(label, {
      points: r.points.map(p => ({ x: p.x, y: p.y })),
      ...(r.label ? { x: r.label.x + r.label.width / 2, y: r.label.y + r.label.height / 2 } : {}),
    });
  }
  Object.assign(info, { width: out.bounds.width, height: out.bounds.height });
  return out;
}
