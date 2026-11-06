/**
 * `check --metrics` findings about where a line meets its boxes, beside `backward-side` (which
 * `check` reports by default for a forward edge against the layout's direction):
 *
 * - `faces-away`: a line leaves by a side that faces away from its other end, or arrives on one
 *   that faces away from where it came from, and the side is not a reading-direction side.
 *   Leaving by the right or bottom and arriving on the left or top is the house style even when
 *   it means a loop (a fold's wrap, a return lane), so those sides are never reported. What is
 *   left is the line that leaves by the left or top toward something wholly the other way, or
 *   arrives on the right or bottom from something wholly the other way: "never arrive from
 *   below". `backward-side` needs the layout's direction; this needs none, and a line
 *   `backward-side` already names is skipped.
 * - `arrow-room`: the last run into a mark (an arrowhead, or any `head=`/`tail=` mark) is shorter
 *   than the mark, so the mark sits on a bend.
 *
 * A side set with `from=` or `to=` is the author's call and is not reported.
 */
import { rectFromPoints, rectUnion, segments } from '../model/geometry';
import { headOf, tailOf } from '../model/markers';
import type { Rect, Side } from '../model/types';
import type { Diagnostic } from './compile';
import { blame } from './conflicts';
import { flowSideNotes } from './flow-sides';
import { NODE, type Drawing } from './metrics';

/** A run into a mark shorter than this puts the mark on a bend: a fifth of a node's height (11px). */
export const ARROW_ROOM = NODE.h / 5;

/** Whether `other` lies wholly beyond the side of `box` opposite `side`. */
function facesAway(side: Side, box: Rect, other: Rect) {
  if (side === 'right') return other.x + other.w <= box.x;
  if (side === 'left') return other.x >= box.x + box.w;
  if (side === 'bottom') return other.y + other.h <= box.y;
  return other.y >= box.y + box.h;
}

/** The sides a line reads well leaving by, and arriving on. */
const FORWARD = { from: ['right', 'bottom'], to: ['left', 'top'] };

export function portFaceNotes(d: Drawing): Diagnostic[] {
  const out: Diagnostic[] = [],
    edges = new Map(d.scene.edges.map(e => [e.id, e])),
    backward = new Set(flowSideNotes(d.scene, d.doc, d.rects, d.routes).flatMap(n => n.ids));
  for (const route of d.routes) {
    const e = edges.get(route.id),
      a = d.rects.get(route.from),
      b = d.rects.get(route.to);
    // A self-loop has no other end; a sequence message and a line run across cells keep theirs.
    if (!e || !a || !b || route.from === route.to || route.cross) continue;
    if (d.doc.layout.edges[route.id]?.row !== undefined) continue;
    const name = `${route.id} (${route.from} -> ${route.to})`,
      cause = blame(d.scene, [route.from, route.to]),
      at = (box: Rect) => ({ ...(cause.line ? { line: cause.line } : {}), ids: [route.id], box });
    if (!backward.has(route.id)) {
      const wrong = [
        ...(e.from === 'auto' &&
        !FORWARD.from.includes(route.fromSide) &&
        facesAway(route.fromSide, a, b)
          ? [`leaves ${route.from} by its ${route.fromSide}, away from ${route.to}`]
          : []),
        ...(e.to === 'auto' && !FORWARD.to.includes(route.toSide) && facesAway(route.toSide, b, a)
          ? [`enters ${route.to} by its ${route.toSide}, away from ${route.from}`]
          : []),
      ];
      if (wrong.length)
        out.push({
          level: 'warning',
          code: 'faces-away',
          message: `${name} ${wrong.join(' and ')}, so it loops round to reach it.${cause.text}`,
          ...at(rectUnion(route.points.map(p => ({ ...p, w: 0, h: 0 })))),
        });
    }
    // The runs into each end that carries a mark, with zero-length steps dropped.
    const runs = segments(route.points).filter(([p, q]) => p.x !== q.x || p.y !== q.y);
    if (!runs.length) continue;
    for (const [end, marked, [p, q]] of [
      ['end', headOf(e) !== 'none', runs.at(-1)!],
      ['start', tailOf(e) !== 'none', runs[0]],
    ] as const) {
      const run = Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      if (!marked || run >= ARROW_ROOM || runs.length < 2) continue;
      out.push({
        level: 'warning',
        code: 'arrow-room',
        message: `${name} turns ${Math.round(run)}px from its ${end}, so the mark there sits on the bend.${cause.text}`,
        ...at(rectFromPoints(p, q)),
      });
    }
  }
  return out;
}
