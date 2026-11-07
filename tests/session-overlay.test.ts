import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Imported with the file, not inside a test: loading the session's modules can take seconds
// while the whole suite transforms at once, and a test's timeout should not pay for it.
import { createDiagramSession } from '../src/state/session';
import type { GeometryCause } from '../src/state/session';
import { overlaps } from '../src/model/geometry';
import type { Rect } from '../src/model/types';

// Two boxes in a group, one outside it, a labelled connection and a note, pinned so the test
// knows where they are.
const SOURCE = `diagram "Overlay" version=1
group g "Group"
node a "Alpha" in=g
node b "Beta" in=g
node c "Gamma"
edge go a -> c "goes to"
note n1 "A note about beta" near=b
pin a x=0 y=0
pin b x=0 y=200
pin c x=600 y=0
`;

let frames: Array<(t: number) => void> = [];
let clock = 0;
/** Run the next animation frame, `ms` after the last. */
function step(ms = 16) {
  clock += ms;
  const run = frames;
  frames = [];
  for (const f of run) f(clock);
}

beforeAll(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('window', { setTimeout, clearTimeout, open: vi.fn() });
  vi.stubGlobal('document', { title: '', hidden: false, elementFromPoint: () => null });
  vi.stubGlobal('HTMLInputElement', class {});
  vi.stubGlobal('requestAnimationFrame', (f: (t: number) => void) => frames.push(f));
  vi.stubGlobal('performance', { now: () => clock });
});
afterAll(() => vi.unstubAllGlobals());

const STAGE = { width: 800, height: 600 };

async function open(source = SOURCE) {
  const s = createDiagramSession();
  await s.openSource(source);
  for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  s.setStageSize(STAGE);
  return s;
}

const screenOf = (r: Rect, c: { x: number; y: number; k: number }): Rect => ({
  x: r.x * c.k + c.x,
  y: r.y * c.k + c.y,
  w: r.w * c.k,
  h: r.h * c.k,
});

describe('the positioner', () => {
  it('gives each object where the compile put it, in the drawing and on the canvas', async () => {
    const s = await open();
    const scene = s.fileScene()!;
    for (const id of ['a', 'b', 'c']) {
      const o = scene.byId.get(id)!;
      expect(s.rectOf(id)).toEqual({ x: o.x, y: o.y, w: o.w, h: o.h });
    }
    s.moveCamera({ x: 40, y: -30, k: 0.5 });
    for (const id of ['a', 'b', 'c', 'g']) {
      expect(s.rectOf(id, 'screen')).toEqual(screenOf(s.rectOf(id)!, s.camera()));
    }
    // The group holds its members.
    const g = s.rectOf('g')!;
    for (const id of ['a', 'b']) {
      const r = s.rectOf(id)!;
      expect(r.x >= g.x && r.y >= g.y && r.x + r.w <= g.x + g.w && r.y + r.h <= g.y + g.h).toBe(
        true,
      );
    }
  });

  it('gives a connection its route and label box, and a note its panel', async () => {
    const s = await open();
    const edge = s.edgeOf('go')!;
    const drawn = s.routesById().get('go')!;
    expect(edge.route).toEqual(drawn.points.map(p => ({ x: p.x, y: p.y })));
    const l = drawn.label!;
    expect(edge.label).toEqual({ x: l.x - l.w / 2, y: l.y - l.h / 2, w: l.w, h: l.h });
    // The rect holds the route and the label.
    for (const p of edge.route) {
      expect(p.x >= edge.rect.x - 0.001 && p.x <= edge.rect.x + edge.rect.w + 0.001).toBe(true);
    }
    expect(s.rectOf('go')).toEqual(edge.rect);
    s.moveCamera({ x: 10, y: 20, k: 2 });
    const onScreen = s.edgeOf('go', 'screen')!;
    expect(onScreen.route[0]).toEqual({ x: edge.route[0].x * 2 + 10, y: edge.route[0].y * 2 + 20 });
    expect(onScreen.label).toEqual(screenOf(edge.label!, s.camera()));
    const note = s.viewerFrame().notes.find(n => n.note.id === 'n1')!;
    expect(s.rectOf('n1')).toEqual(note.rect);
    expect(s.rectOf('nothing')).toBeUndefined();
  });
});

describe('the clear-space search', () => {
  it('keeps out of what notes keep out of, and agrees with where the note went', async () => {
    const s = await open();
    const b = s.rectOf('b')!,
      note = s.rectOf('n1')!;
    // On a shape, on the note, and across the group's border: kept out.
    expect(s.keepOut({ ...b, w: 20, h: 20 })).toBe(true);
    expect(s.keepOut({ x: note.x + 2, y: note.y + 2, w: 10, h: 10 })).toBe(true);
    const g = s.rectOf('g')!;
    expect(s.keepOut({ x: g.x - 10, y: g.y + 60, w: 20, h: 4 })).toBe(true);
    // Far away: clear. And what is ignored is not in the way.
    expect(s.keepOut({ x: 2000, y: 2000, w: 50, h: 50 })).toBe(false);
    expect(s.keepOut({ ...b, w: 20, h: 20 }, { ignore: ['b', 'g'] })).toBe(false);
    // A note's own size beside its anchor finds exactly the note's spot, but the note is there now,
    // so the first spot clear of it is somewhere else, and clear.
    const spot = s.clearSpot('b', { w: note.w, h: note.h }, { sides: ['below'] });
    if (spot) {
      expect(overlaps(spot, note, 8)).toBe(false);
      expect(s.keepOut(spot)).toBe(false);
    }
    const ignoringNote = s.clearSpot(
      'b',
      { w: note.w, h: note.h },
      {
        sides: ['below'],
        ignore: ['n1'],
      },
    );
    expect(ignoringNote).toEqual(note);
  });

  it('finds a spot in canvas pixels that keeps its size whatever the zoom', async () => {
    const s = await open();
    s.moveCamera({ x: 100, y: 50, k: 0.5 });
    const size = { w: 120, h: 40 };
    const spot = s.clearSpot('c', size, { space: 'screen' })!;
    expect(spot.w).toBeCloseTo(120);
    expect(spot.h).toBeCloseTo(40);
    expect(s.keepOut(spot, { space: 'screen' })).toBe(false);
    expect(overlaps(spot, s.rectOf('c', 'screen')!)).toBe(false);
    // Avoiding a rectangle where the first spot was finds another.
    const other = s.clearSpot('c', size, { space: 'screen', avoid: [spot] })!;
    expect(overlaps(other, spot)).toBe(false);
  });
});

describe('the geometry notice', () => {
  it('fires for a camera move and a new layout, and stops when asked', async () => {
    const s = await open();
    const heard: GeometryCause[] = [];
    const stop = s.onGeometry(change => heard.push(change.cause));
    s.moveCamera({ x: 5, y: 5, k: 1 });
    s.setStageSize({ width: 900, height: 600 });
    await s.receiveSource(SOURCE.replace('pin c x=600 y=0', 'pin c x=700 y=0'));
    for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
    expect(heard).toContain('camera');
    expect(heard).toContain('layout');
    expect(s.rectOf('c')!.x).toBe(700);
    const count = heard.length;
    stop();
    s.moveCamera({ x: 50, y: 5, k: 1 });
    expect(heard.length).toBe(count);
  });

  it('fires on every frame of a glide, and every read follows the frame on screen', async () => {
    const s = await open();
    const from = new Map(['a', 'b', 'c', 'g', 'go'].map(id => [id, s.rectOf(id)!]));
    // A host arrangement: everything 120 right and 80 down, routes with it.
    const dx = 120,
      dy = 80;
    const nodes = Object.fromEntries(
      ['a', 'b', 'c'].map(id => {
        const r = from.get(id)!;
        return [id, { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }];
      }),
    );
    const result = structuredClone(s.routing().result);
    for (const r of result.routes) {
      r.points = r.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }));
    }
    const heard: Array<{ cause: GeometryCause; a: Rect; edge: Rect; screen: Rect }> = [];
    s.onGeometry(change =>
      heard.push({
        cause: change.cause,
        a: s.rectOf('a')!,
        edge: s.rectOf('go')!,
        screen: s.rectOf('a', 'screen')!,
      }),
    );
    const { settled } = await s.receiveArranged(SOURCE, { nodes, routes: result });
    for (let i = 0; i < 40 && frames.length; i++) step();
    await settled;
    const motion = heard.filter(h => h.cause === 'motion');
    // 200 ms at 16 ms a frame: a dozen frames, each heard.
    expect(motion.length).toBeGreaterThanOrEqual(10);
    const a0 = from.get('a')!;
    for (const h of motion) {
      // Between where it was and where it is going, and on screen exactly where it is drawn.
      expect(h.a.x).toBeGreaterThanOrEqual(a0.x - 0.001);
      expect(h.a.x).toBeLessThanOrEqual(a0.x + dx + 0.001);
      expect(h.screen).toEqual(screenOf(h.a, s.camera()));
    }
    const mid = motion[Math.floor(motion.length / 2)];
    expect(mid.a.x).toBeGreaterThan(a0.x);
    expect(mid.a.x).toBeLessThan(a0.x + dx);
    // A route glides with its shapes: the edge's box moves as the box does.
    const e0 = from.get('go')!;
    expect(mid.edge.x).toBeGreaterThan(e0.x);
    expect(mid.edge.x).toBeLessThan(e0.x + dx);
    expect(mid.edge.y - e0.y).toBeCloseTo(mid.a.y - a0.y, 3);
    // At rest, where the arrangement put it.
    expect(s.rectOf('a')).toEqual({ ...a0, x: a0.x + dx, y: a0.y + dy });
    expect(heard.at(-1)!.cause).not.toBe('motion');
  });

  it('anchors a line a bundle carries, and the bundle itself, to the trunk the canvas draws', async () => {
    const s = await open(
      [
        'diagram "Crawl" version=1',
        'node crawler "Crawler"',
        'node offsite "Offsite"',
        'edge a crawler -> offsite "warm fetch"',
        'edge b crawler -> offsite "purge"',
        'edge c offsite -> crawler "origin pull"',
        'routing bundle=3',
      ].join('\n'),
    );
    const [bundle] = s.bundles();
    expect(bundle).toBeDefined();
    expect(bundle!.members.sort()).toEqual(['a', 'b', 'c']);
    const trunk = s.edgeOf(bundle!.id)!;
    expect(trunk.bundle).toBe(bundle!.id);
    expect(trunk.route).toEqual(bundle!.points);
    for (const id of bundle!.members) {
      const line = s.edgeOf(id)!;
      expect(line.bundle).toBe(bundle!.id);
      expect(line.route).toEqual(trunk.route);
      expect(s.rectOf(id)).toEqual(trunk.rect);
    }
    // On the canvas as on the drawing.
    s.moveCamera({ x: 12, y: 34, k: 2 });
    expect(s.rectOf('a', 'screen')).toEqual(screenOf(trunk.rect, s.camera()));
  });
});
