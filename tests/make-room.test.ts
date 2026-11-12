/**
 * Making room (`dsl/dilate.ts`, `dsl/make-room.ts`): opening a card warps the drawing instead of
 * laying it out again. Property tests over seeded random drawings, compiled for real:
 *
 * - the warp: every point outside the opened box moves by its cut's translation or not at all,
 *   on each axis, no route is recomputed, and the same open set draws the same boxes whatever
 *   order its containers were opened in;
 * - `redrawBent`: the boxes stay the warp's, and only the lines the warp bent are routed again.
 */
import { describe, expect, it } from 'vitest';
import { compile } from '../src/dsl/compile';
import { dilate, type Cut, type WarpBox } from '../src/dsl/dilate';
import { makeRoom, redrawBent, type RoomDrawing } from '../src/dsl/make-room';
import { projectScene, visibleRects } from '../src/dsl/project';
import { bundlesOf } from '../src/model/bundles';
import { computeRoutes } from '../src/model/routes';
import type { Point, Rect } from '../src/model/types';

/** A small seeded generator, so a failure names the seed that made it. */
function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function drawn(source: string): Promise<RoomDrawing> {
  const doc = projectScene(await compile(source)),
    { vg, rects } = visibleRects(doc),
    { result } = computeRoutes(doc, vg, rects, { previous: [] });
  return { doc, routes: result };
}

/**
 * A random flat drawing of `n` nodes and some flows, in which each of `cards` is a card at rest
 * and, opened, a container of its own few parts. A flow into a card lands on one of its parts once
 * it is open.
 */
function world(seed: number) {
  const next = random(seed),
    n = 5 + Math.floor(next() * 6),
    ids = Array.from({ length: n }, (_, i) => `n${i}`),
    cards = [ids[Math.floor(next() * n)]!],
    second = ids[Math.floor(next() * n)]!;
  if (second !== cards[0]) cards.push(second);
  const parts = new Map(cards.map(c => [c, 1 + Math.floor(next() * 3)]));
  const flows: Array<[string, string]> = [];
  for (let i = 1; i < n; i++) flows.push([ids[Math.floor(next() * i)]!, ids[i]!]);
  for (let i = 0; i < n / 2; i++) {
    const a = ids[Math.floor(next() * n)]!,
      b = ids[Math.floor(next() * n)]!;
    if (a !== b && !flows.some(([x, y]) => x === a && y === b)) flows.push([a, b]);
  }
  const direction = next() < 0.5 ? 'right' : 'down';
  const source = (open: ReadonlySet<string>) => {
    const lines = [`layout root flow direction=${direction}`];
    for (const id of ids) {
      if (!open.has(id)) {
        lines.push(`node ${id} "Node ${id}"`);
        continue;
      }
      lines.push(`group ${id} "Opened ${id}"`);
      const k = parts.get(id)!;
      for (let j = 0; j < k; j++) lines.push(`node ${id}.p${j} "Part ${j}" in=${id}`);
      for (let j = 1; j < k; j++) lines.push(`edge ${id}.f${j} ${id}.p${j - 1} -> ${id}.p${j}`);
    }
    const end = (id: string) => (open.has(id) ? `${id}.p0` : id);
    flows.forEach(([a, b], i) => lines.push(`edge e${i} ${end(a)} -> ${end(b)}`));
    return lines.join('\n') + '\n';
  };
  return { cards, source };
}

const close = (a: number, b: number) => Math.abs(a - b) < 0.01;
const moves = (was: number, now: number, deltas: number[]) => deltas.some(d => close(now - was, d));

/** The translations a cut set can give one coordinate: none, or any of its cuts' signed deltas. */
function translations(cuts: Array<Cut & { frame: string }>, axis: 'x' | 'y') {
  const own = cuts.filter(c => c.axis === axis && c.frame === 'root');
  const signed = own.map(c => c.dir * c.delta),
    sums = new Set([0]);
  for (const d of signed) for (const s of [...sums]) sums.add(s + d);
  return [...sums];
}

describe('dilate, the warp itself', () => {
  const boxes: WarpBox[] = [
    { id: 'a', parent: 'root', x: 0, y: 0, w: 100, h: 50 },
    { id: 'card', parent: 'root', x: 150, y: 0, w: 100, h: 50 },
    { id: 'b', parent: 'root', x: 300, y: 0, w: 100, h: 50 },
    { id: 'c', parent: 'root', x: 300, y: 100, w: 100, h: 50 },
  ];

  it('grows toward the emptier side, and moves nothing that side has none of', () => {
    // One box left of the card, two right: the card grows left and pushes only `a`.
    const out = dilate(boxes, [{ id: 'card', w: 300, h: 50 }]);
    expect(out.rects.get('card')).toEqual({ x: -50, y: 0, w: 300, h: 50 });
    expect(out.rects.get('a')).toEqual({ x: -200, y: 0, w: 100, h: 50 });
    expect(out.rects.get('b')).toEqual({ x: 300, y: 0, w: 100, h: 50 });
    expect(out.rects.get('c')).toEqual({ x: 300, y: 100, w: 100, h: 50 });
  });

  it('an end on the opened card follows the edge it stood on', () => {
    const out = dilate(boxes, [{ id: 'card', w: 100, h: 200 }]);
    const card = out.rects.get('card')!;
    expect(out.point({ x: 150, y: 25 })).toEqual({ x: card.x, y: card.y + 25 });
    expect(out.point({ x: 200, y: 50 })).toEqual({ x: card.x + 50, y: card.y + card.h });
  });

  it('a nested opening grows its container, which opens one level out, bottom up', () => {
    const nested: WarpBox[] = [
      { id: 'g', parent: 'root', x: 0, y: 0, w: 300, h: 200 },
      { id: 'in', parent: 'g', x: 24, y: 48, w: 100, h: 50 },
      { id: 'side', parent: 'g', x: 24, y: 120, w: 100, h: 50 },
      { id: 'out', parent: 'root', x: 400, y: 0, w: 100, h: 50 },
    ];
    const out = dilate(nested, [{ id: 'in', w: 400, h: 50 }]);
    const g = out.rects.get('g')!;
    // Inside g the part grows right, and g with it; at the root g has `out` beyond it and nothing
    // before it, so it grows left, and `out` holds still.
    expect(g).toEqual({ x: -300, y: 0, w: 600, h: 200 });
    expect(out.rects.get('in')).toEqual({ x: -276, y: 48, w: 400, h: 50 });
    expect(out.rects.get('side')).toEqual({ x: -276, y: 120, w: 100, h: 50 });
    expect(out.rects.get('out')).toEqual({ x: 400, y: 0, w: 100, h: 50 });
    expect(out.cuts.map(c => c.scope).sort()).toEqual(['g', 'g', 'root', 'root']);
  });

  it('is the same whatever order the openings are listed in', () => {
    const two = [
      { id: 'a', w: 220, h: 90 },
      { id: 'c', w: 150, h: 260 },
    ];
    const one = dilate(boxes, two),
      other = dilate(boxes, [...two].reverse());
    expect([...other.rects]).toEqual([...one.rects]);
  });
});

describe('makeRoom, the warp', () => {
  const seeds = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);

  it.each(seeds)(
    'seed %i: outside the opened box, everything moves by a cut or not at all',
    async seed => {
      const { cards, source } = world(seed),
        card = cards[0]!,
        rest = await drawn(source(new Set())),
        open = await drawn(source(new Set([card])));
      const made = makeRoom(rest, new Map([[card, open]]), open.doc);
      expect(made.rerouted).toEqual([]);
      const xs = translations(made.cuts, 'x'),
        ys = translations(made.cuts, 'y'),
        before = visibleRects(rest.doc).rects,
        after = visibleRects(made.doc).rects,
        opened = after.get(card)!;
      for (const [id, was] of before) {
        if (id === card) continue;
        const now = after.get(id)!;
        expect(moves(was.x, now.x, xs), `${id} x`).toBe(true);
        expect(moves(was.y, now.y, ys), `${id} y`).toBe(true);
        expect(moves(was.x + was.w, now.x + now.w, xs), `${id} right`).toBe(true);
        expect(moves(was.y + was.h, now.y + now.h, ys), `${id} bottom`).toBe(true);
      }
      // Routes between boxes that stayed outside keep every point, each moved by a cut or not at all.
      const restRoutes = new Map(rest.routes.routes.map(r => [r.id, r]));
      for (const r of made.routes.routes) {
        const was = restRoutes.get(r.id);
        if (!was) continue;
        const outside = (p: Point, box: Rect) =>
          p.x < box.x || p.x > box.x + box.w || p.y < box.y || p.y > box.y + box.h;
        const touches =
          r.from.startsWith(`${card}.`) ||
          r.to.startsWith(`${card}.`) ||
          r.from === card ||
          r.to === card;
        if (!touches) expect(r.points.length, `${r.id} kept its bends`).toBe(was.points.length);
        const kept = touches ? r.points.filter(p => outside(p, opened)) : r.points;
        for (const p of kept) {
          const source_ = touches ? undefined : was.points[r.points.indexOf(p)];
          if (!source_) continue;
          expect(moves(source_.x, p.x, xs), `${r.id} point x`).toBe(true);
          expect(moves(source_.y, p.y, ys), `${r.id} point y`).toBe(true);
        }
      }
    },
  );

  it.each(seeds.slice(0, 8))(
    'seed %i: the opened box holds its content, and nothing overlaps it',
    async seed => {
      const { cards, source } = world(seed),
        card = cards[0]!,
        rest = await drawn(source(new Set())),
        open = await drawn(source(new Set([card])));
      const made = makeRoom(rest, new Map([[card, open]]), open.doc);
      const after = visibleRects(made.doc).rects,
        frame = after.get(card)!,
        own = visibleRects(open.doc).rects.get(card)!;
      expect({ w: frame.w, h: frame.h }).toEqual({ w: own.w, h: own.h });
      for (const [id, r] of after) {
        if (id === card) continue;
        const mine = id.startsWith(`${card}.`);
        const overlaps =
          r.x < frame.x + frame.w &&
          r.x + r.w > frame.x &&
          r.y < frame.y + frame.h &&
          r.y + r.h > frame.y;
        if (mine)
          expect(r.x >= frame.x && r.x + r.w <= frame.x + frame.w, `${id} inside`).toBe(true);
        else expect(overlaps, `${id} clear of the opened box`).toBe(false);
      }
    },
  );
});

describe('makeRoom, in any order', () => {
  const seeds = Array.from({ length: 6 }, (_, i) => 77 + i * 104729);

  it.each(seeds)(
    'seed %i: the same boxes in any order of opening',
    async seed => {
      const { cards, source } = world(seed),
        all = new Set(cards),
        rest = await drawn(source(new Set())),
        final = await drawn(source(all)),
        // Each card's own drawing: it open, the other still closed.
        own = new Map(
          await Promise.all(cards.map(async c => [c, await drawn(source(new Set([c])))] as const)),
        );
      const forward = makeRoom(rest, new Map(cards.map(c => [c, own.get(c)!])), final.doc),
        backward = makeRoom(
          rest,
          new Map([...cards].reverse().map(c => [c, own.get(c)!])),
          final.doc,
        );
      const rects = (doc: RoomDrawing['doc']) =>
        [...visibleRects(doc).rects].sort(([a], [b]) => (a < b ? -1 : 1));
      expect(rects(backward.doc)).toEqual(rects(forward.doc));
    },
    60_000,
  );
});

/**
 * A portal and a trunk through the warp (Phase 14 on Phase 13): a card with three lines to a
 * portal opens, so the portal is beyond the cut and moves with it. It stays outside the frame on
 * the side it faced, the redraw leaves it where the warp put it, and the three lines stay one trunk.
 */
describe('makeRoom, a portal and a trunk', () => {
  const source = (open: boolean) =>
    [
      'routing bundle=3',
      'layout root flow direction=right',
      'node a "Gateway"',
      'node b "Planner"',
      ...(open
        ? [
            'group c "Crawler"',
            'node c.p0 "Fetcher" in=c',
            'node c.p1 "Parser" in=c',
            'edge c.f c.p0 -> c.p1',
          ]
        : ['node c "Crawler"']),
      'node far "Offsite" shape=portal',
      'edge ab a -> b',
      `edge bc b -> ${open ? 'c.p0' : 'c'}`,
      ...['x', 'y', 'z'].map((id, i) =>
        i === 1
          ? `edge ${id} far -> ${open ? 'c.p0' : 'c'}`
          : `edge ${id} ${open ? 'c.p0' : 'c'} -> far`,
      ),
    ].join('\n') + '\n';
  const outside = (doc: RoomDrawing['doc']) => {
    const { rects } = visibleRects(doc),
      others = [...rects].filter(([id]) => id !== 'far').map(([, r]) => r),
      p = rects.get('far')!;
    return {
      p,
      right: p.x - Math.max(...others.map(r => r.x + r.w)),
    };
  };

  it('keeps the portal outside the frame and the trunk one trunk, warped and redrawn', async () => {
    const rest = await drawn(source(false)),
      open = await drawn(source(true)),
      made = makeRoom(rest, new Map([['c', open]]), open.doc);
    const before = outside(rest.doc),
      after = outside(made.doc);
    expect(before.right).toBeGreaterThan(0);
    // The portal is beyond the crawler's cut: it moved, and kept its gap to the frame.
    expect(after.p.x).toBeGreaterThan(before.p.x);
    expect(after.right).toBeCloseTo(before.right, 2);
    for (const drawing of [rest, made]) {
      const trunks = bundlesOf(drawing.doc, drawing.routes.routes);
      expect(trunks).toHaveLength(1);
      expect([...trunks[0].members].sort()).toEqual(['x', 'y', 'z']);
    }
    const redrawn = redrawBent(made),
      held = outside(redrawn.doc);
    expect(redrawn.redrawn.length).toBeGreaterThan(0);
    expect(held.p).toEqual(after.p);
    const trunks = bundlesOf(redrawn.doc, redrawn.routes.routes);
    expect(trunks).toHaveLength(1);
    expect(trunks[0].members).toHaveLength(3);
  });
});

/** Where `p` lies on the course, within a hundredth: on one of its pieces. */
const onCourse = (p: Point, points: readonly Point[]) =>
  points.some((a, i) => {
    const b = points[i + 1];
    if (!b) return close(a.x, p.x) && close(a.y, p.y);
    const within = (v: number, u: number, w: number) =>
      v >= Math.min(u, w) - 0.01 && v <= Math.max(u, w) + 0.01;
    return (
      within(p.x, a.x, b.x) &&
      within(p.y, a.y, b.y) &&
      Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) <
        0.01 * Math.hypot(b.x - a.x, b.y - a.y) + 0.01
    );
  });
const level = (points: readonly Point[]) =>
  points.every((p, i) => !i || close(p.x, points[i - 1].x) || close(p.y, points[i - 1].y));

/** The boxes a course passes through, short of its own ends and the containers they are in. */
function through(
  doc: RoomDrawing['doc'],
  r: { from: string; to: string; points: readonly Point[] },
) {
  const { rects } = visibleRects(doc),
    parent = new Map([...doc.graph.nodes, ...doc.graph.groups].map(o => [o.id, o.parentId])),
    mine = new Set<string>();
  for (const end of [r.from, r.to])
    for (let at: string | undefined = end; at; at = parent.get(at)) mine.add(at);
  return [...rects]
    .filter(([id]) => !mine.has(id))
    .filter(([, b]) =>
      r.points.some((a, i) => {
        const c = r.points[i + 1];
        if (!c) return false;
        return (
          Math.max(a.x, c.x) > b.x + 0.5 &&
          Math.min(a.x, c.x) < b.x + b.w - 0.5 &&
          Math.max(a.y, c.y) > b.y + 0.5 &&
          Math.min(a.y, c.y) < b.y + b.h - 0.5
        );
      }),
    )
    .map(([id]) => id);
}

describe('redrawBent: the warp, and only the lines it bent redrawn', () => {
  const seeds = Array.from({ length: 24 }, (_, i) => 1000 + i * 7919);

  it.each(seeds)(
    'seed %i: boxes stay where the warp put them, unbent lines are the warp’s, bent ones clear every box',
    async seed => {
      const { cards, source } = world(seed),
        card = cards[0]!,
        rest = await drawn(source(new Set())),
        open = await drawn(source(new Set([card])));
      const made = makeRoom(rest, new Map([[card, open]]), open.doc),
        out = redrawBent(made);
      // Boxes: the warp's, exactly (the warp's own guarantees are the tests above).
      expect([...visibleRects(out.doc).rects]).toEqual([...visibleRects(made.doc).rects]);
      const warped = new Map(made.routes.routes.map(r => [r.id, r])),
        bent = new Set([...made.joined, ...made.rerouted, ...made.reshaped]),
        fresh = () => {
          const { vg, rects } = visibleRects(made.doc);
          return new Map(
            computeRoutes(made.doc, vg, rects, { previous: [] }).result.routes.map(r => [r.id, r]),
          );
        };
      expect(out.routes.routes.map(r => r.id).sort()).toEqual([...warped.keys()].sort());
      for (const r of out.routes.routes) {
        if (!out.redrawn.includes(r.id)) {
          // Kept: point for point the warp's.
          expect(r.points, `${r.id} kept`).toEqual(warped.get(r.id)!.points);
          if (!r.blocked)
            expect(through(out.doc, r), `${r.id} clear of the frame`).not.toContain(card);
          continue;
        }
        // Only a line the warp reshaped or stitched is ever redrawn, and a stitched one always is.
        expect(bent.has(r.id), `${r.id} was bent`).toBe(true);
        // Blocked only where the router finds no way even with every line drawn afresh.
        if (r.blocked) {
          expect(fresh().get(r.id)!.blocked, `${r.id} has no route at all`).toBe(true);
          continue;
        }
        expect(level(r.points), `${r.id} level and upright`).toBe(true);
        expect(through(out.doc, r), `${r.id} clear of every box`).toEqual([]);
      }
      for (const id of made.joined) expect(out.redrawn, `${id} joined`).toContain(id);
      // A line the warp moved whole is never touched.
      for (const id of warped.keys())
        if (!bent.has(id)) expect(out.redrawn, `${id} moved whole`).not.toContain(id);
    },
  );

  it.each(seeds.slice(0, 8))(
    'seed %i: nothing opened, nothing is redrawn (closing puts every line back)',
    async seed => {
      const rest = await drawn(world(seed).source(new Set())),
        out = redrawBent(makeRoom(rest, new Map(), rest.doc));
      const byId = (routes: readonly { id: string }[]) =>
        [...routes].sort((a, b) => (a.id < b.id ? -1 : 1));
      expect(out.redrawn).toEqual([]);
      expect(byId(out.routes.routes)).toEqual(byId(rest.routes.routes));
    },
  );

  it.each(Array.from({ length: 6 }, (_, i) => 77 + i * 104729))(
    'seed %i: the same open set draws the same lines whatever order it was opened in',
    async seed => {
      const { cards, source } = world(seed),
        rest = await drawn(source(new Set())),
        final = await drawn(source(new Set(cards))),
        own = new Map(
          await Promise.all(cards.map(async c => [c, await drawn(source(new Set([c])))] as const)),
        );
      const one = redrawBent(makeRoom(rest, new Map(cards.map(c => [c, own.get(c)!])), final.doc)),
        other = redrawBent(
          makeRoom(rest, new Map([...cards].reverse().map(c => [c, own.get(c)!])), final.doc),
        );
      expect(other.routes.routes).toEqual(one.routes.routes);
      expect(other.redrawn).toEqual(one.redrawn);
    },
    60_000,
  );

  it('keeps authored bends: warped with the line it keeps, and the line it redraws runs through them', async () => {
    const base = (open: boolean) =>
      [
        'layout root flow direction=right',
        'node a "Gateway"',
        ...(open
          ? [
              'group card "Ranker"',
              'node card.p0 "Scorer" in=card',
              'node card.p1 "Cache" in=card',
              'edge card.f card.p0 -> card.p1',
            ]
          : ['node card "Ranker"']),
        'node b "Merger"',
        'edge ab a -> b',
        `edge ac a -> ${open ? 'card.p0' : 'card'}`,
        `edge cb ${open ? 'card.p1' : 'card'} -> b`,
      ].join('\n') + '\n';
    // Where the boxes sit at rest decides where the bends go: over the row, and under it.
    const bare = visibleRects((await drawn(base(false))).doc).rects,
      a = bare.get('a')!,
      b = bare.get('b')!,
      card = bare.get('card')!,
      top = Math.min(a.y, b.y, card.y) - 60,
      bottom = Math.max(a.y + a.h, card.y + card.h) + 60,
      ax = a.x + a.w / 2,
      bends = (open: boolean) =>
        base(open) +
        `route ab via=${ax + 30},${top};${b.x + b.w / 2 - 30},${top} strength=required\n` +
        `route ac via=${ax - 30},${bottom};${card.x + card.w / 2 + 30},${bottom} strength=required\n`;
    const rest = await drawn(bends(false)),
      open = await drawn(bends(true)),
      made = makeRoom(rest, new Map([['card', open]]), open.doc),
      out = redrawBent(made);
    expect(made.cuts.some(c => c.axis === 'x' && c.delta > 0)).toBe(true);
    const point = (id: string) => made.doc.layout.edges[id]!.waypoints!,
      route = (id: string) => out.routes.routes.find(r => r.id === id)!,
      restAb = rest.routes.routes.find(r => r.id === 'ab')!;
    expect(point('ab')).toHaveLength(2);
    // The line over the row: kept, its bends where the warp put them, its vertex count kept.
    expect(out.redrawn).not.toContain('ab');
    expect(route('ab').points).toHaveLength(restAb.points.length);
    for (const p of point('ab'))
      expect(onCourse(p, route('ab').points), 'ab through its bend').toBe(true);
    // The line into the opened card: joined, so redrawn, through its bends where the warp put them.
    expect(out.redrawn).toContain('ac');
    expect(route('ac').blocked).toBe(false);
    expect(level(route('ac').points)).toBe(true);
    for (const p of point('ac'))
      expect(onCourse(p, route('ac').points), 'ac through its bend').toBe(true);
    for (const [p, q] of point('ac').map((p, i) => [
      p,
      rest.doc.layout.edges['ac']!.waypoints![i]!,
    ])) {
      const xs = translations(made.cuts, 'x'),
        ys = translations(made.cuts, 'y');
      expect(moves(q.x, p.x, xs) && moves(q.y, p.y, ys), 'ac bend moved by a cut').toBe(true);
    }
  });
});
