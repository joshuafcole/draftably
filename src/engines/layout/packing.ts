import type { Batch } from './arrange.ts';
import type { Scene } from './scene.ts';
import { clamp, cmp, midpoint, penetration } from './util.ts';

/**
 * After a rebuild that left overlaps inside a fixed frame: place the movable items one at a time
 * at the free spot nearest their target, in up to four orders. Moves them only when one order fits.
 */
export function packIntoFrame(scene: Scene, batch: Batch, collisions: number) {
  const { s, pos, groups, move } = scene,
    { warnings } = scene.run,
    { items, container, target, parentId, sync } = batch;
  if (collisions && s.mode === 'rebuild' && container && !s.growContainers && items.length <= 24) {
    const movable = items.filter(p => !p.fixed),
      locked = items.filter(p => p.fixed);
    const orders = [
      [...movable].sort((a, b) => b.w * b.h - a.w * a.h || cmp(a.id, b.id)),
      [...movable].sort((a, b) => cmp(a.id, b.id)),
      [...movable].sort((a, b) => b.h - a.h || b.w - a.w || cmp(a.id, b.id)),
      [...movable].sort((a, b) => cmp(b.id, a.id)),
    ];
    let packed = null;
    for (const order of orders) {
      const placed = locked.map(p => ({ ...p })),
        candidate = new Map();
      let failed = false;
      for (const p of order) {
        if (p.w > container.w || p.h > container.h) {
          failed = true;
          break;
        }
        const q = target?.get(p.id) || midpoint(p);
        const xs = new Set([
          container.x,
          container.x + container.w - p.w,
          clamp(q.x - p.w / 2, container.x, container.x + container.w - p.w),
        ]);
        const ys = new Set([
          container.y,
          container.y + container.h - p.h,
          clamp(q.y - p.h / 2, container.y, container.y + container.h - p.h),
        ]);
        for (const box of placed) {
          xs.add(box.x + box.w + s.nodeGap + 0.2);
          xs.add(box.x - p.w - s.nodeGap - 0.2);
          ys.add(box.y + box.h + s.nodeGap + 0.2);
          ys.add(box.y - p.h - s.nodeGap - 0.2);
        }
        let choice = null;
        for (const y of [...ys].sort((a, b) => a - b))
          for (const x of [...xs].sort((a, b) => a - b)) {
            if (
              x < container.x - 0.001 ||
              y < container.y - 0.001 ||
              x + p.w > container.x + container.w + 0.001 ||
              y + p.h > container.y + container.h + 0.001
            )
              continue;
            const box = { ...p, x, y };
            if (placed.some(other => penetration(box, other, s.nodeGap))) continue;
            const cost = (x + p.w / 2 - q.x) ** 2 + (y + p.h / 2 - q.y) ** 2;
            if (!choice || cost < choice.cost - 0.001) choice = { box, cost };
          }
        if (!choice) {
          failed = true;
          break;
        }
        placed.push(choice.box);
        candidate.set(p.id, choice.box);
      }
      if (!failed) {
        packed = candidate;
        break;
      }
    }
    if (packed) {
      for (const [id, p] of packed) move(id, p.x - pos[id].x, p.y - pos[id].y);
      sync();
      warnings.add(
        'Used local packing inside "' +
          (groups.get(parentId!)?.title || parentId) +
          '" because the requested arrangement did not fit its fixed frame.',
      );
    }
  }
}
