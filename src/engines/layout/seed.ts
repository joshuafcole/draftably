import type { Direction } from '../../model/types.ts';
import { alignTarget, seedGrid } from './grid.ts';
import type { Scene } from './scene.ts';
import { clamp } from './util.ts';

// Initialise the entire active hierarchy before cross-boundary forces run.
// Otherwise the first inner solve would depend on old positions in an
// as-yet-unsolved neighbouring container, even in a canonical rebuild.
export function seedHierarchy(scene: Scene, pid: string | null, direction: Direction) {
  const { doc, s, aspect, pos, groups, child, branch, visible, padded, fixed, move } = scene;
  if (pid && branch(pid)) return;
  const choice = doc.layout.containers[pid!]?.direction,
    dir = choice && choice !== 'inherit' ? choice : direction;
  const items = child(pid)
    .filter(n => visible(n.id))
    .map(n => ({ id: n.id, ...padded(n.id), fixed: fixed(n.id) }));
  if (!items.length) return;
  const frame = pid ? pos[pid] : null,
    pad = doc.layout.containers[pid!]?.padding || 24;
  const box = frame
    ? { x: frame.x + pad, y: frame.y + pad + 28, w: frame.w - 2 * pad, h: frame.h - 2 * pad - 28 }
    : null;
  const local = { ...s, direction: dir, fold: s.respectDirection ? 'never' : s.fold },
    ratio = box ? Math.max(0.3, box.w / Math.max(1, box.h)) : aspect;
  const seed = alignTarget(seedGrid(items, local, ratio), items, box, true);
  for (const p of items) {
    if (p.fixed) continue;
    const q = seed.get(p.id)!;
    let x = q.x - p.w / 2,
      y = q.y - p.h / 2;
    if (box && !s.growContainers) {
      if (p.w <= box.w) x = clamp(x, box.x, box.x + box.w - p.w);
      if (p.h <= box.h) y = clamp(y, box.y, box.y + box.h - p.h);
    }
    move(p.id, x - pos[p.id].x, y - pos[p.id].y);
  }
  for (const p of items)
    if (groups.has(p.id) && !doc.collapsed.includes(p.id)) seedHierarchy(scene, p.id, dir);
}
