import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Imported with the file, not inside a test: loading the session's modules can take seconds
// while the whole suite transforms at once, and a test's timeout should not pay for it.
import { createDiagramSession, type CameraEvent } from '../src/state/session';
import type { Rect } from '../src/model/types';
import { FIT_MARGIN, REVEAL_MARGIN } from '../src/state/session/camera';

// Three boxes far apart, pinned so the test knows where they are.
const SOURCE = `diagram "Camera" version=1
node a "Alpha"
node b "Beta"
node c "Gamma"
edge go a -> b "go"
pin a x=0 y=0
pin b x=400 y=0
pin c x=3000 y=2000
size c width=400 height=200
`;

beforeAll(() => {
  // A session reads the page's motion preference and timers; these tests run without a DOM.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('window', { setTimeout, clearTimeout, open: vi.fn() });
  vi.stubGlobal(
    'DOMRect',
    class {
      constructor(
        public x = 0,
        public y = 0,
        public width = 1,
        public height = 1,
      ) {}
      get left() {
        return this.x;
      }
      get top() {
        return this.y;
      }
    },
  );
  vi.stubGlobal('document', { title: '', elementFromPoint: () => null });
  vi.stubGlobal('HTMLInputElement', class {});
});
afterAll(() => vi.unstubAllGlobals());

const STAGE = { width: 800, height: 600 };

async function open(moves: CameraEvent[] = [], sized = true) {
  const s = createDiagramSession({ onCamera: event => moves.push(event) });
  await s.openSource(SOURCE);
  for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  if (sized) s.setStageSize(STAGE);
  return s;
}

type Session = Awaited<ReturnType<typeof open>>;

/** Where a box is drawn on the canvas, in screen pixels. */
function onScreen(s: Session, id: string): Rect {
  const r = s.sceneRects().get(id)!,
    c = s.getCamera();
  return { x: r.x * c.k + c.x, y: r.y * c.k + c.y, w: r.w * c.k, h: r.h * c.k };
}

const within = (r: Rect, margin = 0) =>
  r.x >= margin &&
  r.y >= margin &&
  r.x + r.w <= STAGE.width - margin &&
  r.y + r.h <= STAGE.height - margin;

describe('the camera on a session', () => {
  it('reads and sets the camera, and reports the host as api', async () => {
    const moves: CameraEvent[] = [];
    const s = await open(moves);
    moves.length = 0;
    s.setCamera({ x: 10, y: 20, k: 0.5 });
    expect(s.getCamera()).toEqual({ x: 10, y: 20, k: 0.5 });
    expect(moves).toEqual([{ camera: { x: 10, y: 20, k: 0.5 }, reason: 'api' }]);
    // The same camera again is no move, and nothing is reported.
    s.setCamera({ x: 10, y: 20, k: 0.5 });
    expect(moves).toHaveLength(1);
  });

  it("reports the editor's own moves as user", async () => {
    const moves: CameraEvent[] = [];
    const s = await open(moves);
    s.setCamera({ x: 10, y: 20, k: 0.5 });
    moves.length = 0;
    s.panBy(5, 0);
    s.zoomAt(2);
    s.fitView();
    expect(moves.map(m => m.reason)).toEqual(['user', 'user', 'user']);
    expect(moves[0].camera).toEqual({ x: 15, y: 20, k: 0.5 });
    expect(moves.at(-1)!.camera).toEqual(s.getCamera());
  });

  it('reports a camera that undo brings back as user', async () => {
    // A session with no source keeps its own history, and undo restores the view with it.
    const moves: CameraEvent[] = [];
    const s = createDiagramSession({ onCamera: event => moves.push(event) });
    s.setStageSize(STAGE);
    s.setCamera({ x: 10, y: 20, k: 0.5 });
    s.transact('Collapse', d => void d.collapsed.push('a'));
    s.setCamera({ x: 300, y: 200, k: 2 });
    moves.length = 0;
    s.undo();
    expect(s.getCamera()).toEqual({ x: 10, y: 20, k: 0.5 });
    expect(moves).toEqual([{ camera: { x: 10, y: 20, k: 0.5 }, reason: 'user' }]);
  });

  it('fitTo frames the ids it is given, centred, within the margin', async () => {
    const s = await open();
    expect(s.fitTo(['a', 'b', 'nowhere'], { margin: 40 })).toBe(true);
    const [a, b] = [onScreen(s, 'a'), onScreen(s, 'b')];
    expect(within(a, 40) && within(b, 40)).toBe(true);
    // Centred: as much room left of a as right of b.
    expect(a.x).toBeCloseTo(STAGE.width - (b.x + b.w), 5);
    // Gamma, far away, is not in the frame.
    expect(within(onScreen(s, 'c'))).toBe(false);
    expect(s.fitTo(['nowhere'])).toBe(false);
  });

  it('fitTo before the canvas has a size waits for it', async () => {
    const moves: CameraEvent[] = [];
    const s = await open(moves, false);
    moves.length = 0;
    expect(s.fitTo(['c'])).toBe(false);
    expect(moves).toEqual([]);
    s.setStageSize(STAGE);
    await Promise.resolve();
    expect(within(onScreen(s, 'c'), FIT_MARGIN)).toBe(true);
    expect(moves.at(-1)?.reason).toBe('api');
  });

  it('reveal of an object already in view moves nothing', async () => {
    const moves: CameraEvent[] = [];
    const s = await open(moves);
    s.fitTo(['a', 'b']);
    const before = s.getCamera();
    moves.length = 0;
    expect(s.reveal('a')).toBe(false);
    expect(s.getCamera()).toEqual(before);
    expect(moves).toEqual([]);
  });

  it('reveal of an object off the canvas pans the least, without zooming', async () => {
    const s = await open();
    s.setCamera({ x: 100, y: 100, k: 1 });
    expect(within(onScreen(s, 'c'))).toBe(false);
    expect(s.reveal('c')).toBe(true);
    const c = onScreen(s, 'c');
    expect(s.getCamera().k).toBe(1);
    // The least pan leaves Gamma at the margin on the sides it came in from.
    expect(within(c, REVEAL_MARGIN)).toBe(true);
    expect(c.x + c.w).toBeCloseTo(STAGE.width - REVEAL_MARGIN, 5);
    expect(c.y + c.h).toBeCloseTo(STAGE.height - REVEAL_MARGIN, 5);
  });

  it('reveal zooms out only as far as it must when the object does not fit', async () => {
    const s = await open();
    s.setCamera({ x: 0, y: 0, k: 4 });
    s.reveal('c', { margin: 40, minZoom: 0.55 });
    const k = s.getCamera().k,
      r = s.sceneRects().get('c')!;
    expect(k).toBeLessThan(4);
    // Just enough for Gamma and its margins across the narrower way.
    expect(k).toBeCloseTo(Math.min((STAGE.width - 80) / r.w, (STAGE.height - 80) / r.h), 5);
    expect(within(onScreen(s, 'c'), 40 - 1e-6)).toBe(true);
  });

  it('reveal never zooms below its floor; an object too big for it is centred', async () => {
    const s = await open();
    s.setStageSize({ width: 300, height: 200 });
    s.setCamera({ x: 0, y: 0, k: 1 });
    expect(s.reveal('c', { minZoom: 0.8 })).toBe(true);
    const r = s.sceneRects().get('c')!,
      c = s.getCamera();
    expect(c.k).toBe(0.8);
    expect((r.x + r.w / 2) * c.k + c.x).toBeCloseTo(150, 5);
    expect((r.y + r.h / 2) * c.k + c.y).toBeCloseTo(100, 5);
  });
});
