/** Whole-drawing moves for adapters whose library draws in another frame. */
import type { LayoutResult, PlacedBox } from './core';
import { roundedPath } from '../model/geometry';
import type { Point, Side } from '../model/types';

const map = <T>(o: Record<string, T>, f: (v: T) => T) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v)]));

function moved(
  out: LayoutResult,
  box: <B extends PlacedBox>(b: B) => B,
  point: (p: Point) => Point,
  side: (s: Side) => Side,
  bounds = out.bounds,
): LayoutResult {
  return {
    ...out,
    bounds,
    nodes: map(out.nodes, box),
    groups: map(out.groups, box),
    edges: map(out.edges, e => {
      const points = e.points.map(point);
      return {
        ...e,
        points,
        path: roundedPath(points, 6),
        label: e.label && box(e.label),
        sourceSide: side(e.sourceSide),
        targetSide: side(e.targetSide),
      };
    }),
  };
}

/** The drawing moved so that its bounds start at (0, 0). */
export function shifted(out: LayoutResult): LayoutResult {
  const dx = -out.bounds.x,
    dy = -out.bounds.y;
  if (!dx && !dy) return out;
  return moved(
    out,
    b => ({ ...b, x: b.x + dx, y: b.y + dy }),
    p => ({ x: p.x + dx, y: p.y + dy }),
    s => s,
    { ...out.bounds, x: 0, y: 0 },
  );
}

const OPPOSITE: Record<Side, Side> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** The drawing flipped across its bounds, so a `right` layout reads leftward (or `down` upward). */
export function mirrored(out: LayoutResult, axis: 'x' | 'y'): LayoutResult {
  const size = axis === 'x' ? 'width' : 'height',
    sum = 2 * out.bounds[axis] + out.bounds[size],
    across = axis === 'x' ? ['left', 'right'] : ['top', 'bottom'];
  return moved(
    out,
    b => ({ ...b, [axis]: sum - b[axis] - b[size] }),
    p => ({ ...p, [axis]: sum - p[axis] }),
    s => (across.includes(s) ? OPPOSITE[s] : s),
  );
}
