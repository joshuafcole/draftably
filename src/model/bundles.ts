/**
 * Bundles: several lines between one pair of ends drawn as one trunk.
 *
 * The router routes every line on its own, in lanes beside each other. This pass runs after it
 * and changes no route: it finds the pairs of ends with enough lines between them (`routing
 * bundle=N`, or a `bundle a b` statement for one pair) and gives each a trunk, the middle lane's
 * route, labelled with the bundle's name or its count. The viewer draws the trunk in place of the
 * lines until it is held, then spreads it back into the lanes the router chose, so every member
 * stays a line of its own to point at and select.
 */
import { resolveAppearance } from './appearance';
import { roundedPath } from './geometry';
import type { VisibleGraph } from './graph';
import { edgeLabelSize } from './labels';
import type { DrawnRoute, EdgeLabelBox } from './routes';
import type { Diagram, Point } from './types';

export interface DrawnBundle {
  /** `bundle:<a>:<b>`, with the ends in the order the bundle reads them. */
  id: string;
  /** The two visible ends: a `bundle` statement's order, else the first member's. */
  a: string;
  b: string;
  /** The lines it carries, in lane order across the trunk. */
  members: string[];
  /** The `bundle` statement's name, when it has one. */
  name?: string;
  /** What the trunk is labelled: its name, or how many lines it carries. */
  text: string;
  /** The trunk, from `a` to `b`: the middle lane's route. */
  points: Point[];
  path: string;
  label: EdgeLabelBox;
  /** Whether some member points at each end, so the trunk draws a head there. */
  toA: boolean;
  toB: boolean;
}

/** The count a trunk is labelled with when it has no name. */
export const bundleCount = (n: number) => `${n} flows`;

const pair = (a: string, b: string) => (a < b ? `${a}\n${b}` : `${b}\n${a}`);

/** Length of a polyline, and the point half way along it. */
function middle(points: readonly Point[]): Point {
  const lengths = points
      .slice(1)
      .map((p, i) => Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y)),
    total = lengths.reduce((s, l) => s + l, 0);
  let left = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] && lengths[i] > 0) {
      const t = left / lengths[i],
        [p, q] = [points[i], points[i + 1]];
      return { x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t };
    }
    left -= lengths[i];
  }
  return points[points.length - 1] ?? { x: 0, y: 0 };
}

/** The middle of a polyline's longest run: where a trunk's label sits. */
function longestRun(points: readonly Point[]): Point {
  let best = 0,
    at = points[0] ?? { x: 0, y: 0 };
  points.slice(1).forEach((q, i) => {
    const p = points[i],
      l = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
    if (l > best) {
      best = l;
      at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
  });
  return at;
}

/**
 * The bundles a routed drawing has: each pair of visible ends with at least the `routing bundle=`
 * threshold of lines between them, and each pair a `bundle` statement names with two or more.
 * Sequence messages and self lines never bundle.
 */
export function findBundles(
  doc: Diagram,
  vg: VisibleGraph,
  routes: readonly DrawnRoute[],
): DrawnBundle[] {
  const threshold = doc.settings.routing?.bundle ?? 0,
    named = new Map((doc.appearance.bundles ?? []).map(x => [pair(x.a, x.b), x]));
  if (threshold < 2 && !named.size) return [];
  const byRoute = new Map(routes.map(r => [r.id, r])),
    groups = new Map<string, Array<{ edge: VisibleGraph['edges'][number]; route: DrawnRoute }>>();
  for (const edge of vg.edges) {
    const route = byRoute.get(edge.id);
    if (!route || edge.a === edge.b || doc.layout.edges[edge.id]?.row !== undefined) continue;
    const key = pair(edge.a, edge.b);
    groups.set(key, [...(groups.get(key) ?? []), { edge, route }]);
  }
  const look = resolveAppearance(doc.appearance),
    radius = doc.settings.routing?.cornerRadius ?? 6,
    out: DrawnBundle[] = [];
  for (const [key, lines] of groups) {
    const statement = named.get(key);
    if (lines.length < 2 || (!statement && (threshold < 2 || lines.length < threshold))) continue;
    const a = statement?.a ?? lines[0].edge.a,
      b = a === lines[0].edge.a ? lines[0].edge.b : lines[0].edge.a;
    // Every member's route from a to b, and its lane: where its middle sits across the run.
    const oriented = lines.map(({ edge, route }) => ({
      id: edge.id,
      edge,
      points: edge.a === a ? route.points : [...route.points].reverse(),
    }));
    const ends = [oriented[0].points[0], oriented[0].points[oriented[0].points.length - 1]],
      across = { x: -(ends[1].y - ends[0].y), y: ends[1].x - ends[0].x },
      lane = (ps: Point[]) => {
        const m = middle(ps);
        return m.x * across.x + m.y * across.y;
      };
    oriented.sort((p, q) => lane(p.points) - lane(q.points) || (p.id < q.id ? -1 : 1));
    const trunk = oriented[Math.floor((oriented.length - 1) / 2)].points,
      text = statement?.name ?? bundleCount(lines.length),
      size = edgeLabelSize(text, look),
      at = longestRun(trunk);
    out.push({
      id: `bundle:${a}:${b}`,
      a,
      b,
      members: oriented.map(o => o.id),
      ...(statement?.name ? { name: statement.name } : {}),
      text,
      points: trunk,
      path: roundedPath(trunk, radius),
      label: { x: at.x, y: at.y, w: size.w, h: size.h },
      toA: lines.some(({ edge }) => edge.directed !== false && edge.b === a),
      toB: lines.some(({ edge }) => edge.directed !== false && edge.b === b),
    });
  }
  return out.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
}
