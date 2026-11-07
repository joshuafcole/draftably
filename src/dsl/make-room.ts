/**
 * Open containers in a drawing by making room for them, not by laying the drawing out again: the
 * projection-layer form of `dilate`, for a host that changes which containers are drawn open.
 *
 * The host hands over three things, each an ordinary compiled and routed document:
 *
 * - **`rest`**, the drawing at rest: each container about to open is still a closed card there.
 * - **`opened`**, for each container that opens, a drawing in which it *is* open, with its own
 *   content laid out (and any container opened inside it still closed). Only the container's own
 *   content is read from it; where it put everything else is ignored.
 * - **`final`**, the document to draw: every container open, as the host's source now says.
 *
 * Each opened container's content is placed as its own drawing laid it out. Everything else keeps
 * its place in `rest`, moved only by `dilate`'s cuts. A container opened inside another opened
 * one is warped into its parent's content first, bottom up, so a level only ever moves its own
 * coordinates and the whole is the same whatever order the containers were opened in.
 *
 * Routes keep their points, warped. A route that ended on a card that has opened, and now runs to
 * something inside it, keeps its warped course to the card's frame and continues inside on the
 * course its container's own drawing gave it, joined just inside the frame. A route nothing gives
 * a course for is routed afresh, and named in `rerouted`.
 */
import type { Route, RoutingResult } from '../engines/routing-engine.js';
import { clone } from '../model/geometry';
import { visibleGraph } from '../model/graph';
import { computeRoutes } from '../model/routes';
import type { Diagram, Point, Rect } from '../model/types';
import { type Cut, dilate, type Dilation, type WarpBox } from './dilate';
import { visibleRects } from './project';
import { GROUP_INSET } from './frame';

/** A projected document and the raw routes drawn for it (`computeRoutes(...).result`). */
export interface RoomDrawing {
  doc: Diagram;
  routes: RoutingResult;
}

export interface MadeRoom {
  /** `final`, with every visible object where the warp put it. */
  doc: Diagram;
  /** Routes for `doc`, to draw as they are. */
  routes: RoutingResult;
  /** Every cut taken, per frame: `root`, or the opened container whose content it moved. */
  cuts: Array<Cut & { frame: string }>;
  /** Edges no drawing gave a course for, routed afresh. */
  rerouted: string[];
}

/** Why a drawing could not be warped into `final`; the host lays it out instead. */
export class CannotMakeRoom extends Error {}

const ROOT = 'root';

interface Frame {
  id: string;
  drawing: RoomDrawing;
  boxes: WarpBox[];
  rects: Map<string, Rect>;
  /** The opened container's own frame in its drawing; the root's hull for `rest`. */
  stage: Rect | undefined;
  warp?: Dilation;
  /** Added to a point of this frame's warp to place it in the final drawing. */
  offset: Point;
}

const parents = (doc: Diagram) =>
  new Map([...doc.graph.nodes, ...doc.graph.groups].map(o => [o.id, o.parentId ?? ROOT]));

function isWithin(parentOf: Map<string, string>, id: string, ancestor: string) {
  for (let p = parentOf.get(id); p && p !== ROOT; p = parentOf.get(p))
    if (p === ancestor) return true;
  return false;
}

const add = (p: Point, d: Point): Point => ({ x: p.x + d.x, y: p.y + d.y });
const inRect = (p: Point, r: Rect) =>
  p.x >= r.x - 0.01 && p.x <= r.x + r.w + 0.01 && p.y >= r.y - 0.01 && p.y <= r.y + r.h + 0.01;

/** Where the segment from `a` (inside `r`) to `b` (outside) leaves it. */
function exit(a: Point, b: Point, r: Rect): Point {
  let t = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  if (dx > 0) t = Math.min(t, (r.x + r.w - a.x) / dx);
  if (dx < 0) t = Math.min(t, (r.x - a.x) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.h - a.y) / dy);
  if (dy < 0) t = Math.min(t, (r.y - a.y) / dy);
  t = Math.max(0, t);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

/** The inward normal of the side of `r` that `p` is on. */
function inward(p: Point, r: Rect): Point {
  const d = [
    { n: { x: 1, y: 0 }, d: Math.abs(p.x - r.x) },
    { n: { x: -1, y: 0 }, d: Math.abs(p.x - (r.x + r.w)) },
    { n: { x: 0, y: 1 }, d: Math.abs(p.y - r.y) },
    { n: { x: 0, y: -1 }, d: Math.abs(p.y - (r.y + r.h)) },
  ].sort((a, b) => a.d - b.d);
  return d[0].n;
}

/**
 * Join `q`, where a warped route meets a frame, to `e`, where the course inside it starts, with a
 * short run just inside the frame. `next` is the course's next point, which the run must not pass.
 */
function join(q: Point, e: Point, next: Point | undefined, r: Rect): Point[] {
  if (Math.abs(q.x - e.x) < 0.5 && Math.abs(q.y - e.y) < 0.5) return [q];
  const nq = inward(q, r),
    ne = inward(e, r),
    room = next ? Math.abs(next.x - e.x) + Math.abs(next.y - e.y) : GROUP_INSET,
    d = Math.max(1, Math.min(GROUP_INSET / 2, room / 2)),
    qi = { x: q.x + nq.x * d, y: q.y + nq.y * d },
    ei = { x: e.x + ne.x * d, y: e.y + ne.y * d };
  const along = nq.x === ne.x && nq.y === ne.y;
  // On one side the two inner points line up; round a corner, the run turns once.
  const corner = along ? [] : [nq.x !== 0 ? { x: qi.x, y: ei.y } : { x: ei.x, y: qi.y }];
  return [q, qi, ...corner, ei];
}

/**
 * Warp `rest` so each container in `opened` gets room for its content, and draw `final` there.
 * Throws {@link CannotMakeRoom} when the drawings don't fit together: a container `final` opens
 * that `rest` doesn't draw as a card, or an object neither drawing places.
 */
export function makeRoom(
  rest: RoomDrawing,
  opened: ReadonlyMap<string, RoomDrawing>,
  final: Diagram,
): MadeRoom {
  const finalParent = parents(final),
    finalGroups = new Set(final.graph.groups.map(g => g.id));
  for (const id of opened.keys())
    if (!finalGroups.has(id)) throw new CannotMakeRoom(`${id} is not a container in the drawing`);
  /** The opened container whose content `id` is, or the root. */
  const frameOf = (id: string) => {
    for (let p = finalParent.get(id); p && p !== ROOT; p = finalParent.get(p))
      if (opened.has(p)) return p;
    return ROOT;
  };
  /** The opened containers above `id`, outermost first. */
  const chain = (id: string) => {
    const list: string[] = [];
    for (let p = frameOf(id); p !== ROOT; p = frameOf(p)) list.unshift(p);
    return list;
  };

  const frames = new Map<string, Frame>();
  const restRects = visibleRects(rest.doc).rects,
    restParent = parents(rest.doc);
  frames.set(ROOT, {
    id: ROOT,
    drawing: rest,
    boxes: [...restRects].map(([id, r]) => ({ id, parent: restParent.get(id) ?? ROOT, ...r })),
    rects: restRects,
    stage: undefined,
    offset: { x: 0, y: 0 },
  });
  for (const [id, drawing] of opened) {
    const rects = visibleRects(drawing.doc).rects,
      parentOf = parents(drawing.doc),
      own = rects.get(id);
    if (!own) throw new CannotMakeRoom(`${id} is not drawn open in its own drawing`);
    const boxes: WarpBox[] = [];
    for (const [box, r] of rects) {
      if (!isWithin(parentOf, box, id)) continue;
      const p = parentOf.get(box)!;
      boxes.push({ id: box, parent: p === id ? ROOT : p, ...r });
    }
    frames.set(id, { id, drawing, boxes, rects, stage: own, offset: { x: 0, y: 0 } });
  }

  // Bottom up: a frame's size is its content's warp, and it opens in its parent frame at that size.
  const depth = (id: string) => (id === ROOT ? 0 : chain(id).length + 1);
  const order = [...frames.keys()].sort((a, b) => depth(b) - depth(a) || (a < b ? -1 : 1));
  const cuts: MadeRoom['cuts'] = [];
  for (const id of order) {
    const frame = frames.get(id)!,
      openings = [...opened.keys()]
        .filter(o => frameOf(o) === id)
        .map(o => {
          if (!frame.boxes.some(b => b.id === o))
            throw new CannotMakeRoom(`${o} is not drawn in the drawing it opens in`);
          const grown = frames.get(o)!.warp!.stage;
          return { id: o, w: grown.w, h: grown.h };
        });
    frame.warp = dilate(frame.boxes, openings, {
      routes: frame.drawing.routes.routes,
      ...(frame.stage ? { stage: frame.stage } : {}),
    });
    cuts.push(...frame.warp.cuts.map(c => ({ ...c, frame: id })));
  }
  // Top down: each opened frame is placed where its parent's warp assigned it.
  for (const id of [...order].reverse()) {
    if (id === ROOT) continue;
    const frame = frames.get(id)!,
      parent = frames.get(frameOf(id))!,
      at = parent.warp!.rects.get(id)!;
    frame.offset = {
      x: at.x + parent.offset.x - frame.warp!.stage.x,
      y: at.y + parent.offset.y - frame.warp!.stage.y,
    };
  }

  const doc = clone(final),
    vg = visibleGraph(doc);
  const place = (id: string): Rect => {
    if (opened.has(id)) {
      const parent = frames.get(frameOf(id))!,
        at = parent.warp!.rects.get(id)!;
      return { ...add(at, parent.offset), w: at.w, h: at.h };
    }
    const frame = frames.get(frameOf(id))!,
      r = frame.warp!.rects.get(id);
    if (!r) throw new CannotMakeRoom(`${id} is not drawn where it is opened`);
    return { ...add(r, frame.offset), w: r.w, h: r.h };
  };
  for (const o of [...vg.nodes, ...vg.groups]) {
    const r = place(o.id);
    doc.layout.nodes[o.id] = { ...doc.layout.nodes[o.id], x: r.x, y: r.y, w: r.w, h: r.h };
  }

  const toFinal = (frame: Frame, p: Point) => add(frame.warp!.point(p), frame.offset);
  /** The course inside opened container `id` from `end` out to its frame, in final coordinates. */
  const inner = (id: string, edge: string) => {
    const frame = frames.get(id)!,
      route = frame.drawing.routes.routes.find(r => r.id === edge);
    if (!route) return undefined;
    const box = frame.stage!,
      // The end of this course that is inside the container: the one met at `end`'s side.
      atStart = inRect(route.points[0], box) && !inRect(route.points.at(-1)!, box),
      atEnd = inRect(route.points.at(-1)!, box) && !inRect(route.points[0], box);
    if (!atStart && !atEnd) return undefined;
    const points = atStart ? route.points : [...route.points].reverse(),
      run: Point[] = [points[0]];
    for (let i = 1; i < points.length; i++) {
      if (!inRect(points[i], box)) {
        run.push(exit(points[i - 1], points[i], box));
        break;
      }
      run.push(points[i]);
    }
    const sideOf = atStart
      ? { side: route.fromSide, offset: route.fromOffset }
      : { side: route.toSide, offset: route.toOffset };
    return { points: run.map(p => toFinal(frame, p)), ...sideOf };
  };

  const routes: Route[] = [],
    rerouted: string[] = [];
  for (const e of vg.edges) {
    const a = chain(e.a),
      b = chain(e.b);
    let common = 0;
    while (common < a.length && common < b.length && a[common] === b[common]) common++;
    const host = frames.get(common ? a[common - 1] : ROOT)!,
      route = host.drawing.routes.routes.find(r => r.id === e.id);
    if (!route) {
      rerouted.push(e.id);
      continue;
    }
    let points = route.points.map(p => toFinal(host, p)),
      next: Route = { ...route, from: e.a, to: e.b };
    let whole = true;
    // Each end that is now inside an opened card runs on into it, one frame at a time.
    let joined = false;
    for (const [frames_, atSource] of [
      [a.slice(common), true],
      [b.slice(common), false],
    ] as const) {
      for (const id of frames_) {
        const course = inner(id, e.id);
        if (!course) {
          whole = false;
          break;
        }
        const frame = place(id),
          run = course.points;
        joined = true;
        if (atSource) {
          const q = points[0],
            run_ = join(q, run.at(-1)!, run.at(-2), frame);
          points = [...run.slice(0, -1), ...run_.slice(1).reverse(), ...points];
          next = { ...next, fromSide: course.side, fromOffset: course.offset };
        } else {
          const q = points.at(-1)!,
            run_ = join(q, run.at(-1)!, run.at(-2), frame);
          points = [...points, ...run_.slice(1), ...[...run].reverse().slice(1)];
          next = { ...next, toSide: course.side, toOffset: course.offset };
        }
      }
      if (!whole) break;
    }
    if (!whole) {
      rerouted.push(e.id);
      continue;
    }
    // A warped route keeps every point it had; only a joined one is tidied where it was joined.
    routes.push({ ...next, points: joined ? dedupe(points) : points });
  }
  if (rerouted.length) {
    const { vg: visible, rects } = visibleRects(doc),
      { result } = computeRoutes(doc, visible, rects, { previous: [] }),
      fresh = new Map(result.routes.map(r => [r.id, r]));
    for (const id of rerouted) {
      const r = fresh.get(id);
      if (r) routes.push(r);
    }
  }
  return { doc, routes: { ...rest.routes, routes }, cuts, rerouted };
}

/** Consecutive repeats and points on a straight run, dropped. */
function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out.at(-1);
    if (last && Math.abs(last.x - p.x) < 0.01 && Math.abs(last.y - p.y) < 0.01) continue;
    const before = out.at(-2);
    if (
      before &&
      last &&
      ((Math.abs(before.x - last.x) < 0.01 && Math.abs(last.x - p.x) < 0.01) ||
        (Math.abs(before.y - last.y) < 0.01 && Math.abs(last.y - p.y) < 0.01))
    )
      out.pop();
    out.push(p);
  }
  return out;
}

/** How far relaxation may move a box from where the warp put it, unless the host says otherwise. */
export const RELAX_MAX_MOVE = 48;

export interface RelaxOptions {
  /** Objects that hold still: the opened containers, and whatever around them the reader is reading. */
  fixed: readonly string[];
  /** How far any box may move from where the warp put it, in drawing units. */
  maxMove?: number;
}

/**
 * Smooth what a warp leaves behind, at view time: a warm-started local tidy of `made.doc` from the
 * warped geometry, with `fixed` held and every other box kept within `maxMove` of where the warp
 * put it; then routed afresh. A function of the warped drawing alone, so the same drawing always
 * relaxes the same way. It writes nothing.
 */
export async function relaxRoom(
  made: { doc: Diagram },
  options: RelaxOptions,
): Promise<RoomDrawing> {
  const { LayoutLab } = await import('../engines/layout-engine.js');
  const { document } = await LayoutLab.compute(clone(made.doc), {
    algorithm: 'tidy',
    mode: 'pass',
    scope: 'all',
    maxMove: options.maxMove ?? RELAX_MAX_MOVE,
    fixedIds: [...options.fixed],
    warmStart: true,
  });
  const doc = clone(made.doc);
  for (const [id, r] of Object.entries(document.layout.nodes))
    if (doc.layout.nodes[id])
      doc.layout.nodes[id] = { ...doc.layout.nodes[id], x: r.x, y: r.y, w: r.w, h: r.h };
  const { vg, rects } = visibleRects(doc),
    { result } = computeRoutes(doc, vg, rects, { previous: [] });
  return { doc, routes: result };
}
