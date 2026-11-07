/**
 * Where a changed object was: `was-at=` and `was-size=` drawn on the merged drawing as a ghost of
 * the old box, with a hairline from the ghost to the box where the pairing needs one. The canvas,
 * `inspect --svg` and the exports draw them from here, and none of them moves anything: a mark
 * sits on the merged geometry and is left out of the drawing's bounds.
 *
 * One origin per object, drawn as a ghost where it is inside the frame and as a line to the
 * frame's edge where it is not, never both. The four rules say when a hairline is not drawn:
 *
 * 1. A resize takes no hairline: the ghost shares the box's corner, so there is nowhere for one
 *    to go, however large the change.
 * 2. A ghost that overlaps its own box takes none: the pairing is already visible.
 * 3. A move whose ghost stands clear takes exactly one, from the ghost's edge to a dot on the
 *    box's edge.
 * 4. An origin off the frame is a line with no ghost: a dot on the box's side that faces it, a
 *    line straight out to the frame's edge, and a tick on that edge.
 *
 * Rule 4 is tried first, since an origin off the frame has no ghost to overlap anything.
 */
import type { ResolvedAppearance } from './appearance';
import { center, inside, overlaps, sameRect } from './geometry';
import { pastRect, styleOf } from './graph';
import { statusPaint } from './status';
import type { Diagram, Point, Rect, Side } from './types';

/** The old box, drawn as an outline where it stood. */
export interface PositionGhost {
  id: string;
  rect: Rect;
}

/** A move's line from the ghost to the box; the dot is at the box end. */
export interface PositionHairline {
  id: string;
  from: Point;
  dot: Point;
}

/** An origin off the frame: a dot on the box, a line out, a tick where it meets the frame. */
export interface PositionTerminator {
  id: string;
  dot: Point;
  at: Point;
  edge: Side;
}

export interface PositionMarks {
  ghosts: PositionGhost[];
  hairlines: PositionHairline[];
  terminators: PositionTerminator[];
}

/** Where a line from `rect`'s centre toward `to` leaves the rect. */
function edgeToward(rect: Rect, to: Point): Point {
  const from = center(rect),
    dx = to.x - from.x,
    dy = to.y - from.y;
  if (!dx && !dy) return from;
  const t = Math.min(
    dx ? rect.w / 2 / Math.abs(dx) : Infinity,
    dy ? rect.h / 2 / Math.abs(dy) : Infinity,
  );
  return { x: from.x + dx * t, y: from.y + dy * t };
}

/** The side of `rect` that faces `to`, by the longer axis of the way there. */
function sideToward(rect: Rect, to: Point): Side {
  const c = center(rect),
    dx = to.x - c.x,
    dy = to.y - c.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function sideMiddle(rect: Rect, side: Side): Point {
  const c = center(rect);
  if (side === 'left') return { x: rect.x, y: c.y };
  if (side === 'right') return { x: rect.x + rect.w, y: c.y };
  if (side === 'top') return { x: c.x, y: rect.y };
  return { x: c.x, y: rect.y + rect.h };
}

/** Straight out from `dot` to the frame's edge on `side`. */
function frameEdge(dot: Point, frame: Rect, side: Side): Point {
  if (side === 'left') return { x: frame.x, y: dot.y };
  if (side === 'right') return { x: frame.x + frame.w, y: dot.y };
  if (side === 'top') return { x: dot.x, y: frame.y };
  return { x: dot.x, y: frame.y + frame.h };
}

/**
 * How far past the drawing's bounds the frame for these marks reaches: half the export frame's
 * padding, so a line to its edge ends, tick and all, inside every frame drawn round the drawing.
 */
export const MARK_REACH = 20;

/**
 * The marks for every object `rects` draws that has an old corner or size. `bounds` is what the
 * drawing covers (`drawingBounds`, unpadded); an old corner more than `MARK_REACH` outside it gets
 * a line to that frame's edge instead of a ghost.
 */
export function positionMarks(
  doc: Diagram,
  rects: ReadonlyMap<string, Rect>,
  bounds: Rect,
): PositionMarks {
  const frame = {
    x: bounds.x - MARK_REACH,
    y: bounds.y - MARK_REACH,
    w: bounds.w + MARK_REACH * 2,
    h: bounds.h + MARK_REACH * 2,
  };
  const marks: PositionMarks = { ghosts: [], hairlines: [], terminators: [] };
  for (const o of [...doc.graph.groups, ...doc.graph.nodes]) {
    const now = rects.get(o.id),
      was = now && pastRect(doc, o.id, now);
    if (!now || !was || sameRect(was, now)) continue;
    const origin = { x: was.x, y: was.y };
    if (!inside(origin, frame)) {
      const edge = sideToward(now, origin),
        dot = sideMiddle(now, edge);
      marks.terminators.push({ id: o.id, dot, at: frameEdge(dot, frame, edge), edge });
      continue;
    }
    marks.ghosts.push({ id: o.id, rect: was });
    if (was.x === now.x && was.y === now.y) continue;
    if (overlaps(was, now)) continue;
    marks.hairlines.push({
      id: o.id,
      from: edgeToward(was, center(now)),
      dot: edgeToward(now, center(was)),
    });
  }
  return marks;
}

/** The ghost's outline: dotted, unfilled, in the changed mark's ink. */
export const GHOST_DASH = '2 3';
/** Half the length of the tick a line to the frame ends in. */
const TICK = 5;
const DOT = 2.5;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

/** One number for an SVG attribute, without float noise. */
const n = (v: number) => String(Math.round(v * 100) / 100);

/**
 * SVG markup for the marks, in the changed mark's ink. Each object's marks fade with it under an
 * emphasis state, as its box does.
 */
export function positionMarkup(doc: Diagram, look: ResolvedAppearance, marks: PositionMarks) {
  const ink = statusPaint(look, 'changed').stroke!,
    fade = (id: string) => {
      const o = statusPaint(look, undefined, styleOf(doc, id).spot).opacity;
      return o < 1 ? ` opacity="${o}"` : '';
    },
    dot = (p: Point) => `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${DOT}" fill="${ink}"/>`,
    line = (a: Point, b: Point) =>
      `<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${ink}" stroke-width="1"/>`;
  return [
    ...marks.ghosts.map(
      g =>
        `<rect data-was="${esc(g.id)}" x="${n(g.rect.x)}" y="${n(g.rect.y)}" width="${n(g.rect.w)}" height="${n(g.rect.h)}" rx="${look.radius}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-dasharray="${GHOST_DASH}"${fade(g.id)}/>`,
    ),
    ...marks.hairlines.map(
      h => `<g data-was="${esc(h.id)}"${fade(h.id)}>${line(h.from, h.dot)}${dot(h.dot)}</g>`,
    ),
    ...marks.terminators.map(t => {
      const across = t.edge === 'left' || t.edge === 'right',
        tick = across
          ? line({ x: t.at.x, y: t.at.y - TICK }, { x: t.at.x, y: t.at.y + TICK })
          : line({ x: t.at.x - TICK, y: t.at.y }, { x: t.at.x + TICK, y: t.at.y });
      return `<g data-was="${esc(t.id)}"${fade(t.id)}>${line(t.dot, t.at)}${tick}${dot(t.dot)}</g>`;
    }),
  ].join('');
}
