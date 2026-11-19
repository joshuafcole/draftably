import type { Centres, Item, Point, Settings, Topology } from './types.ts';
import { bounds, cmp } from './util.ts';

/** Crossings the sweeps must remove before they may override the authored order in a rank. */
const ORDER_PRIOR_MARGIN = (before: number) => Math.max(1, Math.ceil(before * 0.25));
/** Straight centre-to-centre crossings between a candidate placement's edges. */
export function sketchCrossings(t: Topology, map: Centres) {
  const segs: Array<[string, string, Point, Point]> = [];
  for (const e of t.edges) {
    const a = map.get(e.from),
      b = map.get(e.to);
    if (a && b) segs.push([e.from, e.to, a, b]);
  }
  const side = (p: Point, q: Point, r: Point) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  let cross = 0;
  for (let i = 0; i < segs.length; i++) {
    const [f1, t1, p1, q1] = segs[i];
    for (let j = i + 1; j < segs.length; j++) {
      const [f2, t2, p2, q2] = segs[j];
      if (f1 === f2 || f1 === t2 || t1 === f2 || t1 === t2) continue;
      if (side(p1, q1, p2) * side(p1, q1, q2) < 0 && side(p2, q2, p1) * side(p2, q2, q1) < 0)
        cross++;
    }
  }
  return cross;
}
/** Ranks as columns (or rows), ordered by barycentre sweeps, folded into bands when that fits the aspect better. */
export function layeredTarget(items: Item[], t: Topology, s: Settings, aspect: number): Centres {
  const byId = new Map(items.map(i => [i.id, i])),
    vertical = s.direction === 'DOWN';
  const major = (p: Item) => (vertical ? p.h : p.w),
    minor = (p: Item) => (vertical ? p.w : p.h);
  const layers: string[][] = [];
  for (const id of t.ids) (layers[t.rank.get(id)!] ||= []).push(id);
  for (const l of layers)
    l.sort((a, b) =>
      s.mode === 'pass' && s.ordering === 'stable'
        ? (vertical ? byId.get(a)!.x : byId.get(a)!.y) -
            (vertical ? byId.get(b)!.x : byId.get(b)!.y) || cmp(a, b)
        : cmp(a, b),
    );
  const ord = new Map<string, number>(),
    refresh = () => layers.forEach(l => l.forEach((id, i) => ord.set(id, i)));
  refresh();
  const widths = layers.map(l => Math.max(...l.map(id => major(byId.get(id)!)))),
    heights = layers.map(
      l => l.reduce((n, id) => n + minor(byId.get(id)!), 0) + (l.length - 1) * s.nodeGap,
    );
  if (s.mode === 'rebuild' || s.ordering === 'crossings') {
    // Order prior: a rebuild keeps the authored order within each rank unless the barycentre
    // sweeps cut crossings by a clear margin, so growing a diagram doesn't reshuffle the ranks
    // it didn't touch. The sweeps still start from ID order, so where they win the drawing is
    // the one they always gave.
    const declared = s.mode === 'rebuild' ? t.declared : null;
    const prior = declared
      ? layers.map(l =>
          l
            .slice()
            .sort(
              (a, b) => (declared.get(a) ?? Infinity) - (declared.get(b) ?? Infinity) || cmp(a, b),
            ),
        )
      : null;
    for (let sweep = 0; sweep < 10; sweep++) {
      const forward = sweep % 2 === 0,
        seq = forward ? [...layers.keys()] : [...layers.keys()].reverse();
      for (const i of seq) {
        const near = forward ? t.inc : t.out;
        const bary = (id: string) => {
          const ns = near.get(id)!.filter(n => (forward ? t.rank.get(n)! < i : t.rank.get(n)! > i));
          return ns.length ? ns.reduce((a, n) => a + ord.get(n)!, 0) / ns.length : ord.get(id);
        };
        layers[i].sort((a, b) => bary(a)! - bary(b)! || ord.get(a)! - ord.get(b)! || cmp(a, b));
        refresh();
      }
    }
    if (prior) {
      const swept = sketchCrossings(t, build(layers.length).map),
        sweptLayers = layers.map(l => l.slice());
      prior.forEach((l, i) => (layers[i] = l));
      const kept = sketchCrossings(t, build(layers.length).map);
      if (kept - swept >= ORDER_PRIOR_MARGIN(kept)) sweptLayers.forEach((l, i) => (layers[i] = l));
      refresh();
    }
  }
  function build(count: number) {
    const map: Centres = new Map();
    let cross = 0;
    for (let start = 0; start < layers.length; start += count) {
      const stop = Math.min(layers.length, start + count),
        band = Math.max(...heights.slice(start, stop));
      let along = 0;
      for (let j = start; j < stop; j++) {
        let y = cross + (band - heights[j]) / 2;
        for (const id of layers[j]) {
          const p = byId.get(id)!,
            a = along + widths[j] / 2,
            b = y + minor(p) / 2;
          map.set(id, vertical ? { x: b, y: a } : { x: a, y: b });
          y += minor(p) + s.nodeGap;
        }
        along += widths[j] + s.rankGap;
      }
      cross += band + Math.max(s.rankGap + 40, 84);
    }
    const b = bounds(
      items.map(p => {
        const a = map.get(p.id)!;
        return { ...p, x: a.x - p.w / 2, y: a.y - p.h / 2 };
      }),
    );
    // Penalise aspect mismatch in log space, not by merely scaling to fit a thin row.
    const score =
      Math.abs(Math.log(b.w / b.h / aspect)) * 1.8 +
      Math.log(b.w * b.h) * 0.17 +
      (Math.ceil(layers.length / count) - 1) * 0.16;
    return { map, score };
  }
  let best = build(layers.length);
  if (s.fold === 'auto')
    for (let count = 2; count < layers.length; count++) {
      const c = build(count);
      if (c.score < best.score) best = c;
    }
  return best.map;
}
