import type { Centres, Item, Settings, Topology } from './types.ts';
import { hintTargets } from './intent.ts';
import { forwardSign } from './trees.ts';
import { magnitude, midpoint, penetration } from './util.ts';

/**
 * The energy a solve lowers: hint and target errors, link lengths by algorithm, overlap area and
 * forward links that run backwards. `compoundEnergy` adds the cross-boundary links of a compound solve.
 */
export function objective(
  items: Item[],
  t: Topology,
  s: Settings,
  distances: Map<string, Map<string, number>> | null,
  target: Centres | null,
  compoundEnergy: (() => number) | null,
) {
  const byId = new Map(items.map(p => [p.id, p])),
    L = s.edgeLength;
  let energy = 0;
  if (s.algorithm !== 'separate')
    for (const [id, q] of hintTargets(items, t.intent || {})) {
      const p = midpoint(byId.get(id)!);
      energy += ((q.x - p.x) ** 2 + (q.y - p.y) ** 2) * 1.5;
    }
  if (compoundEnergy) energy += compoundEnergy();
  if (target)
    for (const p of items) {
      const c = midpoint(p),
        q = target.get(p.id)!;
      energy += ((c.x - q.x) ** 2 + (c.y - q.y) ** 2) * 0.01;
    }
  else if (compoundEnergy) {
    // Its links are in `compoundEnergy`.
  } else if (s.algorithm === 'stress')
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j],
          h = distances!.get(a.id)!.get(b.id);
        if (!h) continue;
        const ca = midpoint(a),
          cb = midpoint(b),
          ideal = h * (L + (a.w + b.w + a.h + b.h) / 8),
          d = magnitude(ca.x - cb.x, ca.y - cb.y);
        energy += ((d - ideal) / ideal) ** 2 * 100;
      }
  else if (s.algorithm === 'force') {
    // Potential consistent with the explicit attractive / repulsive forces.
    for (const e of t.edges) {
      const a = byId.get(e.from)!,
        b = byId.get(e.to)!,
        ca = midpoint(a),
        cb = midpoint(b),
        d = magnitude(cb.x - ca.x, cb.y - ca.y),
        ideal = L + (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 4;
      energy += (0.022 * d * d * d) / (3 * ideal);
    }
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = midpoint(items[i]),
          b = midpoint(items[j]);
        energy -=
          (((L + 80) ** 2 * s.repulsion) / 100) *
          0.015 *
          Math.log(Math.max(18, magnitude(a.x - b.x, a.y - b.y)));
      }
  } else
    for (const e of t.edges) {
      const a = byId.get(e.from)!,
        b = byId.get(e.to)!,
        ca = midpoint(a),
        cb = midpoint(b),
        ideal = L + (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 4,
        d = magnitude(cb.x - ca.x, cb.y - ca.y);
      energy += (d - ideal) ** 2 * 0.006;
    }
  if (s.algorithm === 'separate') energy = 0;
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const p = penetration(items[i], items[j], s.nodeGap);
      if (p) energy += p.area * 2;
    }
  if (s.respectDirection && s.algorithm !== 'separate')
    for (const e of t.forward) {
      const a = byId.get(e.from)!,
        b = byId.get(e.to)!,
        v = s.direction === 'DOWN',
        gap = (v ? a.h : a.w) / 2 + (v ? b.h : b.w) / 2 + s.rankGap,
        d = v ? midpoint(b).y - midpoint(a).y : midpoint(b).x - midpoint(a).x;
      energy += forwardSign(t, e)
        ? Math.max(0, gap - d * forwardSign(t, e)) ** 2 * 0.45 * (s.flowStrength / 100)
        : 0;
    }
  return energy;
}
