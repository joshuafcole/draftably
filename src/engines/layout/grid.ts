import type { Centres, Item, Rect, Settings } from './types.ts';
import { bounds, cmp, magnitude, midpoint } from './util.ts';

/** Items in ID order on a grid of even cells, near the wanted aspect. */
export function seedGrid(items: Item[], s: Settings, aspect: number): Centres {
  const aw = items.reduce((n, p) => n + p.w, 0) / Math.max(1, items.length),
    ah = items.reduce((n, p) => n + p.h, 0) / Math.max(1, items.length);
  const cols = Math.max(
    1,
    Math.round(Math.sqrt((items.length * aspect * (ah + s.nodeGap)) / (aw + s.nodeGap))),
  );
  const mw = Math.max(...items.map(p => p.w)),
    mh = Math.max(...items.map(p => p.h));
  return new Map(
    items.map((p, i) => [
      p.id,
      {
        x: (i % cols) * (mw + s.nodeGap) + p.w / 2,
        y: Math.floor(i / cols) * (mh + s.nodeGap) + p.h / 2,
      },
    ]),
  );
}
/** The nearest free cell of a grid round the current centre, closest matches first. */
export function gridTarget(items: Item[], s: Settings, aspect: number): Centres {
  const seed = seedGrid(items, s, aspect);
  if (s.mode === 'rebuild') return seed;
  const b = bounds(items),
    c = midpoint(b),
    sb = bounds(
      items.map(p => {
        const a = seed.get(p.id)!;
        return { ...p, x: a.x - p.w / 2, y: a.y - p.h / 2 };
      }),
    ),
    sc = midpoint(sb);
  const cells = [...seed.values()].map((p, i) => ({
      ...p,
      x: p.x + c.x - sc.x,
      y: p.y + c.y - sc.y,
      i,
    })),
    map: Centres = new Map(),
    used = new Set<number>();
  // Assign easy / close matches first. A node moved by hand is matched near its new location.
  const order = items
    .map(p => ({
      p,
      c: midpoint(p),
      nearest: Math.min(...cells.map(q => magnitude(midpoint(p).x - q.x, midpoint(p).y - q.y))),
    }))
    .sort((a, b) => a.nearest - b.nearest || cmp(a.p.id, b.p.id));
  for (const { p, c } of order) {
    let best: { cell: (typeof cells)[number]; d: number } | undefined;
    for (const cell of cells) {
      if (used.has(cell.i)) continue;
      const d = (cell.x - c.x) ** 2 + (cell.y - c.y) ** 2;
      if (!best || d < best.d) best = { cell, d };
    }
    used.add(best!.cell.i);
    map.set(p.id, { x: best!.cell.x, y: best!.cell.y });
  }
  return map;
}
/**
 * Shifts a target onto the drawing: onto the container's corner, the mean of the fixed items, a
 * fixed origin for a rebuild (`canonical`), or else the items' current centre.
 */
export function alignTarget(
  map: Centres,
  items: Item[],
  container: Rect | null,
  canonical = false,
): Centres {
  const source = bounds(items),
    target = bounds(
      items.map(p => {
        const at = map.get(p.id)!;
        return { ...p, x: at.x - p.w / 2, y: at.y - p.h / 2 };
      }),
    );
  const locked = items.filter(p => p.fixed),
    sc = midpoint(source),
    tc = midpoint(target);
  let dx = sc.x - tc.x,
    dy = sc.y - tc.y;
  if (canonical) {
    dx = 64 - target.x;
    dy = 64 - target.y;
  }
  if (container) {
    dx = container.x - target.x;
    dy = container.y - target.y;
  } else if (locked.length) {
    dx = locked.reduce((sum, p) => sum + midpoint(p).x - map.get(p.id)!.x, 0) / locked.length;
    dy = locked.reduce((sum, p) => sum + midpoint(p).y - map.get(p.id)!.y, 0) / locked.length;
  }
  for (const p of map.values()) {
    p.x += dx;
    p.y += dy;
  }
  return map;
}
