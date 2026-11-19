import type { Batch } from './arrange.ts';
import type { Scene } from './scene.ts';
import type { Axis, Item } from './types.ts';
import { clamp, penetration } from './util.ts';

/**
 * The guarded moves of one solve: a move that keeps an item in its frame and inside the pass's
 * movement limit, the room an item has along one axis, and the pairwise pass that pushes
 * overlapping items apart.
 */
export function createSeparation(scene: Scene, batch: Batch) {
  const { s, pos, original, groups, descend, move } = scene,
    { warnings } = scene.run,
    { items, container, pairGap } = batch;
  const constrainedMove = (p: Item, dx: number, dy: number) => {
    if (p.fixed) return;
    if (container && !s.growContainers) {
      if (p.w <= container.w) {
        dx = clamp(p.x + dx, container.x, container.x + container.w - p.w) - p.x;
      } else {
        warnings.add('A child is wider than its container. Resize the frame or allow growth.');
        dx = 0;
      }
      if (p.h <= container.h) {
        dy = clamp(p.y + dy, container.y, container.y + container.h - p.h) - p.y;
      } else {
        warnings.add('A child is taller than its container. Resize the frame or allow growth.');
        dy = 0;
      }
    }
    move(p.id, dx, dy);
    p.x = pos[p.id].x;
    p.y = pos[p.id].y;
  };
  function axisCapacity(p: Item, axis: Axis, sign: number) {
    if (p.fixed) return 0;
    let capacity = Infinity;
    if (container && !s.growContainers) {
      const length = axis === 'x' ? 'w' : 'h';
      capacity = Math.max(
        0,
        sign > 0
          ? container[axis] + container[length] - p[axis] - p[length]
          : p[axis] - container[axis],
      );
    }
    if (s.mode === 'pass')
      for (const id of [p.id, ...(groups.has(p.id) ? descend(p.id) : [])]) {
        const current = pos[id],
          old = original[id],
          along = (current[axis] - old[axis]) * sign,
          other = axis === 'x' ? current.y - old.y : current.x - old.x;
        capacity = Math.min(
          capacity,
          Math.max(0, Math.sqrt(Math.max(0, s.maxMove * s.maxMove - other * other)) - along),
        );
      }
    return capacity;
  }
  function separate(rounds = 3) {
    for (let pass = 0; pass < rounds; pass++) {
      for (let i = 0; i < items.length; i++)
        for (let j = i + 1; j < items.length; j++) {
          const a = items[i],
            b = items[j],
            gap = pairGap(a, b),
            p = penetration(a, b, gap);
          if (!p || (a.fixed && b.fixed)) continue;
          // Try all four separating directions. The shortest axis may be
          // blocked by a pin or a frame wall; do not repeatedly push into it.
          const candidates = [];
          for (const axis of ['x', 'y'] as const)
            for (const sign of [1, -1]) {
              const half = axis === 'x' ? (a.w + b.w) / 2 : (a.h + b.h) / 2,
                delta = axis === 'x' ? p.dx : p.dy;
              const need = half + gap - sign * delta + 0.15,
                ca = axisCapacity(a, axis, -sign),
                cb = axisCapacity(b, axis, sign),
                available = ca + cb;
              const feasible = available >= need - 0.001,
                coverage = Math.min(1, available / need);
              candidates.push({ axis, sign, need, ca, cb, available, feasible, coverage });
            }
          candidates.sort(
            (a, b) =>
              Number(b.feasible) - Number(a.feasible) ||
              (a.feasible ? a.need - b.need : b.coverage - a.coverage) ||
              a.need - b.need,
          );
          const best = candidates[0];
          if (best.available < 0.001) continue;
          const amount = Math.min(best.need, best.available),
            aa = Math.min(best.ca, amount / 2),
            bb = Math.min(best.cb, amount - aa),
            extra = Math.min(best.ca - aa, amount - aa - bb),
            da = (aa + extra) * best.sign,
            db = bb * best.sign;
          constrainedMove(a, best.axis === 'x' ? -da : 0, best.axis === 'y' ? -da : 0);
          constrainedMove(b, best.axis === 'x' ? db : 0, best.axis === 'y' ? db : 0);
        }
    }
  }
  const collisions = () => {
    let n = 0,
      a = 0;
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const p = penetration(items[i], items[j]);
        if (p) {
          n++;
          a += p.area;
        }
      }
    return { n, a };
  };
  return { constrainedMove, axisCapacity, separate, collisions };
}
