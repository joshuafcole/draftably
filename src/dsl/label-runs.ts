/**
 * `check --metrics` findings about where an edge label sits on its own line:
 *
 * - `label-detached`: the label stands clear of its line. Labels are never hidden; when every
 *   spot on and beside a line is taken, the label moves away from it as little as it can, and a
 *   reader can no longer tell which line it names.
 * - `label-overflows-run`: the label's text is wider (or, across an upright run, taller) than
 *   the straight run of line it sits on, so it reaches past a bend or an end.
 */
import { segments, type Segment } from '../model/geometry';
import type { DrawnRoute } from '../model/routes';
import type { Rect } from '../model/types';
import type { Diagnostic } from './compile';
import { blame } from './conflicts';
import { NODE, type Drawing } from './metrics';

/** Padding round a label's text: `labelSpots`' 8px each side, 3px above and below. */
const PAD_X = 8,
  PAD_Y = 3;
/**
 * Text wider than its run by more than this reaches past a bend: about one character of the
 * annotation type, an eighth of a node's height (7px).
 */
export const OVERFLOW_GRAIN = NODE.h / 8;

/** Distance between a rectangle and an axis-aligned segment; 0 when they touch. */
function gap(r: Rect, [a, b]: Segment) {
  const dx = Math.max(r.x - Math.max(a.x, b.x), Math.min(a.x, b.x) - (r.x + r.w), 0),
    dy = Math.max(r.y - Math.max(a.y, b.y), Math.min(a.y, b.y) - (r.y + r.h), 0);
  return Math.hypot(dx, dy);
}

/** A label's box, centred on its spot. */
const boxOf = (l: NonNullable<DrawnRoute['label']>): Rect => ({
  x: l.x - l.w / 2,
  y: l.y - l.h / 2,
  w: l.w,
  h: l.h,
});

export function labelRunNotes(d: Drawing): Diagnostic[] {
  const out: Diagnostic[] = [],
    edges = new Map(d.scene.edges.map(e => [e.id, e]));
  for (const route of d.routes) {
    const l = route.label,
      text = edges.get(route.id)?.label;
    // A sequence message's label has its own fixed spot above the message.
    if (!l || !text || d.doc.layout.edges[route.id]?.row !== undefined) continue;
    const box = boxOf(l),
      segs = segments(route.points).filter(([a, b]) => a.x !== b.x || a.y !== b.y);
    if (!segs.length) continue;
    const near = segs.map(s => ({ s, gap: gap(box, s) })).sort((p, q) => p.gap - q.gap)[0];
    const name = `The label "${text}" on ${route.id} (${route.from} -> ${route.to})`,
      cause = blame(d.scene, [route.from, route.to]);
    // More than half its own height off the line: beside a level line a label sits 4px off it,
    // and across an upright one the line runs through it.
    if (near.gap > l.h / 2) {
      out.push({
        level: 'warning',
        code: 'label-detached',
        message: `${name} sits ${Math.round(near.gap)}px from its line, so it reads as another line's.${cause.text}`,
        ...(cause.line ? { line: cause.line } : {}),
        ids: [route.id],
        box,
      });
      continue;
    }
    const [a, b] = near.s,
      level = a.y === b.y,
      run = level ? Math.abs(b.x - a.x) : Math.abs(b.y - a.y),
      needed = level ? l.w - 2 * PAD_X : l.h - 2 * PAD_Y;
    if (needed - run <= OVERFLOW_GRAIN) continue;
    out.push({
      level: 'warning',
      code: 'label-overflows-run',
      message: `${name} is ${Math.round(needed)}px ${level ? 'wide' : 'tall'} on a ${Math.round(run)}px run of its line, so it reaches past a bend.${cause.text}`,
      ...(cause.line ? { line: cause.line } : {}),
      ids: [route.id],
      box,
    });
  }
  return out;
}
