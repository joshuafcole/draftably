import type { Centres, Item, Link, Settings, Topology } from './types.ts';
import { forest, topology } from './topology.ts';
import { bounds } from './util.ts';

type Sign = 1 | -1;

/** A span-based tree: each subtree gets its own width and parents sit over their children. */
export function treeTarget(items: Item[], t: Topology, s: Settings): Centres {
  const f = forest(t, s),
    byId = new Map(items.map(n => [n.id, n])),
    vertical = s.direction === 'DOWN',
    span = new Map<string, number>();
  const minor = (id: string) => (vertical ? byId.get(id)!.w : byId.get(id)!.h);
  function width(id: string): number {
    const cs = f.kids.get(id)!,
      w = Math.max(
        minor(id),
        cs.reduce((a, c) => a + width(c), 0) + Math.max(0, cs.length - 1) * s.nodeGap,
      );
    span.set(id, w);
    return w;
  }
  f.roots.forEach(width);
  const maxes: number[] = [];
  for (const p of items) {
    const d = f.depth.get(p.id)!;
    maxes[d] = Math.max(maxes[d] || 0, vertical ? p.h : p.w);
  }
  const levels: number[] = [];
  maxes.forEach(
    (w, i) => (levels[i] = (i ? levels[i - 1] + maxes[i - 1] / 2 + s.rankGap : 0) + w / 2),
  );
  const map: Centres = new Map();
  function place(id: string, lo: number) {
    const cross = lo + span.get(id)! / 2,
      along = levels[f.depth.get(id)!];
    map.set(id, vertical ? { x: cross, y: along } : { x: along, y: cross });
    const cs = f.kids.get(id)!,
      total = cs.reduce((a, c) => a + span.get(c)!, 0) + Math.max(0, cs.length - 1) * s.nodeGap;
    let x = lo + (span.get(id)! - total) / 2;
    for (const c of cs) {
      place(c, x);
      x += span.get(c)! + s.nodeGap;
    }
  }
  let x = 0;
  for (const id of f.roots) {
    place(id, x);
    x += span.get(id)! + s.rankGap;
  }
  return map;
}
/** Rings round each root by depth. No solve reaches it: see `Settings`. */
export function radialTarget(items: Item[], t: Topology, s: Settings): Centres {
  const f = forest(t, { ...s, algorithm: 'radial' }),
    mass = new Map<string, number>();
  function weight(id: string): number {
    const n = Math.max(
      1,
      f.kids.get(id)!.reduce((a, c) => a + weight(c), 0),
    );
    mass.set(id, n);
    return n;
  }
  f.roots.forEach(weight);
  const maxDepth = Math.max(...f.depth.values(), 0),
    radii = [0],
    rings = Array.from({ length: maxDepth + 1 }, (): Item[] => []);
  for (const p of items) rings[f.depth.get(p.id)!].push(p);
  for (let d = 1; d < rings.length; d++) {
    const prev = Math.max(...rings[d - 1].map(p => Math.hypot(p.w, p.h)), 0),
      curr = Math.max(...rings[d].map(p => Math.hypot(p.w, p.h)), 0);
    radii[d] = Math.max(
      radii[d - 1] + (prev + curr) / 2 + s.edgeLength / 2,
      rings[d].reduce((sum, p) => sum + Math.hypot(p.w, p.h) + s.nodeGap, 0) / (2 * Math.PI),
    );
  }
  const map: Centres = new Map();
  let componentX = 0;
  for (const root of f.roots) {
    const ox = componentX;
    const place = (id: string, start: number, end: number) => {
      const angle = (start + end) / 2 + (s.direction === 'RIGHT' ? 0 : Math.PI / 2),
        radius = radii[f.depth.get(id)!];
      map.set(id, { x: ox + Math.cos(angle) * radius, y: Math.sin(angle) * radius });
      const cs = f.kids.get(id)!;
      let a = start;
      for (const c of cs) {
        const b = a + ((end - start) * mass.get(c)!) / mass.get(id)!;
        place(c, a, b);
        a = b;
      }
    };
    place(root, -Math.PI, Math.PI);
    componentX += 2 * (radii.at(-1) || 100) + s.rankGap;
  }
  return map;
}
// A dimension-aware two-sided tree. This is NOT the removed radial-shell
// algorithm: there is no circumference or global radius inflation.
export function bilateralTarget(items: Item[], t: Topology, s: Settings): Centres | null {
  const start = t.intent.start?.id;
  if (start === undefined || !t.index.has(start)) return null;
  const f = forest(t, { ...s, rootId: start }),
    by = new Map(items.map(p => [p.id, p])),
    vertical = s.direction === 'DOWN';
  const minor = (id: string) => (vertical ? by.get(id)!.w : by.get(id)!.h),
    major = (id: string) => (vertical ? by.get(id)!.h : by.get(id)!.w);
  const spans = new Map<string, number>();
  function span(id: string): number {
    const cs = f.kids.get(id)!;
    const w = Math.max(
      minor(id),
      cs.reduce((n, c) => n + span(c), 0) + Math.max(0, cs.length - 1) * s.nodeGap,
    );
    spans.set(id, w);
    return w;
  }
  f.roots.forEach(span);
  const sides = new Map([[start, 0]]),
    branches: Record<Sign, string[]> = { 1: [], '-1': [] },
    mass: Record<Sign, number> = { 1: 0, '-1': 0 };
  function assign(id: string, sign: Sign) {
    sides.set(id, sign);
    for (const c of f.kids.get(id)!) assign(c, sign);
  }
  for (const id of f.kids.get(start)!) {
    const sign = mass[1] <= mass[-1] ? 1 : -1;
    branches[sign].push(id);
    mass[sign] += spans.get(id)! + s.nodeGap;
    assign(id, sign);
  }
  const map: Centres = new Map([[start, { x: 0, y: 0 }]]),
    maxes: number[] = [];
  for (const id of sides.keys()) {
    const d = f.depth.get(id)!;
    maxes[d] = Math.max(maxes[d] || 0, major(id));
  }
  const levels = [0];
  for (let d = 1; d < maxes.length; d++)
    levels[d] = levels[d - 1] + maxes[d - 1] / 2 + s.rankGap + maxes[d] / 2;
  function place(id: string, lo: number, sign: Sign) {
    const a = sign * levels[f.depth.get(id)!],
      b = lo + spans.get(id)! / 2;
    map.set(id, vertical ? { x: b, y: a } : { x: a, y: b });
    const cs = f.kids.get(id)!,
      total = cs.reduce((n, c) => n + spans.get(c)!, 0) + Math.max(0, cs.length - 1) * s.nodeGap;
    let next = lo + (spans.get(id)! - total) / 2;
    for (const c of cs) {
      place(c, next, sign);
      next += spans.get(c)! + s.nodeGap;
    }
  }
  for (const sign of [1, -1] as const) {
    let lo = -(mass[sign] - s.nodeGap) / 2;
    for (const id of branches[sign]) {
      place(id, lo, sign);
      lo += spans.get(id)! + s.nodeGap;
    }
  }
  const extra = items.filter(p => !map.has(p.id));
  if (extra.length) {
    const fallback = treeTarget(extra, topology(extra, t.edges), { ...s, rootId: '' }),
      b = bounds(
        items
          .filter(p => map.has(p.id))
          .map(p => ({ ...p, x: map.get(p.id)!.x - p.w / 2, y: map.get(p.id)!.y - p.h / 2 })),
      );
    for (const p of extra) {
      const q = fallback.get(p.id)!;
      map.set(p.id, { x: q.x, y: q.y + b.y + b.h + s.rankGap });
    }
  }
  t.branchSides = sides;
  return map;
}
/** Which way a forward link should run: 1, -1 on the far side of a centred start, 0 across it. */
export function forwardSign(t: Topology, e: Link) {
  if (!t.branchSides) return 1;
  const a = t.branchSides.get(e.from) || 0,
    b = t.branchSides.get(e.to) || 0;
  return a && b && a !== b ? 0 : b || a || 1;
}
