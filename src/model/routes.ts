import {
  RouteLab,
  type PriorRoute,
  type Route,
  type RoutingResult,
} from '../engines/routing-engine.js';
import { clamp, contains, inside, manhattan, overlaps, rounded, roundedPath } from './geometry';
import { resolveAppearance, type ResolvedAppearance } from './appearance';
import { measureText } from './fonts';
import { edgeLabelLines, edgeLabelSize, groupTitleLines, SELF_LOOP } from './labels';
import { hasMarkers, markerRects, stoppedPoints } from './markers';
import { hopRects, hoppedPath, hopsOf, labelLeader, placeAlong, type Leader } from './route-marks';
import {
  ancestors,
  findEdge,
  findNode,
  isCell,
  isCollapsed,
  styleOf,
  type VisibleEdge,
  type VisibleGraph,
} from './graph';
import type { Diagram, EdgeLayout, Lane, Point, Rect, ShapeKind, Side } from './types';

export const SIDE_VECTORS: Record<Side, Point> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/** Where a connection meets a shape's outline on the given side. */
export function portPoint(shape: ShapeKind, r: Rect, side: Side, offset = 0): Point {
  let x = r.x + r.w / 2,
    y = r.y + r.h / 2;
  const round = shape === 'circle' || shape === 'icon';
  // A marker's bar is too thin to spread ports along: lines meet it in the middle.
  if (shape === 'marker') offset = 0;
  if (side === 'left' || side === 'right') {
    y += clamp(offset, -r.h / 2 + 12, r.h / 2 - 12);
    let inset = 0;
    if (round)
      inset = (r.w / 2) * (1 - Math.sqrt(Math.max(0, 1 - ((y - r.y - r.h / 2) / (r.h / 2)) ** 2)));
    if (shape === 'diamond') inset = (Math.abs(y - r.y - r.h / 2) / (r.h / 2)) * (r.w / 2);
    x = side === 'left' ? r.x + inset : r.x + r.w - inset;
  } else {
    x += clamp(offset, -r.w / 2 + 12, r.w / 2 - 12);
    let inset = 0;
    if (round)
      inset = (r.h / 2) * (1 - Math.sqrt(Math.max(0, 1 - ((x - r.x - r.w / 2) / (r.w / 2)) ** 2)));
    if (shape === 'diamond') inset = (Math.abs(x - r.x - r.w / 2) / (r.w / 2)) * (r.h / 2);
    y = side === 'top' ? r.y + inset : r.y + r.h - inset;
  }
  return { x: rounded(x), y: rounded(y) };
}

/** Side of `r` facing `p`. */
export function sideToward(r: Rect, p: Point): Side {
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  if (Math.abs(p.x - cx) > Math.abs(p.y - cy)) return p.x > cx ? 'right' : 'left';
  return p.y > cy ? 'bottom' : 'top';
}

export interface EdgeLabelBox extends Point {
  w: number;
  h: number;
  score?: number;
}

/** Lines and borders a label may sit on only when nothing better is free. */
export interface LabelAvoid {
  /** Other edges' routes. Routes that leave from this edge's first point share its trunk. */
  routes?: Point[][];
  /** Thin strips along group borders. */
  borders?: Rect[];
  /** The marks at line ends. A spot that hides one costs as much as a line through the text. */
  marks?: Rect[];
  /** The open group that holds both ends. A spot not inside it costs a little less than a line. */
  home?: Rect;
}

/** Whether an orthogonal segment passes through a rectangle. */
const segmentHits = (a: Point, b: Point, r: Rect) =>
  Math.max(a.x, b.x) > r.x &&
  Math.min(a.x, b.x) < r.x + r.w &&
  Math.max(a.y, b.y) > r.y &&
  Math.min(a.y, b.y) < r.y + r.h;

/** A spot for an edge's label, with what it crosses (`cost`) and how well it reads (`score`). */
interface LabelSpot extends EdgeLabelBox {
  cost: number;
  score: number;
}

/** `r` grown by `d` on every side. */
const grown = (r: Rect, d: number) => ({ x: r.x - d, y: r.y - d, w: r.w + 2 * d, h: r.h + 2 * d });

/** Room a label wants between itself and another edge's line. */
const LINE_CLEARANCE = 8;

/**
 * Every spot on the edge's own route, or just beside it, that covers no shape or group title.
 * Another edge through the text misleads the reader (5) and one through its padding seems to stop
 * at it (3); a line touching it or a group border under it (2), or a line within
 * `LINE_CLEARANCE` or a shared trunk (1), only crowds it.
 */
/** Gap a label keeps from a box when its line offers a spot that far away. */
const BOX_CLEARANCE = 10;

function labelSpots(
  label: string,
  points: Point[],
  obstacles: Rect[],
  look: ResolvedAppearance,
  avoid: LabelAvoid,
) {
  const { w, h } = edgeLabelSize(label, look),
    spots: LabelSpot[] = [];
  const box = (p: Point) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
  const start = points[0],
    lines = (avoid.routes ?? []).map(route => ({
      route,
      shared: !!start && !!route[0] && manhattan(route[0], start) < 1,
    }));
  // The text itself, inside the label's padding: 8px each side, its lines of the annotation type.
  const ink =
    look.annotation.size + (edgeLabelLines(label, look).length - 1) * look.annotation.lineHeight;
  const cost = (p: Point) => {
    const r = box(p),
      text = { x: r.x + 8, y: p.y - ink / 2, w: Math.max(1, w - 16), h: ink },
      through = grown(r, -1),
      touch = grown(r, 3),
      near = grown(r, LINE_CLEARANCE);
    let c = 0;
    for (const { route, shared } of lines) {
      const hits = (q: Rect) => route.some((s, i) => i && segmentHits(route[i - 1], s, q));
      if (hits(text)) c += shared ? 1 : 5;
      else if (hits(through)) c += shared ? 1 : 3;
      else if (!shared && hits(touch)) c += 2;
      else if (!shared && hits(near)) c += 1;
    }
    for (const b of avoid.borders ?? []) if (overlaps(r, b, 2)) c += 2;
    for (const m of avoid.marks ?? []) if (overlaps(r, m, 1)) c += 5;
    if (avoid.home && !contains(grown(avoid.home, -2), r)) c += 4;
    // A label pressed against a box reads as part of it; a spot a little further along is clearer.
    if (obstacles.some(o => overlaps(r, o, BOX_CLEARANCE))) c += 1;
    return c;
  };
  // Shifts across an upright segment that put the label's edge just past a parallel line beside
  // it, keeping the segment at least 6px inside the label.
  const beside = (a: Point, b: Point) => {
    const lo = Math.min(a.y, b.y) - h,
      hi = Math.max(a.y, b.y) + h,
      out: number[] = [];
    for (const { route } of lines)
      for (let i = 1; i < route.length; i++) {
        const p = route[i - 1],
          q = route[i];
        if (p.x !== q.x || Math.max(p.y, q.y) < lo || Math.min(p.y, q.y) > hi) continue;
        const d = p.x - a.x;
        if (!d || Math.abs(d) > w) continue;
        const offset = d < 0 ? d + 4 + w / 2 : d - 4 - w / 2;
        if (Math.abs(offset) <= w / 2 - 6 && Math.abs(offset) > h - 4) out.push(offset);
      }
    return out;
  };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      len = manhattan(a, b);
    if (len < 8) continue;
    const flat = a.y === b.y,
      base = len + (flat ? 50 : 0),
      // Beside a level segment the label sits just above or below it; a vertical segment runs
      // through the label, which may shift a little to either side, or far enough to clear a
      // line running alongside while its own line still crosses it. A short line with marks
      // adds a spot a step further out, which clears the tallest mark.
      clear = avoid.marks?.length ? [-(h / 2 + 7), h / 2 + 7] : [],
      offsets = flat
        ? [0, -(h / 2 + 4), h / 2 + 4, ...clear]
        : [0, -(h - 4), h - 4, ...beside(a, b)],
      steps = Math.max(2, Math.ceil(len / 6));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps,
        along = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      for (const offset of offsets) {
        const p = flat ? { x: along.x, y: along.y + offset } : { x: along.x + offset, y: along.y };
        if (obstacles.some(o => overlaps(box(p), o, 4))) continue;
        spots.push({
          ...p,
          w,
          h,
          cost: cost(p),
          // Prefer long level segments, the middle of a segment, on the line, then above it.
          score: base - Math.abs(t - 0.5) * len * 0.5 - Math.abs(offset) * 3 + (offset < 0 ? 1 : 0),
        });
      }
    }
  }
  return { w, h, spots, cost };
}

/** One edge label for `placeEdgeLabels`: its text, its route, and what it should keep clear of. */
export interface LabelJob {
  label: string;
  points: Point[];
  avoid?: LabelAvoid;
  /** The user's nudge, added to the chosen spot. */
  dx?: number;
  dy?: number;
}

/**
 * Place every edge label at once, after all routes exist. Each label takes a spot on its own
 * route that covers no shape, group title or other label, and crosses as few other lines as it
 * can; a label closer to another than its own height costs as much as a line beside it. Labels
 * with a clean spot go first, then one repair sweep moves each label to its best spot given all
 * the others. Only a label with every spot near its route blocked moves away from it, and then as
 * little as possible.
 */
export function placeEdgeLabels(
  jobs: LabelJob[],
  obstacles: Rect[],
  look: ResolvedAppearance = resolveAppearance(),
  fixed: Rect[] = [],
): EdgeLabelBox[] {
  const prepared = jobs.map(j => labelSpots(j.label, j.points, obstacles, look, j.avoid ?? {})),
    chosen: Array<EdgeLabelBox | null> = jobs.map(() => null);
  const rectOf = (i: number, s: EdgeLabelBox) => ({
    x: s.x + (jobs[i].dx ?? 0) - s.w / 2,
    y: s.y + (jobs[i].dy ?? 0) - s.h / 2,
    w: s.w,
    h: s.h,
  });
  const pick = (i: number): EdgeLabelBox => {
    const others = [...fixed, ...chosen.flatMap((c, k) => (k !== i && c ? [rectOf(k, c)] : []))],
      { w, h, spots, cost } = prepared[i];
    let best: LabelSpot | null = null,
      bestCost = Infinity;
    for (const s of spots) {
      const r = rectOf(i, s);
      if (others.some(o => overlaps(r, o, 6))) continue;
      const c = s.cost + others.filter(o => overlaps(r, o, h)).length;
      if (c < bestCost || (c === bestCost && s.score > best!.score)) [best, bestCost] = [s, c];
    }
    if (best) {
      const { cost: _cost, ...spot } = best;
      return spot;
    }
    const box = (p: Point) => ({ x: p.x - w / 2, y: p.y - h / 2, w, h });
    return shiftedLabel(
      jobs[i].points,
      w,
      h,
      obstacles,
      others,
      p => obstacles.some(o => overlaps(box(p), o, 4)) || others.some(o => overlaps(box(p), o, 6)),
      cost,
      jobs[i].avoid?.home,
    );
  };
  // Labels with a clean spot go first, so one that crosses lines wherever it goes never takes it.
  const least = prepared.map(p => Math.min(Infinity, ...p.spots.map(s => s.cost))),
    order = jobs.map((_, i) => i).sort((a, b) => least[a] - least[b] || a - b);
  for (const i of order) chosen[i] = pick(i);
  for (const i of order) chosen[i] = pick(i);
  return chosen.map((c, i) => ({
    ...c!,
    x: c!.x + (jobs[i].dx ?? 0),
    y: c!.y + (jobs[i].dy ?? 0),
  }));
}

/**
 * Choose a label spot on the edge's own route, clear of the labels already placed: see
 * `placeEdgeLabels`.
 */
export function placeEdgeLabel(
  label: string,
  points: Point[],
  obstacles: Rect[],
  existing: Rect[] = [],
  look: ResolvedAppearance = resolveAppearance(),
  avoid: LabelAvoid = {},
): EdgeLabelBox {
  return placeEdgeLabels([{ label, points, avoid }], obstacles, look, existing)[0];
}

/** Last resort when every spot on or beside the route is covered: the nearest clear spot. */
function shiftedLabel(
  points: Point[],
  w: number,
  h: number,
  obstacles: Rect[],
  existing: Rect[],
  blocked: (p: Point) => boolean,
  cost: (p: Point) => number = () => 0,
  home?: Rect,
): EdgeLabelBox {
  const shifted: EdgeLabelBox[] = [];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      len = manhattan(a, b);
    if (!len) continue;
    const nx = a.y === b.y ? 0 : a.x === b.x ? 1 : -(b.y - a.y) / len,
      ny = a.y === b.y ? 1 : a.x === b.x ? 0 : (b.x - a.x) / len,
      radius = (w * Math.abs(nx) + h * Math.abs(ny)) / 2,
      pScore = len + (a.y === b.y ? 50 : 0),
      // Slides along the segment, up to the label's own length, so it can step past a line that
      // crosses the spot beside a short gap.
      reach = w * Math.abs(ny) + h * Math.abs(nx),
      slides = Array.from(
        { length: 2 * Math.ceil(reach / 6) + 1 },
        (_, k) => (k - Math.ceil(reach / 6)) * 6,
      );
    for (const t of [0.5, 0.35, 0.65]) {
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        along = p.x * nx + p.y * ny,
        offsets = new Set<number>();
      for (const [rects, pad] of [
        [obstacles, 5],
        [existing, 7],
      ] as const) {
        for (const o of rects) {
          const cx = o.x + o.w / 2,
            cy = o.y + o.h / 2,
            center = cx * nx + cy * ny,
            extent = (o.w * Math.abs(nx) + o.h * Math.abs(ny)) / 2 + radius + pad + 1;
          offsets.add(center - extent - along);
          offsets.add(center + extent - along);
        }
      }
      // Just inside the label's own group, where a short gap leaves room only by its frame.
      if (home) {
        const center = (home.x + home.w / 2) * nx + (home.y + home.h / 2) * ny,
          extent = (home.w * Math.abs(nx) + home.h * Math.abs(ny)) / 2 - radius - 2;
        offsets.add(center - extent - along);
        offsets.add(center + extent - along);
      }
      for (const offset of offsets)
        for (const slide of offset ? slides : []) {
          const q = { x: p.x + nx * offset + ny * slide, y: p.y + ny * offset - nx * slide };
          if (blocked(q)) continue;
          shifted.push({ ...q, w, h, score: pScore - (Math.abs(offset) + Math.abs(slide)) * 2 });
        }
    }
  }
  // The nearest spot, where a line through the text (cost 5) counts as 40px further: the label
  // may step past a line or two, or out of its group, but never flees far from its edge.
  const rank = new Map(shifted.map(s => [s, s.score! - cost(s) * 16]));
  shifted.sort((a, b) => rank.get(b)! - rank.get(a)!);
  const a = points[0] || { x: 0, y: 0 },
    b = points[1] || a;
  return shifted[0] || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w, h };
}

export interface DrawnRoute extends Route {
  label: EdgeLabelBox | null;
  path: string;
  /**
   * Short pieces of the line where it crosses another line or a group's frame: the only places a
   * canvas-colored halo is drawn under it, so the crossing reads as a clean break. Empty when the
   * line crosses nothing.
   */
  halo: string;
  /**
   * For a line to or from a cell with no side on its group's outline: the stretch from the outline
   * across other cells to that cell's edge. It is drawn over the cells, with a dot at the edge.
   */
  cross?: [Point, Point];
  /** A label standing clear of its line: the leader that ties it back (`route-marks.ts`). */
  leader?: Leader;
  /** A soft `route` the router found no way through, so the line was routed without it. */
  gaveWay?: boolean;
}

export interface SceneRoutes {
  routes: DrawnRoute[];
  result: RoutingResult;
}

/** Room a group's header icon and title take from its left edge, as GroupView draws them. */
function titleWidth(title: string, w: number, look: ResolvedAppearance, lines?: number) {
  const text = groupTitleLines(title, w, look, lines);
  return 33 + Math.max(...text.map(t => measureText(t, look.groupTitle))) + 8;
}

/** How far inside a box's corner a lane turns. */
const LANE_INSET = 12;
/** How far off a side's middle a return or skip lane arrives: one port gap. */
const LANE_PORT = 16;

/**
 * An edge's routing settings, with its lane turned into bends and sides: out of the source to
 * the lane, along it, and into the target. A lane with `leave` or `enter` turns at that coordinate beside
 * the source or target, to meet it side on. A lane that no longer lies between the two ends (a
 * node was dragged across it) is ignored, as is any lane on an edge with its own bends.
 */
export function laneBends(cfg: EdgeLayout, a: Rect, b: Rect): EdgeLayout {
  const { lane, ...rest } = cfg;
  if (!lane || cfg.waypoints?.length) return rest;
  const level = 'y' in lane,
    at = 'y' in lane ? lane.y : lane.x,
    [u, v] = level ? (['x', 'y'] as const) : (['y', 'x'] as const),
    depth = (r: Rect) => (level ? r.h : r.w),
    length = (r: Rect) => (level ? r.w : r.h);
  if (lane.out) return outLane(rest, lane, a, b);
  if (!(a[v] + depth(a) < at && at < b[v])) return rest;
  const point = (along: number, across: number) =>
    level ? { x: rounded(along), y: rounded(across) } : { x: rounded(across), y: rounded(along) };
  // Every turn sits at a box's corner, inset like a port: on the side nearest the lane, at the
  // end the line runs toward. A port anywhere on that side then runs on without doubling back.
  const back = b[u] + length(b) / 2 < a[u] + length(a) / 2,
    waypoints =
      lane.leave !== undefined
        ? [point(lane.leave, a[v] + depth(a) - LANE_INSET), point(lane.leave, at)]
        : [point(back ? a[u] + LANE_INSET : a[u] + length(a) - LANE_INSET, at)];
  if (lane.enter !== undefined)
    waypoints.push(point(lane.enter, at), point(lane.enter, b[v] + LANE_INSET));
  else waypoints.push(point(back ? b[u] + length(b) - LANE_INSET : b[u] + LANE_INSET, at));
  // The lane decides which way the edge leaves and arrives, so the router needn't try the rest.
  return {
    fromSide: lane.leave !== undefined ? (level ? 'right' : 'bottom') : level ? 'bottom' : 'right',
    toSide: lane.enter !== undefined ? (level ? 'left' : 'top') : level ? 'top' : 'left',
    ...rest,
    waypoints: waypoints.filter((p, i) => !i || manhattan(p, waypoints[i - 1]) >= 1),
  };
}

/**
 * A return or skip lane beyond both ends (`Lane.out`): out of the source's side facing the lane,
 * from its corner toward the target, along the lane, and at `enter` into the target's side facing
 * back toward the source. Ignored once an end has moved past the lane or the turn.
 */
function outLane(rest: EdgeLayout, lane: Lane, a: Rect, b: Rect): EdgeLayout {
  const level = 'y' in lane,
    at = 'y' in lane ? lane.y : lane.x,
    [u, v] = level ? (['x', 'y'] as const) : (['y', 'x'] as const),
    depth = (r: Rect) => (level ? r.h : r.w),
    length = (r: Rect) => (level ? r.w : r.h),
    before = at < a[v],
    back = b[u] + length(b) / 2 < a[u] + length(a) / 2,
    enter = lane.enter;
  const beyond = (r: Rect) => (before ? at < r[v] : at > r[v] + depth(r));
  if (enter === undefined || !beyond(a) || !beyond(b)) return rest;
  const point = (along: number, across: number) =>
    level ? { x: rounded(along), y: rounded(across) } : { x: rounded(across), y: rounded(along) };
  if (lane.face) {
    // Square into the target's face toward the lane: the gap beside it holds another label.
    if (enter < b[u] || enter > b[u] + length(b)) return rest;
    const toward = level ? (before ? 'top' : 'bottom') : before ? 'left' : 'right';
    return {
      fromSide: toward,
      toSide: toward,
      ...rest,
      waypoints: [
        point(back ? a[u] + LANE_INSET : a[u] + length(a) - LANE_INSET, at),
        point(enter, at),
      ],
    };
  }
  if (back ? enter <= b[u] + length(b) : enter >= b[u]) return rest;
  const offset = (before ? -1 : 1) * Math.min(LANE_PORT, depth(b) / 2 - LANE_INSET);
  return {
    fromSide: level ? (before ? 'top' : 'bottom') : before ? 'left' : 'right',
    toSide: level ? (back ? 'right' : 'left') : back ? 'bottom' : 'top',
    ...rest,
    waypoints: [
      point(back ? a[u] + LANE_INSET : a[u] + length(a) - LANE_INSET, at),
      point(enter, at),
      // Into the target one port gap off its middle, on the lane's side: clear of the flow's
      // own line through the middle of that side.
      point(enter, b[v] + depth(b) / 2 + offset),
    ],
    toOffset: offset,
  };
}

/** Engine input for the visible part of a diagram with the given rectangles. */
const centre = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** The side among `sides` that faces `toward` most. */
function facing(r: Rect, sides: Side[], toward: Point) {
  const c = centre(r),
    d = { x: toward.x - c.x, y: toward.y - c.y };
  const score = (s: Side) => SIDE_VECTORS[s].x * d.x + SIDE_VECTORS[s].y * d.y;
  return sides.reduce((a, b) => (score(b) > score(a) ? b : a));
}

/** How far outside the outline a line to a cell with no free side ends its routed part. */
const STUB_GAP = 14;

/** A line's end at a cell whose sides are all inside its group. */
interface CrossEnd {
  /** The outline side it enters by, and a thin stub just outside it that the router aims for. */
  side: Side;
  stub: Rect;
  /** From just outside the outline to the cell's edge. */
  cross: [Point, Point];
}

/**
 * Where lines meet cells. A cell can be reached only through the sides it has on its group's
 * outline (its top faces the title band), so a line ends on the free side facing its other end.
 * A cell with no free side is reached across the cells in the way, from the outline side facing
 * the other end: the router aims for a stub outside the outline, and the line runs on from there.
 */
function cellEnds(doc: Diagram, vg: VisibleGraph, rects: Map<string, Rect>) {
  const sides = new Map<string, { from?: Side; to?: Side }>(),
    crosses = new Map<string, { from?: CrossEnd; to?: CrossEnd }>();
  for (const e of vg.edges) {
    const cfg = doc.layout.edges[e.id] || {};
    for (const [end, id, other, set] of [
      ['from', e.a, e.b, cfg.fromSide],
      ['to', e.b, e.a, cfg.toSide],
    ] as const) {
      const r = rects.get(id),
        g = rects.get(findNode(doc, id)?.parentId ?? ''),
        o = rects.get(other);
      if (set || !r || !g || !o || !isCell(doc, id)) continue;
      const near = (a: number, b: number) => Math.abs(a - b) < 0.5;
      const free: Side[] = [
        ...(near(r.x, g.x) ? (['left'] as const) : []),
        ...(near(r.x + r.w, g.x + g.w) ? (['right'] as const) : []),
        ...(r.y + r.h > g.y + g.h - 0.5 ? (['bottom'] as const) : []),
      ];
      if (free.length) {
        sides.set(e.id, { ...sides.get(e.id), [end]: facing(r, free, centre(o)) });
        continue;
      }
      const side = facing(g, ['left', 'right', 'top', 'bottom'], centre(o)),
        c = centre(r),
        out = SIDE_VECTORS[side],
        // The stub sits clear of the outline, so the router keeps its distance from the cells.
        at = {
          x: (side === 'left' ? g.x : side === 'right' ? g.x + g.w : c.x) + out.x * STUB_GAP,
          y: (side === 'top' ? g.y : side === 'bottom' ? g.y + g.h : c.y) + out.y * STUB_GAP,
        },
        edge = {
          x: side === 'left' ? r.x : side === 'right' ? r.x + r.w : c.x,
          y: side === 'top' ? r.y : side === 'bottom' ? r.y + r.h : c.y,
        },
        stub = out.y
          ? { x: at.x - 16, y: out.y < 0 ? at.y - 2 : at.y, w: 32, h: 2 }
          : { x: out.x < 0 ? at.x - 2 : at.x, y: at.y - 16, w: 2, h: 32 };
      crosses.set(e.id, {
        ...crosses.get(e.id),
        [end]: { side, stub, cross: [at, edge] },
      });
      sides.set(e.id, { ...sides.get(e.id), [end]: side });
    }
  }
  return { sides, crosses };
}

/** What the router reads of an edge's layout: not where its label sits, nor how soft its bends are. */
function routingCfg(cfg: EdgeLayout | undefined): EdgeLayout {
  if (!cfg) return {};
  const { labelAt: _at, softRoute: _soft, ...rest } = cfg;
  return rest;
}

/**
 * A soft `route` the router found no way through gives way: those lines are routed again
 * without their bends, and their new routes replace the blocked ones. Others keep theirs.
 */
function givenWay(doc: Diagram, vg: VisibleGraph, rects: Map<string, Rect>, result: RoutingResult) {
  const soft = result.routes.filter(
    r =>
      r.blocked && doc.layout.edges[r.id]?.softRoute && doc.layout.edges[r.id]?.waypoints?.length,
  );
  if (!soft.length) return { result, gave: new Set<string>() };
  const gave = new Set(soft.map(r => r.id)),
    edges = { ...doc.layout.edges };
  for (const id of gave) edges[id] = { ...edges[id], waypoints: undefined, softRoute: undefined };
  const bare = { ...doc, layout: { ...doc.layout, edges } },
    { input, settings, key } = routingKey(bare, vg, rects, {}),
    again = recent.get(key) ?? RouteLab.compute(input, settings);
  keep(key, again);
  const by = new Map(again.routes.map(r => [r.id, r]));
  return {
    result: {
      ...result,
      routes: result.routes.map(r => (gave.has(r.id) ? (by.get(r.id) ?? r) : r)),
    },
    gave,
  };
}

export function routeInput(doc: Diagram, vg: VisibleGraph, all: Map<string, Rect>) {
  const look = resolveAppearance(doc.appearance),
    { sides, crosses } = cellEnds(doc, vg, all);
  // A line to a cell with no free side is routed to its stub outside the outline. A line to an
  // open group ends on the group's frame: a stub the frame's size, inside the group, so the frame
  // is not an obstacle to its own line. Lines at one group share its stub; a stub per line would
  // cover the others' ends and block them.
  const stubs = new Map<string, Rect>(),
    stubParent = new Map<string, string>(),
    framed = new Set(vg.groups.filter(g => !g.frame && !isCollapsed(doc, g.id)).map(g => g.id));
  for (const e of vg.edges) {
    const c = crosses.get(e.id);
    if (c?.from) stubs.set(`${e.id}:from`, c.from.stub);
    if (c?.to) stubs.set(`${e.id}:to`, c.to.stub);
    for (const [end, id] of [
      ['from', e.a],
      ['to', e.b],
    ] as const)
      if (framed.has(id) && !c?.[end]) {
        stubs.set(`${id}:frame`, all.get(id)!);
        stubParent.set(`${id}:frame`, id);
      }
  }
  const rects = all;
  return {
    nodes: [
      ...vg.nodes.map(n => {
        const r = rects.get(n.id)!,
          shape = styleOf(doc, n.id).shape;
        // The router keeps ports 12px in from a corner; a marker's thin bar gets room to meet
        // lines at its middle.
        return shape === 'marker' && r.w < 32
          ? { ...n, ...r, x: r.x + r.w / 2 - 16, w: 32, shape }
          : { ...n, ...r, shape };
      }),
      ...[...stubs].map(([id, r]) => ({
        id,
        title: '',
        ...r,
        shape: 'box' as ShapeKind,
        ...(stubParent.has(id) ? { parentId: stubParent.get(id), frame: true } : {}),
      })),
    ],
    // A soft or frameless group has no border for a line to cross or run along.
    groups: vg.groups
      .filter(g => !g.frame)
      .map(g => {
        const r = rects.get(g.id)!;
        return {
          ...g,
          ...r,
          collapsed: isCollapsed(doc, g.id),
          titleWidth: titleWidth(g.title, r.w, look, g.titleLines),
          // A wrapped title makes the band it blocks taller by a line per extra line.
          ...(g.titleLines
            ? { titleHeight: 28 + (g.titleLines - 1) * look.groupTitle.lineHeight }
            : {}),
        };
      }),
    // Sequence messages are drawn straight on their rows (`messageRoute`), not routed.
    edges: vg.edges
      .filter(e => doc.layout.edges[e.id]?.row === undefined)
      .map(e => {
        const end = (key: string, id: string) =>
            stubs.has(key) ? key : stubs.has(`${id}:frame`) ? `${id}:frame` : id,
          from = end(`${e.id}:from`, e.a),
          to = end(`${e.id}:to`, e.b),
          side = sides.get(e.id);
        return {
          ...e,
          from,
          to,
          cfg: laneBends(
            {
              ...routingCfg(doc.layout.edges[e.id]),
              ...(side?.from ? { fromSide: side.from } : {}),
              ...(side?.to ? { toSide: side.to } : {}),
            },
            stubs.get(from) ?? rects.get(e.a)!,
            stubs.get(to) ?? rects.get(e.b)!,
          ),
        };
      }),
  };
}

/** Line a label wants left showing at each end of its run, as the compiler sizes a gap. */
const LABEL_RUN = 14;
/** Shortest run a slid bend leaves at the other end, for the corner and an arrowhead. */
const BEND_STUB = 16;
/** Closest a slid segment may run beside another line. */
const BEND_PARALLEL = 8;

/**
 * A labelled route with no run the label clears slides one bend along, so one run holds the label
 * away from the bend; a label on the corner reads as part of neither run. `w` and `h` are the
 * label's box. The bend moves the least that gives a run the label plus `LABEL_RUN` at each end,
 * or as close to that as the route allows while the label still clears both ends. The move stands
 * only when the route stays out of every box, crosses no more lines and runs beside no more.
 */
export function roomForLabel(
  points: Point[],
  w: number,
  h: number,
  boxes: Rect[],
  others: Point[][],
): Point[] {
  const level = (a: Point, b: Point) => Math.abs(a.y - b.y) < 0.5,
    // A label sits beside a level run, which must clear its width; an upright run passes through
    // the label and must show `LABEL_RUN` of line above and below it.
    clear = (ps: Point[]) =>
      ps
        .slice(1)
        .some((b, i) => manhattan(ps[i], b) >= (level(ps[i], b) ? w + 8 : h + 2 * LABEL_RUN));
  if (clear(points)) return points;
  // Another line crossing a segment, or running beside it closer than `BEND_PARALLEL`.
  const beside = (s: Seg, t: Seg) => {
    if (level(...s) !== level(...t)) return false;
    const c = level(...s) ? 'y' : 'x',
      d = c === 'y' ? 'x' : 'y';
    return (
      Math.abs(s[0][c] - t[0][c]) < BEND_PARALLEL &&
      Math.min(Math.max(s[0][d], s[1][d]), Math.max(t[0][d], t[1][d])) >
        Math.max(Math.min(s[0][d], s[1][d]), Math.min(t[0][d], t[1][d]))
    );
  };
  const conflicts = (ps: Point[]) =>
    segsOf(ps).reduce(
      (n, s) =>
        n +
        others.reduce(
          (m, o) => m + segsOf(o).filter(t => crossing(s, t) || beside(s, t)).length,
          0,
        ),
      0,
    );
  const before = conflicts(points);
  let best: Point[] | null = null,
    moved = Infinity;
  // Segment `i` runs from points[i] to points[i + 1]; it moves across itself, which lengthens one
  // neighbouring run and shortens the other.
  for (let i = 1; i + 2 < points.length; i++) {
    const [p, a, b, q] = points.slice(i - 1, i + 3),
      c = level(a, b) ? 'y' : 'x',
      need = (level(a, b) ? h : w) + 2 * LABEL_RUN,
      enough = (level(a, b) ? h : w) + 8,
      span = Math.abs(q[c] - p[c]) - BEND_STUB;
    // Both neighbours must run the same way, so the bend can slide between their far ends.
    if (Math.sign(a[c] - p[c]) !== Math.sign(q[c] - b[c]) || span < enough) continue;
    const dir = Math.sign(q[c] - p[c]),
      run = Math.min(need, span);
    for (const v of [p[c] + dir * run, q[c] - dir * run]) {
      const next = points.map((pt, j) => (j === i || j === i + 1 ? { ...pt, [c]: v } : pt)),
        changed = next.slice(i - 1, i + 3);
      if (Math.abs(v - a[c]) >= moved || Math.abs(v - a[c]) < 0.5) continue;
      // The ends keep their ports; the slid segment itself keeps clear of boxes and borders.
      if (segsOf(changed).some(([s, t]) => boxes.some(r => segmentHits(s, t, r)))) continue;
      if (boxes.some(r => segmentHits(next[i], next[i + 1], grown(r, BEND_PARALLEL)))) continue;
      if (conflicts(next) > before) continue;
      best = next;
      moved = Math.abs(v - a[c]);
    }
  }
  return best ?? points;
}

/** Add label positions and SVG paths to raw routes. */
export function drawRoutes(
  doc: Diagram,
  vg: VisibleGraph,
  rects: Map<string, Rect>,
  result: RoutingResult,
): DrawnRoute[] {
  const obstacles: Rect[] = vg.nodes.map(n => rects.get(n.id)!),
    borders: Rect[] = [],
    open = new Map<string, Rect>();
  for (const g of vg.groups) {
    const r = rects.get(g.id)!;
    if (g.frame) continue;
    if (isCollapsed(doc, g.id)) {
      obstacles.push(r);
      continue;
    }
    open.set(g.id, r);
    obstacles.push({ x: r.x, y: r.y, w: r.w, h: 32 });
    borders.push(
      { x: r.x - 1, y: r.y, w: 2, h: r.h },
      { x: r.x + r.w - 1, y: r.y, w: 2, h: r.h },
      { x: r.x, y: r.y + r.h - 1, w: r.w, h: 2 },
    );
  }
  const look = resolveAppearance(doc.appearance),
    byEdge = new Map(vg.edges.map(e => [e.id, e])),
    radius = doc.settings.routing?.cornerRadius ?? 6,
    { crosses } = cellEnds(doc, vg, rects);
  const message = (route: Route) => doc.layout.edges[route.id]?.row !== undefined;
  const gave = givenWay(doc, vg, rects, result);
  result = gave.result;
  // A line to a cell with no free side runs on from its stub across the cells to that cell.
  result = {
    ...result,
    routes: [
      ...result.routes
        .filter(r => doc.layout.edges[r.id]?.row === undefined)
        .map(route => {
          const c = crosses.get(route.id);
          if (!c) return route;
          return {
            ...route,
            points: [
              ...(c.from ? [c.from.cross[1], c.from.cross[0]] : []),
              ...route.points,
              ...(c.to ? [c.to.cross[0], c.to.cross[1]] : []),
            ],
          };
        }),
      ...vg.edges.flatMap(e => {
        const row = doc.layout.edges[e.id]?.row;
        return row === undefined ? [] : [messageRoute(e, row, rects.get(e.a)!, rects.get(e.b)!)];
      }),
    ],
  };
  // A label too long for every run of its line gets a run of its own: the bend slides along,
  // unless the label's best spot on the moved line crosses or crowds more than it did.
  result = {
    ...result,
    routes: result.routes.map((route, i) => {
      const label = byEdge.get(route.id)?.label;
      if (
        !label ||
        route.blocked ||
        message(route) ||
        doc.layout.edges[route.id]?.waypoints?.length
      )
        return route;
      const { w, h } = edgeLabelSize(label, look),
        others = result.routes.filter((_, j) => j !== i).map(r => r.points),
        points = roomForLabel(route.points, w, h, [...obstacles, ...borders], others),
        best = (ps: Point[]) =>
          Math.min(
            ...labelSpots(label, ps, obstacles, look, { routes: others, borders }).spots.map(
              s => s.cost,
            ),
          );
      return points === route.points || best(points) > best(route.points)
        ? route
        : { ...route, points };
    }),
  };
  // `routing hops=on`: an arc where one line passes over another. Sequence messages never hop.
  const hops =
    doc.settings.routing?.hops === 'on'
      ? hopsOf(result.routes.map(r => ({ id: r.id, points: message(r) ? [] : r.points })))
      : null;
  // A plain arrow claims no room, so a diagram without markers places its labels as it did. A hop's
  // arc is a mark too: a label placed for itself keeps off it, as #629 had it (an authored place
  // is not moved).
  const marks = [
    ...result.routes.flatMap(route => {
      const edge = findEdge(doc, route.id);
      return edge && hasMarkers(edge) ? markerRects(route.points, edge) : [];
    }),
    ...(hops ? hopRects(hops) : []),
  ];
  // A label's home is the nearest open group that holds both ends of its edge.
  const home = (e: VisibleEdge) => {
    const up = new Set(ancestors(doc, e.b));
    return open.get(ancestors(doc, e.a).find(g => up.has(g) && open.has(g)) ?? '');
  };
  // An authored label sits where its `label` statement puts it, and the others keep clear of it.
  const placed = new Map<Route, EdgeLabelBox>();
  for (const route of result.routes) {
    const label = byEdge.get(route.id)!.label,
      cfg = doc.layout.edges[route.id] || {};
    if (!label || message(route) || !cfg.labelAt) continue;
    const { w, h } = edgeLabelSize(label, look),
      at = placeAlong(route.points, cfg.labelAt.at, cfg.labelAt.offset);
    placed.set(route, { x: at.x + (cfg.labelDx || 0), y: at.y + (cfg.labelDy || 0), w, h });
  }
  // Labels are placed together once every route exists, so none sits on a line drawn after it.
  const labelled = result.routes.filter(
      route => byEdge.get(route.id)!.label && !message(route) && !placed.has(route),
    ),
    boxes = placeEdgeLabels(
      labelled.map(route => {
        const cfg = doc.layout.edges[route.id] || {};
        return {
          label: byEdge.get(route.id)!.label!,
          points: route.points,
          avoid: {
            routes: result.routes.filter(r => r !== route).map(r => r.points),
            borders,
            marks,
            home: home(byEdge.get(route.id)!),
          },
          dx: cfg.labelDx || 0,
          dy: cfg.labelDy || 0,
        };
      }),
      obstacles,
      look,
      [...placed.values()].map(b => ({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h })),
    ),
    labels = new Map([...placed, ...labelled.map((route, i) => [route, boxes[i]] as const)]);
  // A sequence message's label sits just above its line, centred between the two lifelines, or
  // beside a self-message's loop, so it never hides the arrow and every row reads the same way.
  for (const route of result.routes) {
    const label = byEdge.get(route.id)!.label;
    if (!label || !message(route)) continue;
    const { w, h } = edgeLabelSize(label, look, true),
      [a, b] = [route.points[0], route.points[route.points.length - 1]];
    labels.set(
      route,
      route.from === route.to
        ? {
            x: route.points[1].x + SELF_LOOP.label + w / 2,
            y: (route.points[1].y + route.points[2].y) / 2,
            w,
            h,
          }
        : { x: (a.x + b.x) / 2, y: a.y - h / 2 - 1, w, h },
    );
  }
  const frames = vg.groups.flatMap(g =>
    g.frame || isCollapsed(doc, g.id) ? [] : [rects.get(g.id)!],
  );
  const whole = wholeLines(
    result.routes.map(r => {
      const edge = findEdge(doc, r.id);
      return { points: r.points, marks: edge ? markerRects(r.points, edge) : [] };
    }),
  );
  const drawn = result.routes.map((route, i) => {
    const c = crosses.get(route.id),
      edge = findEdge(doc, route.id),
      label = labels.get(route) ?? null,
      // A label clear of its own line is tied back to it, never left floating.
      leader =
        label && !message(route)
          ? labelLeader(route.points, {
              x: label.x - label.w / 2,
              y: label.y - label.h / 2,
              w: label.w,
              h: label.h,
            })
          : undefined,
      ends = edge ? stoppedPoints(route.points, edge) : route.points;
    return {
      ...route,
      label,
      ...(leader ? { leader } : {}),
      ...(gave.gave.has(route.id) ? { gaveWay: true } : {}),
      path: hops?.[i].length ? hoppedPath(ends, radius, hops[i]) : roundedPath(ends, radius),
      halo: haloPath(
        route.points,
        result.routes
          .filter((_, j) => j !== i && !(whole.has(i) && whole.has(j)))
          .map(r => r.points),
        frames,
      ),
      ...(c?.to ? { cross: c.to.cross } : c?.from ? { cross: c.from.cross } : {}),
    };
  });
  // Later lines draw over earlier ones, so a whole line goes last and the other line gives way.
  return [...drawn.filter((_, i) => !whole.has(i)), ...drawn.filter((_, i) => whole.has(i))];
}

/** Width of the halo under a connection, in drawing units. */
export const HALO_WIDTH = 8;
/** How far a halo piece runs each way from a crossing, along the line. */
export const HALO_REACH = 7;

type Seg = [Point, Point];
const segsOf = (points: Point[]): Seg[] => points.slice(1).map((p, i) => [points[i], p]);

/** Where upright and level segments `a` and `b` cross, strictly inside both. */
function crossing(a: Seg, b: Seg): Point | null {
  const level = (s: Seg) => Math.abs(s[0].y - s[1].y) < 0.5,
    upright = (s: Seg) => Math.abs(s[0].x - s[1].x) < 0.5;
  const [h, v] = level(a) && upright(b) ? [a, b] : upright(a) && level(b) ? [b, a] : [null, null];
  if (!h || !v) return null;
  const x = v[0].x,
    y = h[0].y,
    between = (t: number, p: number, q: number) =>
      t > Math.min(p, q) + 0.5 && t < Math.max(p, q) - 0.5;
  return between(x, h[0].x, h[1].x) && between(y, v[0].y, v[1].y) ? { x, y } : null;
}

/**
 * The lines, by index, that another line's halo would cut at a mark. A halo there leaves half a
 * mark, or on a short line almost nothing, so these lines stay whole.
 */
export function wholeLines(lines: { points: Point[]; marks: Rect[] }[]): Set<number> {
  const out = new Set<number>();
  lines.forEach(({ points, marks }, i) => {
    const hit = lines.some(
      (other, j) =>
        j !== i &&
        segsOf(points).some(s =>
          segsOf(other.points).some(c => {
            const p = crossing(s, c);
            return p && marks.some(m => inside(p, m, HALO_WIDTH / 2));
          }),
        ),
    );
    if (hit) out.add(i);
  });
  return out;
}

/** The pieces of `points` around each place it crosses `others` or a frame's border, as a path. */
export function haloPath(points: Point[], others: Point[][], frames: Rect[]): string {
  const cuts = [
    ...others.flatMap(segsOf),
    ...frames.flatMap(r =>
      segsOf([
        { x: r.x, y: r.y },
        { x: r.x + r.w, y: r.y },
        { x: r.x + r.w, y: r.y + r.h },
        { x: r.x, y: r.y + r.h },
        { x: r.x, y: r.y },
      ]),
    ),
  ];
  const out: string[] = [];
  for (const s of segsOf(points)) {
    const len = Math.hypot(s[1].x - s[0].x, s[1].y - s[0].y);
    if (!len) continue;
    const dx = (s[1].x - s[0].x) / len,
      dy = (s[1].y - s[0].y) / len;
    for (const c of cuts) {
      const p = crossing(s, c);
      if (!p) continue;
      const at = Math.hypot(p.x - s[0].x, p.y - s[0].y),
        from = Math.max(0, at - HALO_REACH),
        to = Math.min(len, at + HALO_REACH);
      const r = (n: number) => Math.round(n * 10) / 10;
      out.push(
        `M${r(s[0].x + dx * from)} ${r(s[0].y + dy * from)}L${r(s[0].x + dx * to)} ${r(s[0].y + dy * to)}`,
      );
    }
  }
  return out.join('');
}

/**
 * A sequence message: a straight line at its row from the source's lifeline (the middle of the
 * box) to the target's, or, sent to itself, a short loop out to the right and back.
 */
function messageRoute(e: VisibleEdge, row: number, a: Rect, b: Rect): Route {
  const from = a.x + a.w / 2,
    to = b.x + b.w / 2,
    right = to >= from;
  const points =
    e.a === e.b
      ? [
          { x: from, y: row },
          { x: from + SELF_LOOP.out, y: row },
          { x: from + SELF_LOOP.out, y: row + SELF_LOOP.down },
          { x: from, y: row + SELF_LOOP.down },
        ]
      : [
          { x: from, y: row },
          { x: to, y: row },
        ];
  return {
    id: e.id,
    from: e.a,
    to: e.b,
    fromSide: right ? 'right' : 'left',
    toSide: right ? 'left' : 'right',
    fromOffset: 0,
    toOffset: 0,
    points,
    blocked: false,
  };
}

/**
 * Recent routings by their exact input. Routing a large drawing takes seconds, and the same
 * geometry is often routed again: the Grid view's panels, an export, undo back to a shape, or
 * routes the engine worker already drew.
 */
const recent = new Map<string, RoutingResult>();

function routingKey(
  doc: Diagram,
  vg: VisibleGraph,
  rects: Map<string, Rect>,
  options: { previous?: PriorRoute[]; quick?: boolean },
) {
  const input = routeInput(doc, vg, rects),
    settings = {
      ...doc.settings.routing,
      previous: options.previous ?? [],
      quick: !!options.quick,
    };
  return { input, settings, key: JSON.stringify([input, settings]) };
}

function keep(key: string, result: RoutingResult) {
  recent.delete(key);
  recent.set(key, structuredClone(result));
  while (recent.size > 8) recent.delete(recent.keys().next().value!);
}

/** Full routes already computed for this drawing, or null. */
export function knownRoutes(doc: Diagram, vg: VisibleGraph, rects: Map<string, Rect>) {
  const hit = recent.get(routingKey(doc, vg, rects, {}).key);
  return hit ? structuredClone(hit) : null;
}

/** Record full routes computed elsewhere (the engine worker) for this drawing. */
export function rememberRoutes(
  doc: Diagram,
  vg: VisibleGraph,
  rects: Map<string, Rect>,
  result: RoutingResult,
) {
  keep(routingKey(doc, vg, rects, {}).key, result);
}

export function computeRoutes(
  doc: Diagram,
  vg: VisibleGraph,
  rects: Map<string, Rect>,
  options: { previous?: PriorRoute[]; quick?: boolean } = {},
): SceneRoutes {
  const { input, settings, key } = routingKey(doc, vg, rects, options),
    hit = recent.get(key),
    result = hit ? structuredClone(hit) : RouteLab.compute(input, settings);
  keep(key, result);
  return { result, routes: drawRoutes(doc, vg, rects, result) };
}
