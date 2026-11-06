import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ViewItem } from '../src/state/session';

const SOURCE = `diagram "View" version=1
group lane "Lane"
node a "Alpha" in=lane
node b "Beta"
edge go a -> b "go"
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

async function open(
  options: Parameters<typeof import('../src/state/session').createDiagramSession>[0] = {},
) {
  const { createDiagramSession } = await import('../src/state/session');
  const s = createDiagramSession(options);
  await s.openSource(SOURCE);
  for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  expect(s.doc.graph.nodes.map(n => n.id).sort()).toEqual(['a', 'b']);
  return s;
}

const edgeId = (s: Awaited<ReturnType<typeof open>>) => s.doc.graph.edges[0].id;
const geometry = (s: Awaited<ReturnType<typeof open>>) => JSON.stringify(s.doc.layout);

/** A pointer event on a canvas object (`id`), or on the background. */
function pointer(id: string | null, kind: string, x: number, y: number, extra = {}) {
  const hit = id ? { dataset: { id, kind } } : null;
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
    target: { closest: (sel: string) => (sel === '[data-kind]' ? hit : null) },
    ...extra,
  } as unknown as PointerEvent;
}

/** Press on `id`, drag 120 px right, and let go. */
function drag(s: Awaited<ReturnType<typeof open>>, id: string, kind: string) {
  s.onPointerDown(pointer(id, kind, 100, 100));
  for (let i = 1; i <= 6; i++) s.onPointerMove(pointer(null, '', 100 + i * 20, 100));
  s.onPointerUp(pointer(null, '', 220, 100));
}

describe('view state from the host', () => {
  it('reports a selection the user makes, with each kind, and not one the host shows', async () => {
    const selected: ViewItem[][] = [];
    const s = await open({ onSelect: items => selected.push(items) });
    s.showSelection(['a', edgeId(s), 'nowhere']);
    expect(s.selectedIds()).toEqual(['a', edgeId(s)]);
    expect(selected).toEqual([]);

    s.selectItems(['lane'], { add: true });
    expect(selected.at(-1)).toEqual([
      { id: 'a', kind: 'node' },
      { id: edgeId(s), kind: 'edge' },
      { id: 'lane', kind: 'group' },
    ]);
    s.clearSelection();
    expect(selected.at(-1)).toEqual([]);
    expect(selected).toHaveLength(2);
    s.dispose();
  });

  it('never moves the drawing when the selection changes', async () => {
    const s = await open();
    const before = geometry(s);
    s.showSelection(['a', 'lane']);
    s.selectItems(['b'], { add: true });
    s.clearSelection();
    expect(geometry(s)).toBe(before);
    s.dispose();
  });

  it('draws a hover the host shows without reporting it, and reports the pointer’s', async () => {
    const hovers: Array<ViewItem | null> = [];
    const s = await open({ onHover: item => hovers.push(item) });
    s.showHover('b');
    expect(s.hoveredId()).toBe('b');
    s.showHover('nowhere');
    expect(s.hoveredId()).toBe(null);
    expect(hovers).toEqual([]);

    s.onPointerMove(pointer('lane', 'group', 10, 10));
    s.onPointerMove(pointer('lane', 'group', 12, 10));
    s.onPointerMove(pointer(null, '', 14, 10));
    expect(hovers).toEqual([{ id: 'lane', kind: 'group' }, null]);
    s.dispose();
  });
});

describe('a read-only session', () => {
  it('takes no edit, and takes them again once it is not read-only', async () => {
    const s = await open({ readOnly: true });
    const before = s.snapshot();
    expect(s.transact('Rename', d => void (d.graph.nodes[0].title = 'Changed'))).toBe(false);
    s.startInlineEdit('a');
    expect(s.inlineEditId()).toBe(null);
    expect(s.snapshot()).toBe(before);

    s.setReadOnly(false);
    s.startInlineEdit('a');
    expect(s.inlineEditId()).toBe('a');
    s.dispose();
  });

  it('pans for a drag that would move a shape, and selects what was pressed', async () => {
    const editable = await open();
    const moved = geometry(editable);
    drag(editable, 'a', 'node');
    // The same drag moves the shape when the session takes edits.
    expect(geometry(editable)).not.toBe(moved);
    editable.dispose();

    const selected: ViewItem[][] = [];
    const s = await open({ readOnly: true, onSelect: items => selected.push(items) });
    const before = geometry(s),
      camera = { ...s.doc.camera };
    drag(s, 'a', 'node');
    expect(geometry(s)).toBe(before);
    expect(s.doc.camera.x).toBe(camera.x + 120);
    expect(selected).toEqual([[{ id: 'a', kind: 'node' }]]);
    s.dispose();
  });

  it('activates what is double-clicked instead of editing it', async () => {
    const opened: ViewItem[] = [];
    const s = await open({ readOnly: true, onActivate: item => opened.push(item) });
    s.onDoubleClick(pointer('lane', 'group', 10, 10) as unknown as MouseEvent);
    s.onDoubleClick(pointer(null, '', 10, 10) as unknown as MouseEvent);
    expect(opened).toEqual([{ id: 'lane', kind: 'group' }]);
    expect(s.inlineEditId()).toBe(null);
    expect(s.activate('nowhere')).toBe(false);
    s.dispose();
  });
});
