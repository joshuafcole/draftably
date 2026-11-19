/**
 * The marks at a connection's ends, `head=` and `tail=` in a file. The canvas and the CLI draw
 * them from these definitions, so both give the same geometry.
 */
import type { Point, Rect } from './types';

/** What `head=` and `tail=` accept. A plain edge is `head=arrow tail=none`. */
export const MARKERS = [
  'arrow',
  'none',
  'triangle',
  'open-triangle',
  'diamond',
  'open-diamond',
  'circle',
  'cross',
] as const;
export type EndMarker = (typeof MARKERS)[number];

export interface MarkerShape {
  w: number;
  h: number;
  /** Where the marker sits on its line, at the height of its middle. */
  x: number;
  d: string;
  /** Solid marks take the line's ink. Open marks take the surface, which hides what is under. */
  fill: 'ink' | 'surface' | 'none';
  /** How far short of the end its line stops; the mark fills that gap, tip on the end. */
  stop: number;
}

const DIAMOND = 'M1 4.5L7.5 1L14 4.5L7.5 8Z';

/** Each marker points along +x, in drawing units. `arrow` is the original open chevron. */
export const MARKER_SHAPES: Record<Exclude<EndMarker, 'none'>, MarkerShape> = {
  arrow: { w: 8, h: 8, x: 7, d: 'M1 1L7 4L1 7', fill: 'none', stop: 0 },
  triangle: { w: 10, h: 9, x: 1, d: 'M1 1L9 4.5L1 8Z', fill: 'ink', stop: 8 },
  'open-triangle': { w: 12, h: 11, x: 1, d: 'M1 1L11 5.5L1 10Z', fill: 'surface', stop: 10 },
  diamond: { w: 15, h: 9, x: 1, d: DIAMOND, fill: 'ink', stop: 13 },
  'open-diamond': { w: 15, h: 9, x: 1, d: DIAMOND, fill: 'surface', stop: 13 },
  circle: {
    w: 10,
    h: 10,
    x: 1.5,
    d: 'M1.5 5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0Z',
    fill: 'ink',
    stop: 7,
  },
  // Set back from the end, with the line running on through it.
  cross: { w: 9, h: 9, x: 10.5, d: 'M1 1L8 8M8 1L1 8', fill: 'none', stop: 0 },
};

export const MARKER_STROKE = 1.5;

const shapeOf = (kind: EndMarker): MarkerShape | undefined =>
  kind === 'none' ? undefined : MARKER_SHAPES[kind];

/** The `<marker>` box for an end. A tail's mark turns to face away from the line. */
export const markerBox = (kind: Exclude<EndMarker, 'none'>, tail: boolean) => ({
  markerWidth: MARKER_SHAPES[kind].w,
  markerHeight: MARKER_SHAPES[kind].h,
  refX: MARKER_SHAPES[kind].x,
  refY: MARKER_SHAPES[kind].h / 2,
  orient: tail ? 'auto-start-reverse' : 'auto',
});

/** The fill a marker takes on this line and surface. */
export function markerFill(kind: Exclude<EndMarker, 'none'>, ink: string, surface: string) {
  const { fill } = MARKER_SHAPES[kind];
  return fill === 'ink' ? ink : fill === 'surface' ? surface : 'none';
}

/**
 * What `message=` accepts on a sequence message, plus `action`, which an `action` line makes.
 * Each says what the author means; none is read from a line's style.
 */
export const MESSAGE_KINDS = ['interaction', 'call', 'send', 'reply', 'outcome'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number] | 'action';

type Ends = { directed?: boolean; head?: EndMarker; tail?: EndMarker; message?: MessageKind };

/**
 * The marks a kind of message draws: a call has a solid head, a send leaves a dot on its
 * sender, and a local action is a box with no ends. The rest keep the plain arrow.
 */
const MESSAGE_ENDS: Partial<Record<MessageKind, { head?: EndMarker; tail?: EndMarker }>> = {
  call: { head: 'triangle' },
  send: { tail: 'circle' },
  action: { head: 'none' },
};

/** An undirected edge has no marks, whatever else it holds. */
export const headOf = (e: Ends): EndMarker =>
  e.directed === false
    ? 'none'
    : ((e.message && MESSAGE_ENDS[e.message]?.head) ?? e.head ?? 'arrow');
export const tailOf = (e: Ends): EndMarker =>
  e.directed === false
    ? 'none'
    : ((e.message && MESSAGE_ENDS[e.message]?.tail) ?? e.tail ?? 'none');

/** Whether an edge has anything beyond the plain arrow, which labels and lines ignore. */
export const hasMarkers = (e: Ends) => headOf(e) !== 'arrow' || tailOf(e) !== 'none';

/** `p` moved `by` toward `q`, leaving at least a sliver of a short segment. */
function pulled(p: Point, q: Point, by: number): Point {
  const len = Math.hypot(q.x - p.x, q.y - p.y),
    d = Math.min(by, len - 1);
  return d > 0 ? { x: p.x + ((q.x - p.x) * d) / len, y: p.y + ((q.y - p.y) * d) / len } : p;
}

/** A route with each end pulled back to its marker's stop, so no line runs through a mark. */
export function stoppedPoints(points: Point[], e: Ends): Point[] {
  if (points.length < 2) return points;
  const out = [...points],
    last = out.length - 1;
  out[0] = pulled(out[0], out[1], shapeOf(tailOf(e))?.stop ?? 0);
  out[last] = pulled(out[last], out[last - 1], shapeOf(headOf(e))?.stop ?? 0);
  return out;
}

/** The room a marker takes at the end `p`, whose line comes from `from`. */
function markerRect(kind: EndMarker, p: Point, from: Point): Rect[] {
  const shape = shapeOf(kind);
  if (!shape) return [];
  const len = Math.hypot(p.x - from.x, p.y - from.y) || 1,
    reach = shape.stop || shape.x,
    back = { x: p.x + ((from.x - p.x) * reach) / len, y: p.y + ((from.y - p.y) * reach) / len },
    half = shape.h / 2,
    x = Math.min(p.x, back.x),
    y = Math.min(p.y, back.y);
  return [
    {
      x: x - half,
      y: y - half,
      w: Math.abs(p.x - back.x) + 2 * half,
      h: Math.abs(p.y - back.y) + 2 * half,
    },
  ];
}

/** The room an edge's marks take. A label keeps off them. */
export function markerRects(points: Point[], e: Ends): Rect[] {
  if (points.length < 2) return [];
  const last = points.length - 1;
  return [
    ...markerRect(tailOf(e), points[0], points[1]),
    ...markerRect(headOf(e), points[last], points[last - 1]),
  ];
}
