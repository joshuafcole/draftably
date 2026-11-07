// @vitest-environment jsdom
import { createComputed, createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkSource } from '../src/dsl/compile';
import { projectScene } from '../src/dsl/project';
import * as note from '../src/model/note';
import { createDiagramSession } from '../src/state/session';

vi.hoisted(() => {
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {} })) as never;
});
vi.mock('../src/model/note', async original => {
  const actual = await original<typeof import('../src/model/note')>();
  return { ...actual, placeNotes: vi.fn(actual.placeNotes) };
});

const SOURCE = `diagram "Glide" version=1
node a "Start"
node b "Middle"
node c "End"
edge ab a -> b
edge bc b -> c
note "Placed beside the drawing." near=c side=below
`;

afterEach(() => vi.mocked(note.placeNotes).mockClear());

describe('viewer frame', () => {
  it('places the notes once per glide frame, however many readers it has', () => {
    const s = createDiagramSession({});
    s.restoreDocument(projectScene(checkSource(SOURCE)), { keepCamera: false });
    const readers = 4;
    const stop = createRoot(dispose => {
      for (let i = 0; i < readers; i++) createComputed(() => s.viewerFrame());
      return dispose;
    });
    const start = s.doc.layout.nodes;
    for (let frame = 1; frame <= 3; frame++) {
      vi.mocked(note.placeNotes).mockClear();
      s.setAnimationGeometry(
        Object.fromEntries(
          Object.entries(start).map(([id, n]) => [id, { ...n, x: n.x + frame * 10 }]),
        ),
      );
      expect(note.placeNotes).toHaveBeenCalledTimes(1);
    }
    stop();
    s.dispose();
  });
});
