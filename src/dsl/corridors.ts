/**
 * Routes for a `flow` scope's forward lines, planned from its ranks as a layered layout routes its
 * edges: out of the source's trailing side, along a track in each gap the line turns in, down a
 * corridor through each rank it skips, and into the target's leading side. The ranks' order already
 * keeps crossings few, so the plan only has to place ports and order each gap's tracks. The router
 * takes a planned route as it is when it clears every box.
 */
import type { Point, Rect } from '../model/types';

export interface PlanLine {
  id: string;
  /** Source, the stand-ins of the ranks it skips, target. */
  chain: string[];
}

export interface Planned {
  points: Point[];
  fromOffset: number;
  toOffset: number;
}

/**
 * Space between ports on one side and between neighbouring tracks in a gap, as the router keeps
 * them: ports `max(portGap, edgeGap)` apart and tracks `edgeGap` apart.
 */
export interface Spacing {
  port: number;
  track: number;
}
const DEFAULT_SPACING: Spacing = { port: 16, track: 16 };
/** How far a port stays from a side's corner. */
const CORNER = 12;
/** How far the first and last tracks stay from the boxes either side of a gap. */
const STANDOFF = 20;
/** A run shorter than this goes straight across the gap. */
const STRAIGHT = 0.5;

/**
 * Plans each line of `lines`. `order` is the ranks with stand-ins, `box` each real member's drawn
 * box and `across` each stand-in's place across the run, all in drawing coordinates. Lines that
 * cannot be planned (a member without a box) are left out.
 */
export function planRoutes(
  axis: 'down' | 'right',
  order: string[][],
  lines: PlanLine[],
  box: (id: string) => Rect | undefined,
  across: (id: string) => number | undefined,
  spacing: Spacing = DEFAULT_SPACING,
): Map<string, Planned> {
  const flip = axis === 'right',
    out = new Map<string, Planned>(),
    { rectOf, usable, outPort, inPort, gaps, runs } = tracks(
      axis,
      order,
      lines,
      box,
      across,
      spacing,
    );
  // Each rank's band down the page, from its real members.
  const top: number[] = [],
    bottom: number[] = [];
  for (const [i, layer] of order.entries())
    for (const id of layer) {
      const r = rectOf(id);
      if (!r) continue;
      top[i] = Math.min(top[i] ?? Infinity, r.y);
      bottom[i] = Math.max(bottom[i] ?? -Infinity, r.y + r.h);
    }
  // Tracks sit a pitch apart, centred in their gap, closer only when the gap is too short.
  for (const [g, { placed, level }] of gaps) {
    const levels = Math.max(0, ...level) + 1,
      height = (top[g + 1] ?? 0) - (bottom[g] ?? 0),
      pitch =
        levels > 1 ? Math.min(spacing.track, Math.max(0, height - 2 * STANDOFF) / (levels - 1)) : 0,
      first = (bottom[g] ?? 0) + (height - (levels - 1) * pitch) / 2;
    placed.forEach((r, i) => (r.y = round(first + level[i] * pitch)));
  }
  for (const l of usable) {
    const a = rectOf(l.chain[0])!,
      b = rectOf(l.chain.at(-1)!)!,
      from = outPort.get(l.id)!,
      to = inPort.get(l.id)!;
    const ps: Point[] = [{ x: from, y: a.y + a.h }];
    for (const r of runs.get(l.id)!) ps.push({ x: r.up, y: r.y! }, { x: r.low, y: r.y! });
    ps.push({ x: to, y: b.y });
    out.set(l.id, {
      points: compressed(ps).map(p => (flip ? { x: p.y, y: p.x } : p)),
      fromOffset: round(from - (a.x + a.w / 2)),
      toOffset: round(to - (b.x + b.w / 2)),
    });
  }
  return out;
}

/**
 * The room each gap between ranks needs for the tracks `planRoutes` lays in it: a standoff from
 * the boxes either side and a pitch between tracks, by gap index; a gap with no track is absent.
 * `box` may be a member's slot: only its place across the run counts.
 */
export function trackRoom(
  axis: 'down' | 'right',
  order: string[][],
  lines: PlanLine[],
  box: (id: string) => Rect | undefined,
  across: (id: string) => number | undefined,
  spacing: Spacing = DEFAULT_SPACING,
): number[] {
  const room: number[] = [];
  for (const [g, { level }] of tracks(axis, order, lines, box, across, spacing).gaps)
    room[g] = 2 * STANDOFF + Math.max(0, ...level) * spacing.track;
  return room;
}

/** A line's run along a gap, from where it comes down to where it goes on down. */
interface Run {
  line: string;
  up: number;
  low: number;
  lo: number;
  hi: number;
  y?: number;
}

/** Ports, each line's runs, and each gap's runs top first with their track levels, going down. */
function tracks(
  axis: 'down' | 'right',
  order: string[][],
  lines: PlanLine[],
  box: (id: string) => Rect | undefined,
  across: (id: string) => number | undefined,
  spacing: Spacing,
) {
  // Work going down; a rightward scope swaps x and y on the way in and out.
  const flip = axis === 'right',
    rectOf = (id: string) => {
      const r = box(id);
      return r && (flip ? { x: r.y, y: r.x, w: r.h, h: r.w } : r);
    };
  const rank = new Map(order.flatMap((layer, i) => layer.map(id => [id, i] as const)));
  const usable = lines.filter(
    l =>
      l.chain.length >= 2 &&
      rectOf(l.chain[0]) &&
      rectOf(l.chain.at(-1)!) &&
      l.chain.slice(1, -1).every(id => across(id) !== undefined) &&
      l.chain.every((id, k) => k === 0 || rank.get(id) === rank.get(l.chain[k - 1])! + 1),
  );
  const centre = (id: string) => {
    const r = rectOf(id);
    return r ? r.x + r.w / 2 : across(id)!;
  };
  // Ports: a box's lines leave its bottom in the order of where they go, each as near that place
  // as a pitch apart allows, and arrive on its top in the order of where they come from.
  const ports = (
    id: string,
    wants: Array<{ line: string; want: number }>,
    into: Map<string, number>,
  ) => {
    const r = rectOf(id)!,
      lo = r.x + CORNER,
      hi = r.x + r.w - CORNER,
      n = wants.length;
    wants.sort((a, b) => a.want - b.want || (a.line < b.line ? -1 : 1));
    const pitch = n > 1 ? Math.min(spacing.port, Math.max(0, hi - lo) / (n - 1)) : 0;
    // The nearest non-decreasing fit to the wishes, less a pitch per place: pooled runs sit at
    // their mean.
    const blocks: Array<{ sum: number; n: number }> = [];
    for (const [k, w] of wants.entries()) {
      blocks.push({ sum: Math.min(hi, Math.max(lo, w.want)) - k * pitch, n: 1 });
      while (
        blocks.length > 1 &&
        blocks.at(-2)!.sum / blocks.at(-2)!.n > blocks.at(-1)!.sum / blocks.at(-1)!.n
      ) {
        const b = blocks.pop()!;
        blocks.at(-1)!.sum += b.sum;
        blocks.at(-1)!.n += b.n;
      }
    }
    const xs: number[] = [];
    // Bound each pooled start before restoring its pitch; a whole-fan shift cannot fit split fans.
    for (const b of blocks)
      for (let k = 0; k < b.n; k++)
        xs.push(Math.max(lo, Math.min(hi - (n - 1) * pitch, b.sum / b.n)) + xs.length * pitch);
    wants.forEach((w, k) => into.set(w.line, round(xs[k])));
  };
  const leaving = new Map<string, Array<{ line: string; want: number }>>(),
    arriving = new Map<string, Array<{ line: string; want: number }>>();
  for (const l of usable) {
    const [a, next] = l.chain;
    (leaving.get(a) ?? leaving.set(a, []).get(a)!).push({ line: l.id, want: centre(next) });
  }
  const outPort = new Map<string, number>(),
    inPort = new Map<string, number>();
  for (const [id, wants] of leaving) ports(id, wants, outPort);
  for (const l of usable) {
    const b = l.chain.at(-1)!,
      before = l.chain.at(-2)!,
      from = l.chain.length === 2 ? outPort.get(l.id)! : across(before)!;
    (arriving.get(b) ?? arriving.set(b, []).get(b)!).push({ line: l.id, want: from });
  }
  for (const [id, wants] of arriving) ports(id, wants, inPort);
  // Each line's place across the run at each element of its chain.
  const xAt = (l: PlanLine, k: number) =>
    k === 0
      ? outPort.get(l.id)!
      : k === l.chain.length - 1
        ? inPort.get(l.id)!
        : across(l.chain[k])!;
  const byGap = new Map<number, Run[]>(),
    runs = new Map<string, Run[]>();
  for (const l of usable) {
    const list: Run[] = [];
    for (let k = 0; k + 1 < l.chain.length; k++) {
      const up = xAt(l, k),
        low = xAt(l, k + 1);
      if (Math.abs(up - low) < STRAIGHT) continue;
      const run: Run = { line: l.id, up, low, lo: Math.min(up, low), hi: Math.max(up, low) };
      const g = rank.get(l.chain[k])!;
      (byGap.get(g) ?? byGap.set(g, []).get(g)!).push(run);
      list.push(run);
    }
    runs.set(l.id, list);
  }
  // Order each gap's runs, top first, so that fewest cross: a run above another crosses it where
  // its way down lies inside the other's span, and the other's way in from above lies inside its.
  const inside = (x: number, r: Run) => x > r.lo + STRAIGHT && x < r.hi - STRAIGHT;
  const cost = (a: Run, b: Run) => (inside(a.low, b) ? 1 : 0) + (inside(b.up, a) ? 1 : 0);
  const meet = (a: Run, b: Run) => a.lo < b.hi + spacing.track && b.lo < a.hi + spacing.track;
  const gaps = new Map<number, { placed: Run[]; level: number[] }>();
  for (const [g, list] of byGap) {
    const placed: Run[] = [];
    for (const r of [...list].sort((a, b) => a.lo - b.lo || a.hi - b.hi)) {
      let best = 0,
        fewest = Infinity;
      for (let k = 0; k <= placed.length; k++) {
        let n = 0;
        for (let j = 0; j < placed.length; j++)
          if (meet(r, placed[j])) n += j < k ? cost(placed[j], r) : cost(r, placed[j]);
        if (n < fewest) [best, fewest] = [k, n];
      }
      placed.splice(best, 0, r);
    }
    // Tracks: each run one below the lowest earlier run it meets.
    const level = placed.map(() => 0);
    for (let i = 0; i < placed.length; i++)
      for (let j = 0; j < i; j++)
        if (meet(placed[i], placed[j])) level[i] = Math.max(level[i], level[j] + 1);
    gaps.set(g, { placed, level });
  }
  return { rectOf, usable, outPort, inPort, gaps, runs };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Drop repeated points and the middle of three in a line. */
function compressed(ps: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of ps) {
    const q = { x: round(p.x), y: round(p.y) };
    const last = out.at(-1);
    if (last && Math.abs(last.x - q.x) < 0.01 && Math.abs(last.y - q.y) < 0.01) continue;
    const before = out.at(-2);
    if (
      last &&
      before &&
      ((Math.abs(before.x - last.x) < 0.01 && Math.abs(last.x - q.x) < 0.01) ||
        (Math.abs(before.y - last.y) < 0.01 && Math.abs(last.y - q.y) < 0.01))
    )
      out.pop();
    out.push(q);
  }
  return out;
}
