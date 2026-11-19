import type { Batch } from './arrange.ts';
import { hintTargets } from './intent.ts';
import type { Scene } from './scene.ts';
import { forwardSign } from './trees.ts';
import { bounds, clamp, hash, magnitude, midpoint } from './util.ts';

/** The force on each item for one tick, by ID; `degree` is the weight of the links behind it. */
export function tickForces(scene: Scene, batch: Batch) {
  const { s, pos, parent, compound } = scene,
    {
      items,
      byId,
      t,
      direction,
      distances,
      boundaryLinks,
      target,
      availableAspect,
      origin,
      anchor,
      baseCenter,
      localIntent,
    } = batch;
  const forces = new Map(items.map(p => [p.id, { x: 0, y: 0, degree: 0 }]));
  const add = (id: string, x: number, y: number, w = 1) => {
    const f = forces.get(id)!;
    f.x += x;
    f.y += y;
    f.degree += w;
  };
  if (s.algorithm === 'stress') {
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = items[i],
          b = items[j],
          hop = distances!.get(a.id)!.get(b.id);
        if (!hop) continue;
        const ca = midpoint(a),
          cb = midpoint(b);
        let dx = cb.x - ca.x,
          dy = cb.y - ca.y,
          d = magnitude(dx, dy);
        if (d < 0.01) {
          const angle = hash(a.id + '|' + b.id) * Math.PI * 2;
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          d = 1;
        }
        const ideal = hop * (s.edgeLength + (a.w + b.w + a.h + b.h) / 8),
          w = 1 / (hop * hop),
          f = ((d - ideal) / d) * w * 0.16;
        add(a.id, dx * f, dy * f, w);
        add(b.id, -dx * f, -dy * f, w);
      }
  } else if (['tidy', 'flow', 'force'].includes(s.algorithm)) {
    for (const e of t.edges) {
      const a = byId.get(e.from)!,
        b = byId.get(e.to)!,
        ca = midpoint(a),
        cb = midpoint(b);
      let dx = cb.x - ca.x,
        dy = cb.y - ca.y,
        d = magnitude(dx, dy);
      if (d < 0.01) {
        dx = 1;
        dy = 0.1;
        d = 1.005;
      }
      const extent = (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 4,
        L = extent + s.edgeLength;
      const f = s.algorithm === 'force' ? ((d * d) / L) * 0.022 : (d - L) * 0.09;
      add(a.id, (dx / d) * f, (dy / d) * f);
      add(b.id, (-dx / d) * f, (-dy / d) * f);
      if (s.algorithm === 'tidy') {
        const vertical = Math.abs(dx) < Math.abs(dy),
          err = vertical ? dx : dy,
          limit = Math.max(s.nodeGap * 2, 24);
        if (Math.abs(err) < limit) {
          const q = ((err * s.alignment) / 100) * 0.14;
          add(a.id, vertical ? q : 0, vertical ? 0 : q, 0);
          add(b.id, vertical ? -q : 0, vertical ? 0 : -q, 0);
        }
      }
      if (s.algorithm === 'flow' && e.directed !== false && !t.feedback.has(e.from + '\0' + e.to)) {
        const sign = forwardSign(t, e),
          down = direction === 'DOWN',
          gap = (down ? a.h + b.h : a.w + b.w) / 2 + s.rankGap,
          error = gap - (down ? dy : dx) * sign,
          push = ((sign * Math.max(0, error) * s.flowStrength) / 100) * 0.32,
          cross = (((down ? dx : dy) * s.alignment) / 100) * 0.035;
        add(a.id, down ? cross : -push, down ? -push : cross, 0);
        add(b.id, down ? -cross : push, down ? push : -cross, 0);
      }
    }
    if (s.algorithm === 'force')
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i],
            b = items[j],
            ca = midpoint(a),
            cb = midpoint(b);
          let dx = cb.x - ca.x,
            dy = cb.y - ca.y,
            d = magnitude(dx, dy);
          if (d < 0.1) {
            const ang = hash(a.id + b.id) * Math.PI * 2;
            dx = Math.cos(ang);
            dy = Math.sin(ang);
            d = 1;
          }
          const L = s.edgeLength + 80,
            f = ((((L * L) / Math.max(d, 18)) * s.repulsion) / 100) * 0.015;
          add(a.id, (-dx / d) * f, (-dy / d) * f, 0);
          add(b.id, (dx / d) * f, (dy / d) * f, 0);
        }
  }
  if (compound)
    for (const e of boundaryLinks) {
      const a = pos[e.from],
        b = pos[e.to];
      if (!a || !b) continue;
      const ca = midpoint(a),
        cb = midpoint(b);
      let dx = cb.x - ca.x,
        dy = cb.y - ca.y,
        d = magnitude(dx, dy);
      if (d < 0.01) {
        dx = 1;
        dy = 0.1;
        d = 1;
      }
      const crossBoundary = parent(e.from) !== parent(e.to) || !e.a || !e.b;
      const strength = crossBoundary ? s.boundaryPull / 100 : 0.35,
        v = direction === 'DOWN';
      const ideal = s.edgeLength + (Math.hypot(a.w, a.h) + Math.hypot(b.w, b.h)) / 4;
      let fx: number, fy: number;
      if (s.algorithm === 'boundary-align') {
        const cross = (v ? dx : dy) * (0.04 + (s.alignment / 100) * 0.16) * strength;
        fx = v ? cross : (dx / d) * (d - ideal) * 0.008 * strength;
        fy = v ? (dy / d) * (d - ideal) * 0.008 * strength : cross;
      } else {
        const pull = (d - ideal) * 0.1 * strength;
        fx = (dx / d) * pull;
        fy = (dy / d) * pull;
        if (s.algorithm === 'compound-flow') {
          const cross = (v ? dx : dy) * 0.055 * strength;
          fx += v ? cross : 0;
          fy += v ? 0 : cross;
        }
      }
      if (e.a) add(e.a, fx, fy);
      if (e.b) add(e.b, -fx, -fy);
    }
  // All connective approaches share a direction objective. Undirected links
  // retain attraction but never become ordering constraints. Feedback links
  // are excluded deterministically rather than silently reversing arrows.
  if (s.respectDirection && s.algorithm !== 'separate')
    for (const e of t.forward) {
      const a = byId.get(e.from)!,
        b = byId.get(e.to)!,
        v = direction === 'DOWN',
        ca = midpoint(a),
        cb = midpoint(b);
      const gap = (v ? a.h + b.h : a.w + b.w) / 2 + s.rankGap,
        error = gap - (v ? cb.y - ca.y : cb.x - ca.x);
      if (error <= 0) continue;
      const force = error * (0.12 + (s.flowStrength / 100) * 0.65);
      add(a.id, v ? 0 : -force, v ? -force : 0, 0);
      add(b.id, v ? 0 : force, v ? force : 0, 0);
    }
  if (target)
    for (const p of items) {
      const c = midpoint(p),
        q = target.get(p.id)!,
        strength = s.algorithm === 'grid' ? 0.018 + (s.gridStrength / 100) * 0.16 : 0.18;
      add(p.id, (q.x - c.x) * strength, (q.y - c.y) * strength);
    }
  if (s.algorithm !== 'separate') {
    const b = bounds(items),
      c = midpoint(b),
      ratio = b.w / b.h,
      aspectError = clamp(Math.log(ratio / availableAspect), -2, 2);
    for (const p of items) {
      const pc = midpoint(p),
        a = origin.get(p.id)!,
        f = forces.get(p.id)!,
        norm = Math.max(1, Math.sqrt(f.degree));
      f.x /= norm;
      f.y /= norm;
      f.x += (a.x - pc.x) * anchor;
      f.y += (a.y - pc.y) * anchor;
      if (
        !['flow', 'tree', 'radial', 'layered', 'compound-flow', 'boundary-align'].includes(
          s.algorithm,
        )
      ) {
        const k = (s.compactness / 100) * 0.016;
        f.x += (baseCenter.x - pc.x) * k - (pc.x - c.x) * aspectError * k;
        f.y += (baseCenter.y - pc.y) * k + (pc.y - c.y) * aspectError * k;
        // Break an exactly collinear network only in the organic engines.
        if (
          ['stress', 'force'].includes(s.algorithm) &&
          Math.abs(pc.y - c.y) < 0.01 &&
          aspectError > 0.8
        )
          f.y += (hash(p.id) - 0.5) * s.nodeGap * 0.025;
      }
    }
  }
  if (s.algorithm !== 'separate')
    for (const [id, q] of hintTargets(items, localIntent)) {
      const p = midpoint(byId.get(id)!);
      add(id, (q.x - p.x) * 0.2, (q.y - p.y) * 0.2, 0);
    }
  return forces;
}
