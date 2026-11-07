/**
 * Making room for an opened box by warping the drawing, not by laying it out again.
 *
 * A box that opens (a collapsed card becoming the container it stands for) needs space it does
 * not have. Laying the drawing out again finds that space, but moves everything, and a reader
 * who watched every box move has to find the diagram again. This is a **coordinate transform**
 * instead:
 *
 * - **One cut per axis per opening**, at the opened box's edge, chosen once from the drawing as it
 *   was. Everything beyond the cut translates by the shortfall; a box spanning the cut widens.
 * - **The cut has a sign.** It is taken at the box's far edge and pushes everything beyond it
 *   outward, or at its near edge and pushes everything before it back, whichever side has fewer
 *   boxes on it. Growing into the emptier half-plane usually moves nothing at all.
 * - **Routes warp point by point** under the same rule, so a point that sat on a box's edge still
 *   sits on it. Nothing is rerouted and no endpoint is snapped. The one exception is the opened
 *   box itself, which is assigned its new size rather than warped: an end standing on one of its
 *   edges follows that edge.
 * - **Bottom up.** A box opened inside a container warps that container's own content first; the
 *   container then grows, and is itself an opening one level out. Each level warps only its own
 *   coordinates.
 * - **Cuts are taken in the original coordinates and summed**, so several openings at once are one
 *   pass and the result does not depend on the order they are listed in.
 *
 * The comparisons are strict: a box whose edge lies exactly on a cut is not dragged open by it.
 *
 * Pure: no document, no DOM. The whole of it is a function of the boxes, the routes (which only
 * vote on the sign) and the sizes asked for.
 */
import type { Point, Rect } from '../model/types';

/** A box of the drawing: where it is, in absolute coordinates, and which box holds it. */
export interface WarpBox extends Rect {
  id: string;
  /** The id of the box that contains it, or `root`. */
  parent: string;
}

/** A box that opens, and the size it opens to. A size smaller than the box never shrinks it. */
export interface Opening {
  id: string;
  w: number;
  h: number;
}

/** One cut line: where it is, which way it pushes, and how far, in the original coordinates. */
export interface Cut {
  axis: 'x' | 'y';
  /** The scope the cut is taken in: the container whose content it moves, or `root`. */
  scope: string;
  /** The box whose opening made it. */
  opening: string;
  at: number;
  /** `1`: everything beyond `at` moves out by `delta`. `-1`: everything before it moves back. */
  dir: 1 | -1;
  delta: number;
}

export interface DilateOptions {
  /**
   * Route points, used only to choose a cut's sign: a card never grows through an edge a route is
   * standing on when the other edge is free.
   */
  routes?: ReadonlyArray<{ points: readonly Point[] }>;
  /**
   * The bounds the root scope's cuts search within, and the frame `stage` in the result is the
   * warp of. The hull of the root's boxes when absent.
   */
  stage?: Rect;
}

export interface Dilation {
  /** Every box's rectangle after the warp, by id. */
  rects: Map<string, Rect>;
  /** Where a point of the original drawing goes. */
  point(p: Point): Point;
  /** The stage after the warp: grown to hold everything it held. */
  stage: Rect;
  /** Every cut taken, in the original coordinates of its scope. */
  cuts: Cut[];
}

const ROOT = 'root';

interface Span {
  at: number;
  extent: number;
  crossAt: number;
  crossExtent: number;
}

interface Side {
  at: number;
  dir: 1 | -1;
}

interface Held {
  near: boolean;
  far: boolean;
}

/** One scope that grew: its cuts, the rectangle each grown child was given, and its frame after. */
interface GrownScope {
  x: Cut[];
  y: Cut[];
  assigned: Map<string, Rect>;
  /** The scope's own frame after the warp, in its original coordinate space. */
  frame: Rect;
}

function spanOf(rect: Rect, axis: 'x' | 'y'): Span {
  return axis === 'x'
    ? { at: rect.x, extent: rect.w, crossAt: rect.y, crossExtent: rect.h }
    : { at: rect.y, extent: rect.h, crossAt: rect.x, crossExtent: rect.w };
}

function shift(cuts: readonly Cut[], coordinate: number): number {
  let moved = coordinate;
  for (const cut of cuts) {
    if (cut.dir > 0) {
      if (cut.at < coordinate) moved += cut.delta;
    } else if (coordinate < cut.at) moved -= cut.delta;
  }
  return moved;
}

function warpRect(rect: Rect, x: readonly Cut[], y: readonly Cut[]): Rect {
  const left = shift(x, rect.x),
    top = shift(y, rect.y);
  return {
    x: left,
    y: top,
    w: shift(x, rect.x + rect.w) - left,
    h: shift(y, rect.y + rect.h) - top,
  };
}

const hull = (rects: readonly Rect[]): Rect => {
  if (!rects.length) return { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.min(...rects.map(r => r.x)),
    y = Math.min(...rects.map(r => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map(r => r.x + r.w)) - x,
    h: Math.max(...rects.map(r => r.y + r.h)) - y,
  };
};

const inside = (p: Point, r: Rect) =>
  p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;

/**
 * The nearest line from `line` toward `stage` that crosses no span; `line` itself when none is
 * clear before the stage edge.
 */
function nearestClear(spans: readonly Span[], line: number, stage: number, dir: 1 | -1): number {
  let candidate = line;
  while (dir > 0 ? candidate <= stage : candidate >= stage) {
    const across = spans.filter(s => s.at < candidate && candidate < s.at + s.extent);
    if (!across.length) return candidate;
    candidate =
      dir > 0 ? Math.max(...across.map(s => s.at + s.extent)) : Math.min(...across.map(s => s.at));
  }
  return line;
}

/** Whether a route point stands on the box's near or far edge, on this axis. */
function edgesHeld(points: readonly Point[], face: Rect, axis: 'x' | 'y'): Held {
  const span = spanOf(face, axis);
  let near = false,
    far = false;
  for (const p of points) {
    const along = axis === 'x' ? p.x : p.y,
      across = axis === 'x' ? p.y : p.x;
    if (across < span.crossAt || across > span.crossAt + span.crossExtent) continue;
    if (along === span.at) near = true;
    if (along === span.at + span.extent) far = true;
  }
  return { near, far };
}

/**
 * Which way one axis grows: toward the side with fewer boxes beyond its nearest clear line, unless
 * a route stands on that edge and not on the other. Ties grow outward.
 */
function chooseSide(
  spans: readonly Span[],
  face: Span,
  near: number,
  far: number,
  standing: Held,
): Side {
  const outward = nearestClear(spans, face.at + face.extent, far, 1),
    inward = nearestClear(spans, face.at, near, -1);
  let beyond = 0,
    before = 0;
  for (const s of spans) {
    if (s.at > outward) beyond += 1;
    if (s.at + s.extent < inward) before += 1;
  }
  const cheaper: 1 | -1 = before < beyond ? -1 : 1,
    other: 1 | -1 = cheaper > 0 ? -1 : 1,
    unsafe = (side: 1 | -1) => (side > 0 ? standing.far : standing.near),
    dir = unsafe(cheaper) && !unsafe(other) ? other : cheaper;
  return dir < 0 ? { at: inward, dir: -1 } : { at: outward, dir: 1 };
}

/** Whether a span is clear of the box's band once the other axis has grown. */
function clearsCross(span: Span, face: Span, cross: Side): boolean {
  return cross.dir > 0
    ? span.crossAt + span.crossExtent <= face.crossAt || span.crossAt >= cross.at
    : span.crossAt >= face.crossAt + face.crossExtent ||
        span.crossAt + span.crossExtent <= cross.at;
}

/** Whether moving the cut from the box's edge to `side.at` steps over a box in its grown band. */
function strands(spans: readonly Span[], line: number, side: Side, face: Span, cross: Side) {
  return spans.some(s => {
    const edge = side.dir > 0 ? s.at + s.extent : s.at,
      steppedOver = side.dir > 0 ? line < edge && edge <= side.at : side.at <= edge && edge < line;
    return steppedOver && !clearsCross(s, face, cross);
  });
}

/** The cut back at the box's own edge when the clear line would strand a box in its way. */
function bound(spans: readonly Span[], face: Span, side: Side, cross: Side): Side {
  const line = side.dir > 0 ? face.at + face.extent : face.at;
  return strands(spans, line, side, face, cross) ? { at: line, dir: side.dir } : side;
}

/**
 * Warp the drawing so each opening gets its size, moving nothing else except by a cut.
 *
 * `boxes` are absolute rectangles with their containment; an opening may be a leaf or a container.
 * A container that holds an opening grows by the warp of its own content and then opens in its
 * own parent, so a nested opening reaches the top as one cut per axis per level.
 */
export function dilate(
  boxes: readonly WarpBox[],
  openings: readonly Opening[],
  options: DilateOptions = {},
): Dilation {
  const byId = new Map(boxes.map(b => [b.id, b])),
    parentOf = (id: string) => {
      const p = byId.get(id)?.parent ?? ROOT;
      return byId.has(p) ? p : ROOT;
    },
    children = new Map<string, WarpBox[]>();
  for (const b of [...boxes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const p = parentOf(b.id);
    if (!children.has(p)) children.set(p, []);
    children.get(p)!.push(b);
  }
  const depth = (id: string): number => (id === ROOT ? 0 : 1 + depth(parentOf(id)));
  const points = (options.routes ?? []).flatMap(r => r.points);
  const stage = options.stage ?? hull(children.get(ROOT) ?? []);

  /** The size each box asks for: openings first, then each container its content grew to. */
  const wanted = new Map<string, { w: number; h: number }>();
  for (const o of openings) {
    const b = byId.get(o.id);
    if (b) wanted.set(o.id, { w: Math.max(b.w, o.w), h: Math.max(b.h, o.h) });
  }
  // Scopes holding something that grows, deepest first; a scope only grows from its own content.
  const scopes = [ROOT, ...boxes.filter(b => children.has(b.id)).map(b => b.id)].sort(
    (a, b) => depth(b) - depth(a) || (a < b ? -1 : a > b ? 1 : 0),
  );
  const grown = new Map<string, GrownScope>();
  const cuts: Cut[] = [];
  for (const scope of scopes) {
    const kids = children.get(scope) ?? [],
      growing = kids.filter(k => wanted.has(k.id));
    if (!growing.length) {
      // A container asked to open with nothing growing inside: its content rides along unwarped.
      const asked = scope === ROOT ? undefined : wanted.get(scope);
      if (asked) {
        const b = byId.get(scope)!;
        grown.set(scope, {
          x: [],
          y: [],
          assigned: new Map(),
          frame: { x: b.x, y: b.y, ...asked },
        });
      }
      continue;
    }
    const frame = scope === ROOT ? stage : byId.get(scope)!,
      xSpans = kids.map(k => spanOf(k, 'x')),
      ySpans = kids.map(k => spanOf(k, 'y')),
      x: Cut[] = [],
      y: Cut[] = [],
      signs = new Map<string, { x: 1 | -1; y: 1 | -1 }>();
    for (const k of growing) {
      const size = wanted.get(k.id)!,
        xFace = spanOf(k, 'x'),
        yFace = spanOf(k, 'y'),
        xSide = chooseSide(xSpans, xFace, frame.x, frame.x + frame.w, edgesHeld(points, k, 'x')),
        ySide = chooseSide(ySpans, yFace, frame.y, frame.y + frame.h, edgesHeld(points, k, 'y'));
      signs.set(k.id, { x: xSide.dir, y: ySide.dir });
      x.push({
        axis: 'x',
        scope,
        opening: k.id,
        ...bound(xSpans, xFace, xSide, ySide),
        delta: size.w - k.w,
      });
      y.push({
        axis: 'y',
        scope,
        opening: k.id,
        ...bound(ySpans, yFace, ySide, xSide),
        delta: size.h - k.h,
      });
    }
    const assigned = new Map<string, Rect>();
    for (const k of growing) {
      const size = wanted.get(k.id)!,
        sign = signs.get(k.id)!;
      assigned.set(k.id, {
        x: sign.x > 0 ? shift(x, k.x) : shift(x, k.x + k.w) - size.w,
        y: sign.y > 0 ? shift(y, k.y) : shift(y, k.y + k.h) - size.h,
        w: size.w,
        h: size.h,
      });
    }
    const after = hull([warpRect(frame, x, y), ...assigned.values()]);
    grown.set(scope, { x, y, assigned, frame: after });
    cuts.push(...x, ...y);
    if (scope !== ROOT) {
      const own = wanted.get(scope);
      // A container asked to open as well keeps the larger of the two sizes.
      wanted.set(scope, {
        w: Math.max(after.w, own?.w ?? 0),
        h: Math.max(after.h, own?.h ?? 0),
      });
    }
  }

  /**
   * Where a point in `scope`'s original space goes, in that scope's warped space: through the
   * grown child that holds it, placed where the scope put that child, or by the scope's cuts.
   */
  const map = (scope: string, p: Point): Point => {
    const g = grown.get(scope);
    if (!g) return p;
    for (const [id, at] of g.assigned) {
      const was = byId.get(id)!;
      if (!inside(p, was)) continue;
      const inner = grown.get(id);
      if (inner) {
        const q = map(id, p);
        return { x: q.x - inner.frame.x + at.x, y: q.y - inner.frame.y + at.y };
      }
      // A leaf opening: a point on its far edge follows that edge, anything else keeps its offset.
      return {
        x: p.x === was.x + was.w ? at.x + at.w : at.x + (p.x - was.x),
        y: p.y === was.y + was.h ? at.y + at.h : at.y + (p.y - was.y),
      };
    }
    return { x: shift(g.x, p.x), y: shift(g.y, p.y) };
  };

  /** A point in `scope`'s warped space, lifted to the root's. */
  const lift = (scope: string, p: Point): Point => {
    let q = p;
    for (let s = scope; s !== ROOT; s = parentOf(s)) {
      const g = grown.get(s),
        at = grown.get(parentOf(s))?.assigned.get(s);
      if (!g || !at) continue;
      q = { x: q.x - g.frame.x + at.x, y: q.y - g.frame.y + at.y };
    }
    return q;
  };

  /** The nearest scope above `id` that grew. */
  const grownAbove = (id: string) => {
    let s = parentOf(id);
    while (s !== ROOT && !grown.has(s)) s = parentOf(s);
    return s;
  };

  const rects = new Map<string, Rect>();
  for (const b of boxes) {
    const scope = grownAbove(b.id),
      g = grown.get(scope);
    if (!g) {
      rects.set(b.id, { x: b.x, y: b.y, w: b.w, h: b.h });
      continue;
    }
    // The box's own rectangle in that scope: assigned when it grew, warped by the cuts when not.
    // A box under a container that never grew moves with that scope's cuts, like its container.
    const local = g.assigned.get(b.id) ?? warpRect(b, g.x, g.y),
      at = lift(scope, local);
    rects.set(b.id, { x: at.x, y: at.y, w: local.w, h: local.h });
  }

  const root = grown.get(ROOT);
  return {
    rects,
    point: p => map(ROOT, p),
    stage: root ? root.frame : { ...stage },
    cuts,
  };
}

/** Each route's points under the warp. */
export function warpRoutes<R extends { points: readonly Point[] }>(
  routes: readonly R[],
  warp: Pick<Dilation, 'point'>,
): R[] {
  return routes.map(r => ({ ...r, points: r.points.map(p => warp.point(p)) }));
}
