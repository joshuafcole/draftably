import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Imported with the file, not inside a test: loading the session's modules can take seconds
// while the whole suite transforms at once, and a test's timeout should not pay for it.
import { createDiagramSession, type CameraMover } from '../src/state/session';
import type { Camera, Rect } from '../src/model/types';

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

async function open(moves: Array<[Camera, CameraMover]> = [], sized = true, source = SOURCE) {
  const s = createDiagramSession({ onCamera: (camera, by) => moves.push([camera, by]) });
  await s.openSource(source);
  for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  if (sized) s.setStageSize(STAGE);
  return s;
}

type Session = Awaited<ReturnType<typeof open>>;

/** Where a box is drawn on the canvas, in screen pixels. */
function onScreen(s: Session, id: string): Rect {
  const r = s.sceneRects().get(id)!,
    c = s.camera();
  return { x: r.x * c.k + c.x, y: r.y * c.k + c.y, w: r.w * c.k, h: r.h * c.k };
}

const within = (r: Rect, margin = 0) =>
  r.x >= margin &&
  r.y >= margin &&
  r.x + r.w <= STAGE.width - margin &&
  r.y + r.h <= STAGE.height - margin;

describe('the camera on a session', () => {
  it('reads and sets the camera, and reports the host as the mover', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves);
    moves.length = 0;
    expect(s.moveCamera({ x: 10, y: 20, k: 0.5 })).toBe(true);
    expect(s.camera()).toEqual({ x: 10, y: 20, k: 0.5 });
    expect(moves).toEqual([[{ x: 10, y: 20, k: 0.5 }, 'host']]);
    // The same camera again is no move, and nothing is reported.
    expect(s.moveCamera({ x: 10, y: 20, k: 0.5 })).toBe(false);
    s.panBy(5, 0);
    expect(moves.at(-1)).toEqual([{ x: 15, y: 20, k: 0.5 }, 'user']);
  });

  it('fitTo frames the ids it is given, centred, within the margin', async () => {
    const s = await open();
    expect(s.fitTo(['a', 'b', 'nowhere'], 40)).toBe(true);
    const [a, b] = [onScreen(s, 'a'), onScreen(s, 'b')];
    expect(within(a, 40) && within(b, 40)).toBe(true);
    // Centred: as much room left of a as right of b.
    expect(a.x).toBeCloseTo(STAGE.width - (b.x + b.w), 5);
    // Gamma, far away, is not in the frame.
    expect(within(onScreen(s, 'c'))).toBe(false);
    expect(s.fitTo(['nowhere'])).toBe(false);
  });

  it('fitTo before the canvas has a size waits for it', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves, false);
    moves.length = 0;
    expect(s.fitTo(['c'])).toBe(false);
    expect(moves).toEqual([]);
    s.setStageSize(STAGE);
    await Promise.resolve();
    expect(within(onScreen(s, 'c'), 40)).toBe(true);
    expect(moves.at(-1)?.[1]).toBe('host');
  });

  it('reveal of an object already in view moves nothing', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves);
    s.fitTo(['a', 'b']);
    const before = s.camera();
    moves.length = 0;
    expect(s.reveal('a')).toBe(false);
    expect(s.camera()).toEqual(before);
    expect(moves).toEqual([]);
  });

  it('reveal of an object off the canvas pans the least, without zooming', async () => {
    const s = await open();
    s.moveCamera({ x: 100, y: 100, k: 1 });
    expect(within(onScreen(s, 'c'))).toBe(false);
    expect(s.reveal('c')).toBe(true);
    const c = onScreen(s, 'c');
    expect(s.camera().k).toBe(1);
    // The least pan leaves Gamma at the margin on the sides it came in from.
    expect(within(c, 40)).toBe(true);
    expect(c.x + c.w).toBeCloseTo(STAGE.width - 40, 5);
    expect(c.y + c.h).toBeCloseTo(STAGE.height - 40, 5);
  });

  it('reveal and fitTo find a note by its ID', async () => {
    const s = await open([], true, SOURCE + 'note far "Far away." near=c\n');
    s.moveCamera({ x: 100, y: 100, k: 1 });
    expect(s.reveal('far')).toBe(true);
    const r = s.viewerFrame().notes[0].rect,
      c = s.camera();
    expect(within({ x: r.x * c.k + c.x, y: r.y * c.k + c.y, w: r.w * c.k, h: r.h * c.k }, 40)).toBe(
      true,
    );
    expect(s.camera().k).toBe(1);
  });

  it('reveal zooms out only as far as it must when the object does not fit', async () => {
    const s = await open();
    s.moveCamera({ x: 0, y: 0, k: 4 });
    s.reveal('c', { margin: 40, minZoom: 0.55 });
    const k = s.camera().k,
      r = s.sceneRects().get('c')!;
    expect(k).toBeLessThan(4);
    // Just enough for Gamma and its margins across the narrower way.
    expect(k).toBeCloseTo(Math.min((STAGE.width - 80) / r.w, (STAGE.height - 80) / r.h), 5);
    expect(within(onScreen(s, 'c'), 40 - 1e-6)).toBe(true);
  });

  it('reveal never zooms below its floor; an object too big for it is centred', async () => {
    const s = await open();
    s.setStageSize({ width: 300, height: 200 });
    s.moveCamera({ x: 0, y: 0, k: 1 });
    expect(s.reveal('c', { minZoom: 0.8 })).toBe(true);
    const r = s.sceneRects().get('c')!,
      c = s.camera();
    expect(c.k).toBe(0.8);
    expect((r.x + r.w / 2) * c.k + c.x).toBeCloseTo(150, 5);
    expect((r.y + r.h / 2) * c.k + c.y).toBeCloseTo(100, 5);
  });
});

/** A pointer event on the background of the canvas (a mouse, or a finger by `id`). */
function pointer(x: number, y: number, extra: Record<string, unknown> = {}) {
  return {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    button: 0,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    currentTarget: {
      setPointerCapture() {},
      releasePointerCapture() {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    },
    target: { closest: () => null, getRootNode: () => ({ activeElement: null }) },
    ...extra,
  } as unknown as PointerEvent;
}

describe('who the camera reports as the mover', () => {
  it('a drag pan reports the user on every pointer move, like the wheel does', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves);
    s.moveCamera({ x: 100, y: 100, k: 1 });
    moves.length = 0;
    s.onPointerDown(pointer(300, 300));
    for (let i = 1; i <= 4; i++) s.onPointerMove(pointer(300 + i * 10, 300 + i * 5));
    s.onPointerUp(pointer(340, 320));
    expect(moves.map(([, by]) => by)).toEqual(['user', 'user', 'user', 'user']);
    expect(moves.at(-1)?.[0]).toEqual({ x: 140, y: 120, k: 1 });
    expect(s.camera()).toEqual({ x: 140, y: 120, k: 1 });
    // The wheel reports once per event, the same way.
    moves.length = 0;
    s.onWheel({
      ...pointer(400, 300),
      deltaY: -100,
      deltaX: 0,
      deltaMode: 0,
    } as unknown as WheelEvent);
    expect(moves.map(([, by]) => by)).toEqual(['user']);
    s.dispose();
  });

  it('a drag zoom (Ctrl on a read-only canvas) reports the user', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves);
    s.setReadOnly(true);
    moves.length = 0;
    s.onPointerDown(pointer(300, 300, { ctrlKey: true }));
    s.onPointerMove(pointer(300, 260, { ctrlKey: true }));
    s.onPointerUp(pointer(300, 260));
    expect(moves.map(([, by]) => by)).toEqual(['user']);
    expect(moves[0][0].k).toBeGreaterThan(1);
    s.dispose();
  });

  it('a pinch reports the user on every move', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves);
    const finger = (id: number, x: number, y: number) =>
      pointer(x, y, { pointerId: id, pointerType: 'touch' });
    s.onPointerDown(finger(1, 300, 300));
    s.onPointerDown(finger(2, 400, 300));
    moves.length = 0;
    s.onPointerMove(finger(2, 500, 300));
    s.onPointerMove(finger(2, 600, 300));
    expect(moves.map(([, by]) => by)).toEqual(['user', 'user']);
    expect(moves[1][0].k).toBeGreaterThan(moves[0][0].k);
    s.dispose();
  });

  it('a cancelled drag pan puts the camera back and says the user did', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open(moves);
    s.moveCamera({ x: 100, y: 100, k: 1 });
    s.onPointerDown(pointer(300, 300));
    s.onPointerMove(pointer(380, 330));
    expect(s.camera()).toEqual({ x: 180, y: 130, k: 1 });
    moves.length = 0;
    s.cancelGesture();
    expect(s.camera()).toEqual({ x: 100, y: 100, k: 1 });
    expect(moves).toEqual([[{ x: 100, y: 100, k: 1 }, 'user']]);
    s.dispose();
  });

  it("a reader's drag cancels a host glide, as a wheel turn does", async () => {
    // A host glide as a host writes one: step the camera with moveCamera until it arrives, and
    // stop the moment anything but the host moves the camera.
    const glide = async (interrupt: (s: Session) => void) => {
      let cancelled = false;
      const s = await open([], true);
      const heard = createDiagramSession({
        onCamera: (_, by) => {
          if (by !== 'host') cancelled = true;
        },
      });
      await heard.openSource(SOURCE);
      for (let i = 0; i < 40 && heard.fileCompiling(); i++)
        await new Promise(r => setTimeout(r, 0));
      heard.setStageSize(STAGE);
      const from = heard.camera();
      for (let i = 1; i <= 10 && !cancelled; i++) {
        heard.moveCamera({ ...from, x: from.x - i * 20 });
        if (i === 3) interrupt(heard as unknown as Session);
      }
      const reached = from.x - heard.camera().x;
      heard.dispose();
      s.dispose();
      return { cancelled, reached };
    };
    const drag = await glide(s => {
      s.onPointerDown(pointer(300, 300));
      s.onPointerMove(pointer(310, 300));
    });
    const wheel = await glide(s =>
      s.onWheel({
        ...pointer(400, 300),
        deltaY: -100,
        deltaX: 0,
        deltaMode: 0,
      } as unknown as WheelEvent),
    );
    // Both stop the glide at its third step; neither lets it run its ten.
    expect(drag.cancelled).toBe(true);
    expect(wheel.cancelled).toBe(true);
    expect(drag.reached).toBeLessThan(200);
    expect(wheel.reached).toBeLessThan(200);
  });

  it("the editor's own fits report 'fit', and the host and the reader keep their names", async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = await open([], false);
    const sized = createDiagramSession({ onCamera: (camera, by) => moves.push([camera, by]) });
    await sized.openSource(SOURCE);
    for (let i = 0; i < 40 && sized.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
    // The first fit waits for the canvas to have a size, then reports itself.
    sized.fitView();
    expect(moves).toEqual([]);
    sized.setStageSize(STAGE);
    expect(moves.map(([, by]) => by)).toEqual(['fit']);
    // The Fit command is the reader's.
    sized.moveCamera({ x: 0, y: 0, k: 0.5 });
    sized.fitView('user');
    expect(moves.map(([, by]) => by)).toEqual(['fit', 'host', 'user']);
    sized.moveCamera({ x: 3, y: 4, k: 0.5 });
    sized.fitView();
    sized.panBy(7, 0);
    expect(moves.map(([, by]) => by)).toEqual(['fit', 'host', 'user', 'host', 'fit', 'user']);
    // A host move is still the host's.
    sized.moveCamera({ x: 1, y: 2, k: 0.7 });
    sized.fitTo(['a']);
    expect(moves.slice(-2).map(([, by]) => by)).toEqual(['host', 'host']);
    sized.dispose();
    s.dispose();
  });

  it('undo that brings the camera back with the diagram is reported as the user', async () => {
    const moves: Array<[Camera, CameraMover]> = [];
    const s = createDiagramSession({ onCamera: (camera, by) => moves.push([camera, by]) });
    s.setStageSize(STAGE);
    s.moveCamera({ x: 5, y: 5, k: 1 });
    s.transact('Add', d => {
      d.graph.nodes.push({ id: 'n', title: 'N' } as never);
    });
    s.moveCamera({ x: 90, y: 90, k: 1 });
    moves.length = 0;
    s.undo();
    expect(s.camera()).toEqual({ x: 5, y: 5, k: 1 });
    expect(moves).toEqual([[{ x: 5, y: 5, k: 1 }, 'user']]);
    s.dispose();
  });
});
