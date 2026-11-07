import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Imported with the file, not inside a test: loading the session's modules can take seconds
// while the whole suite transforms at once, and a test's timeout should not pay for it.
import {
  createDiagramSession,
  type NewIdRequest,
  type SessionEdit,
  type SessionOptions,
} from '../src/state/session';

const SOURCE = `diagram "Edits" version=1
node a "Alpha"
node b "Beta"
node c "Gamma"
edge go a -> b "go"
note "Look here" near=c
`;

beforeAll(() => {
  // A session reads the page's motion preference and timers; these tests run without a DOM.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('window', {
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    open: vi.fn(),
  });
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
  vi.stubGlobal('document', { title: '', activeElement: null, elementFromPoint: () => null });
  vi.stubGlobal('HTMLInputElement', class {});
});
afterAll(() => vi.unstubAllGlobals());

/** What the host heard: every kept edit and every refusal. */
interface Heard {
  edits: SessionEdit[];
  refused: string[];
  undo: number;
  redo: number;
}

async function open(options: SessionOptions = {}, source = SOURCE) {
  const heard: Heard = { edits: [], refused: [], undo: 0, redo: 0 };
  let n = 0;
  const s = createDiagramSession({
    onEdit: edit => heard.edits.push(edit),
    onRefused: message => heard.refused.push(message),
    history: {
      undo: () => void heard.undo++,
      redo: () => void heard.redo++,
      canUndo: () => true,
      canRedo: () => true,
    },
    newId: ({ kind, taken }: NewIdRequest) => {
      let id: string;
      do id = `${kind}-${++n}`;
      while (taken(id));
      return id;
    },
    ...options,
  });
  await s.openSource(source);
  await settled(s);
  s.setStageSize({ width: 1200, height: 900 });
  // Screen pixels are world units, so a gesture can be written in the drawing's coordinates.
  s.moveCamera({ x: 0, y: 0, k: 1 });
  return { s, heard };
}

type Session = Awaited<ReturnType<typeof open>>['s'];

async function settled(s: Session) {
  for (let i = 0; i < 400 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
}

/** A stand-in element: `closest(selector)` finds the data each selector names. */
const element = (data: Record<string, Record<string, string>> = {}) => ({
  closest: (selector: string) => (data[selector] ? { dataset: data[selector] } : null),
});
const node = (id: string, extra: Record<string, Record<string, string>> = {}) =>
  element({
    '[data-kind]': { id, kind: 'node' },
    '[data-kind="node"]': { id, kind: 'node' },
    ...extra,
  });
const background = () => element({ '.canvas': {} });
const canvas = { setPointerCapture() {}, getBoundingClientRect: () => new DOMRect(0, 0, 1, 1) };

const pointer = (
  x: number,
  y: number,
  target: object = background(),
  keys: Partial<Record<'shiftKey' | 'altKey' | 'metaKey' | 'ctrlKey', boolean>> = {},
) =>
  ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    ...keys,
    target,
    currentTarget: canvas,
    preventDefault() {},
  }) as unknown as PointerEvent;

/** Press at `from`, move to `to` in a few steps, and let go there. */
function drag(
  s: Session,
  from: [number, number],
  to: [number, number],
  target: object,
  keys: Parameters<typeof pointer>[3] = {},
  releaseOver: object = target,
) {
  s.onPointerDown(pointer(...from, target, keys));
  for (let i = 1; i <= 4; i++)
    s.onPointerMove(
      pointer(
        from[0] + ((to[0] - from[0]) * i) / 4,
        from[1] + ((to[1] - from[1]) * i) / 4,
        target,
        keys,
      ),
    );
  s.onPointerUp(pointer(...to, releaseOver, keys));
}

const middle = (s: Session, id: string): [number, number] => {
  const r = s.sceneRects().get(id)!;
  return [r.x + r.w / 2, r.y + r.h / 2];
};

/** The one edit the gesture made, once its source is drawn. */
async function oneEdit(s: Session, heard: Heard, gesture: () => void | Promise<void>) {
  const edits = heard.edits.length,
    refused = heard.refused.length;
  await gesture();
  await settled(s);
  expect(heard.refused.slice(refused)).toEqual([]);
  expect(heard.edits.length - edits).toBe(1);
  const edit = heard.edits.at(-1)!;
  // The session draws what the host was told.
  expect(s.currentSource()).toBe(edit.source);
  return edit;
}

const kinds = (edit: SessionEdit) =>
  edit.operations.map(o => `${o.kind} ${o.statement} ${o.id}`).sort();

describe('every gesture that edits reaches the host', () => {
  it('a drag of a box keeps it where it was dropped, as a stay, and anchors its neighbours', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const [x, y] = middle(s, 'c');
    const edit = await oneEdit(s, heard, () => drag(s, [x, y], [x + 140, y + 60], node('c')));
    expect(edit.label).toBe('Move objects');
    const placed = edit.operations.filter(o => o.id === 'c');
    expect(placed.map(o => `${o.kind} ${o.statement}`)).toEqual(['add stay']);
    expect(edit.operations.some(o => o.statement === 'near' || o.statement === 'pin')).toBe(false);
    // The anchors are stays on the others, each at its drawn place.
    const anchors = edit.operations.filter(o => o.id !== 'c');
    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.every(o => o.kind === 'add' && o.statement === 'stay')).toBe(true);
    expect(edit.amends).toBe(false);
  });

  it('a drag keeps its default, a near, when the host does not ask for stay', async () => {
    const { s, heard } = await open();
    const [x, y] = middle(s, 'c'),
      b = s.sceneRects().get('b')!;
    const edit = await oneEdit(s, heard, () =>
      drag(s, [x, y], [b.x + b.w + 120, b.y + b.h / 2], node('c')),
    );
    expect(edit.operations.some(o => o.id === 'c' && o.statement === 'near')).toBe(true);
  });

  it('a resize writes a size', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const r = s.sceneRects().get('a')!;
    // A resize handle is drawn on a selected box.
    s.setSelection(['a']);
    const handle = node('a', { '[data-resize]': { resize: 'se' } });
    const edit = await oneEdit(s, heard, () =>
      drag(s, [r.x + r.w, r.y + r.h], [r.x + r.w + 80, r.y + r.h + 30], handle),
    );
    expect(kinds(edit)).toContain('add size a');
  });

  it('drawing a box adds a node with the id the host gave it', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    s.setTool('box');
    const edit = await oneEdit(s, heard, () => drag(s, [900, 700], [1040, 760], background()));
    const added = edit.operations.filter(o => o.kind === 'add' && o.statement === 'node');
    expect(added).toEqual([
      expect.objectContaining({
        id: 'node-1',
        fields: expect.objectContaining({ label: 'New box' }),
      }),
    ]);
    expect(Object.values(edit.ids)).toContain('node-1');
  });

  it('drawing a container adds a group', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    s.setTool('container');
    const edit = await oneEdit(s, heard, () => drag(s, [900, 500], [1150, 800], background()));
    expect(edit.operations.filter(o => o.kind === 'add' && o.statement === 'group')).toHaveLength(
      1,
    );
  });

  it('dragging from a port to a box connects them, with the host id', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const port = node('b', { '[data-port]': { port: 'right' } });
    const edit = await oneEdit(s, heard, () => {
      vi.stubGlobal('document', {
        title: '',
        activeElement: null,
        elementFromPoint: () => node('c'),
      });
      drag(s, middle(s, 'b'), middle(s, 'c'), port, {}, node('c'));
    });
    vi.stubGlobal('document', { title: '', activeElement: null, elementFromPoint: () => null });
    expect(edit.operations.filter(o => o.statement === 'edge')).toEqual([
      expect.objectContaining({
        kind: 'add',
        id: 'edge-1',
        fields: expect.objectContaining({ from: 'b', to: 'c' }),
      }),
    ]);
  });

  it('a quick-add handle adds a connected box', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const handle = element({ '[data-quick-add]': { quickAdd: 'right', owner: 'b' } });
    const edit = await oneEdit(s, heard, () => s.onPointerDown(pointer(10, 10, handle)));
    expect(kinds(edit)).toEqual(expect.arrayContaining(['add edge edge-2', 'add node node-1']));
  });

  it('renaming in place sets the label and keeps the id', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    s.startInlineEdit('a');
    s.setInlineDraft('Alpha prime');
    const edit = await oneEdit(s, heard, () => s.finishInlineEdit(true));
    expect(edit.operations).toEqual([
      expect.objectContaining({
        kind: 'set',
        statement: 'node',
        id: 'a',
        fields: expect.objectContaining({ label: 'Alpha prime' }),
        was: expect.objectContaining({ label: 'Alpha' }),
      }),
    ]);
  });

  it('a double click on a box starts its rename, and on the background adds a box', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    s.onDoubleClick(pointer(...middle(s, 'a'), node('a')) as unknown as MouseEvent);
    expect(s.inlineEditId()).toBe('a');
    s.finishInlineEdit(false);
    const edit = await oneEdit(s, heard, () =>
      s.onDoubleClick(pointer(1000, 800, background()) as unknown as MouseEvent),
    );
    expect(kinds(edit)).toContain('add node node-1');
  });

  it('a dragged note moves beside another object', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const note = s.viewerFrame().notes[0]!.rect,
      a = s.sceneRects().get('a')!,
      text = element({ '[data-text]': { text: '@note:0' } });
    const edit = await oneEdit(s, heard, () =>
      drag(s, [note.x + 4, note.y + 4], [a.x + a.w + 20, a.y + a.h / 2], text),
    );
    expect(edit.operations).toEqual([
      expect.objectContaining({
        kind: 'set',
        statement: 'note',
        fields: expect.objectContaining({ near: 'a' }),
      }),
    ]);
  });

  it('deleting and pasting reach the host; pasted copies take host ids', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    s.setSelection(['c']);
    const part = s.copySelection();
    const deleted = await oneEdit(s, heard, () => s.deleteSelection());
    expect(kinds(deleted)).toContain('remove node c');
    const pasted = await oneEdit(s, heard, () => s.pasteFragment(part));
    expect(kinds(pasted)).toContain('add node node-1');
  });

  it('a brush dab, a brush stroke and a kept timeline step each keep an arrangement', async () => {
    const { s, heard } = await open({ drag: 'stay' }, SOURCE.replace(/note .*\n/, ''));
    s.activateBrush({ mode: 'tidy' });
    const dab = await oneEdit(s, heard, () => void s.brushDab({ x: 100, y: 100 }));
    expect(dab.label).toBe('Local layout brush');
    expect(dab.operations.length).toBeGreaterThan(0);
    const stroke = await oneEdit(s, heard, () =>
      drag(s, middle(s, 'a'), middle(s, 'b'), node('a')),
    );
    expect(stroke.label).toBe('Local layout brush');
    s.deactivateBrush();
    const step = await oneEdit(s, heard, async () => {
      await s.openTimeline();
      for (let i = 0; i < 200 && !s.timeline()?.data; i++) await new Promise(r => setTimeout(r, 5));
      s.scrub(s.timeline()!.data!.frames.length - 1);
      s.keepStep();
    });
    expect(step.label).toMatch(/^Layout timeline · step \d+$/);
  });
});

describe('bends and label slides are kept as route and label statements', () => {
  it('a bend added, dragged and removed is one route statement each time, and a label slide one label', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const route = () => s.routesById().get('go')!;
    // A bend added on the line, where a double click puts it.
    const on = route().points[0];
    const add = await oneEdit(s, heard, () =>
      s.addWaypointAt('go', { x: on.x + 30, y: on.y + 120 }),
    );
    expect(kinds(add)).toEqual(['add route go']);
    expect(add.operations[0].fields.via).toMatch(/^-?\d+,-?\d+$/);
    expect(s.doc.layout.edges.go?.waypoints).toHaveLength(1);
    // Dragged: the handle moves, and the route's one point with it.
    const bend = { ...s.doc.layout.edges.go!.waypoints![0] };
    s.setSelection(['go']);
    const moved = await oneEdit(s, heard, () =>
      drag(
        s,
        [bend.x, bend.y],
        [bend.x + 40, bend.y + 20],
        element({
          '[data-kind]': { id: 'go', kind: 'edge' },
          '[data-waypoint]': { waypoint: '0' },
        }),
      ),
    );
    expect(kinds(moved)).toEqual(['set route go']);
    expect(s.doc.layout.edges.go!.waypoints![0]).toEqual({ x: bend.x + 40, y: bend.y + 20 });
    // A label slid along its line: a fraction along it and a distance off it.
    const label = route().label!;
    s.setSelection(['go']);
    const slid = await oneEdit(s, heard, () =>
      drag(
        s,
        [label.x, label.y],
        [label.x + 10, label.y - 12],
        element({ '[data-kind]': { id: 'go', kind: 'edge' }, '[data-edge-label]': {} }),
      ),
    );
    expect(kinds(slid)).toEqual(['add label go']);
    expect(Number(slid.operations[0].fields.at)).toBeGreaterThanOrEqual(0);
    expect(Number(slid.operations[0].fields.at)).toBeLessThanOrEqual(1);
    // Removed: the route statement goes, and the label's stays.
    const gone = await oneEdit(s, heard, () => s.removeWaypoint('go', 0));
    expect(kinds(gone)).toEqual(['remove route go']);
    expect(s.currentSource()).toMatch(/^label go at=/m);
    expect(heard.refused).toEqual([]);
  });
});

describe('gestures that only look change nothing', () => {
  it('a background drag pans, Shift-drag selects, Ctrl-drag zooms', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    const source = s.currentSource();
    drag(s, [5, 5], [80, 60], background());
    expect(s.camera()).toEqual({ x: 75, y: 55, k: 1 });
    drag(s, [-100, -100], [2000, 2000], background(), { shiftKey: true });
    expect(s.selectedIds().sort()).toEqual(['a', 'b', 'c']);
    drag(s, [400, 400], [400, 300], background(), { ctrlKey: true });
    expect(s.camera().k).toBeGreaterThan(1);
    await settled(s);
    expect(heard.edits).toEqual([]);
    expect(heard.refused).toEqual([]);
    expect(s.currentSource()).toBe(source);
  });
});

describe('the host keeps the history', () => {
  it('undo and redo go to the host, and the session keeps no steps of its own to walk', async () => {
    const { s, heard } = await open({ drag: 'stay' });
    s.undo();
    s.redo();
    s.undo();
    expect([heard.undo, heard.redo]).toEqual([2, 1]);
    expect(s.canUndo()).toBe(true);
  });

  it('history: false turns undo and redo off', async () => {
    const { s, heard } = await open({ drag: 'stay', history: false });
    const [x, y] = middle(s, 'c');
    await oneEdit(s, heard, () => drag(s, [x, y], [x + 100, y], node('c')));
    const source = s.currentSource();
    expect(s.canUndo()).toBe(false);
    s.undo();
    await settled(s);
    expect(s.currentSource()).toBe(source);
  });
});
