import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
// Imported with the file: loading the session's modules can take seconds under a full suite.
import { createDiagramSession } from '../src/state/session';

// One node and one line added, one node removed, one relabelled.
const MARKED = `diagram "Panels" version=1
node a "Alpha"
~node b "Beta" was="Bee"
+node c "Gamma"
-node d "Delta"
edge ab a -> b
+edge bc b -> c
-edge ad a -> d
`;

beforeAll(() => {
  // A session reads the page's motion preference and timers; these tests run without a DOM.
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal('window', { setTimeout, clearTimeout, open: vi.fn() });
  vi.stubGlobal('document', { title: '', elementFromPoint: () => null });
});
afterAll(() => vi.unstubAllGlobals());

async function open(options: Parameters<typeof createDiagramSession>[0] = {}) {
  const s = createDiagramSession({ readOnly: true, ...options });
  await s.openSource(MARKED);
  for (let i = 0; i < 40 && s.fileCompiling(); i++) await new Promise(r => setTimeout(r, 0));
  return s;
}

const ids = (s: Awaited<ReturnType<typeof open>>) => {
  const d = s.drawnDoc();
  return [...d.graph.nodes, ...d.graph.edges].map(o => o.id).sort();
};

describe('a session drawing one side of a marked document', () => {
  it('draws the whole merge by default', async () => {
    const s = await open();
    expect(s.panel()).toBeNull();
    expect(ids(s)).toEqual(['a', 'ab', 'ad', 'b', 'bc', 'c', 'd']);
  });

  it('before leaves out what was added and keeps what was removed, marked', async () => {
    const s = await open({ panel: 'before' });
    expect(ids(s)).toEqual(['a', 'ab', 'ad', 'b', 'd']);
    expect(s.drawnDoc().styles.d?.status).toBe('removed');
    expect(s.drawnDoc().graph.nodes.find(n => n.id === 'b')?.title).toBe('Bee');
  });

  it('after leaves out what was removed and keeps what was added, marked', async () => {
    const s = await open({ panel: 'after' });
    expect(ids(s)).toEqual(['a', 'ab', 'b', 'bc', 'c']);
    expect(s.drawnDoc().styles.c?.status).toBe('added');
    expect(s.drawnDoc().graph.nodes.find(n => n.id === 'b')?.title).toBe('Beta');
  });

  it('switches side without moving anything both sides keep', async () => {
    const s = await open(),
      layout = JSON.stringify(s.doc.layout),
      box = (id: string) => s.drawnDoc().layout.nodes[id];
    const merged = { a: box('a'), b: box('b') };
    s.showPanel('before');
    expect({ a: box('a'), b: box('b') }).toEqual(merged);
    s.showPanel('after');
    expect({ a: box('a'), b: box('b') }).toEqual(merged);
    expect(s.panel()).toBe('after');
    s.showPanel(null);
    expect(ids(s)).toHaveLength(7);
    // Showing a side is view state: the document and its layout are untouched.
    expect(JSON.stringify(s.doc.layout)).toBe(layout);
  });

  // The key under the drawing lists what that drawing shows, so a panel never counts the other
  // version's objects.
  const key = (s: Awaited<ReturnType<typeof open>>) =>
    s
      .viewerFrame()
      .key.items.flatMap(i => (i.status ? [i.status] : []))
      .map(c => `${c.status}:${c.count}/${c.lines}`)
      .sort();

  it('counts the statuses of the whole merge in the key', async () => {
    const s = await open();
    expect(key(s)).toEqual(['added:1/1', 'changed:1/0', 'removed:1/1']);
  });

  it('before counts what was removed and nothing added', async () => {
    const s = await open({ panel: 'before' });
    expect(key(s)).toEqual(['changed:1/0', 'removed:1/1']);
  });

  it('after counts what was added and nothing removed', async () => {
    const s = await open({ panel: 'after' });
    expect(key(s)).toEqual(['added:1/1', 'changed:1/0']);
  });

  it('a key follows the side shown', async () => {
    const s = await open();
    s.showPanel('before');
    expect(key(s)).toEqual(['changed:1/0', 'removed:1/1']);
    s.showPanel(null);
    expect(key(s)).toEqual(['added:1/1', 'changed:1/0', 'removed:1/1']);
  });
});
