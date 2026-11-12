// @vitest-environment jsdom
// The editor's geometry is lazy and shares one revision with its updates.
import { expect, it, vi } from 'vitest';

const placed = vi.hoisted(() => ({ calls: 0 }));
vi.mock('../src/runtime/geometry', async importOriginal => {
  const real = await importOriginal<typeof import('../src/runtime/geometry')>();
  return {
    ...real,
    placedItems: (...args: Parameters<typeof real.placedItems>) => {
      placed.calls++;
      return real.placedItems(...args);
    },
  };
});
globalThis.matchMedia ??= (() => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})) as never;
globalThis.ResizeObserver ??= class {
  observe() {}
  disconnect() {}
} as never;
const { mountEditor } = await import('../src/editor/mount');

const source = (width: number) =>
  `node a "A"\nnode b "B"\nedge e a -> b\nsize a width=${width} height=60\n`;

it('builds geometry only when read, once per revision, and an update names that revision', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const editor = mountEditor(host, { source: source(120) });
  const first = await editor.ready;
  // Drawing changes with no reader build nothing.
  for (const width of [140, 160, 180]) await editor.update(source(width));
  expect(placed.calls).toBe(0);

  const result = await editor.update(source(200));
  const g = editor.geometry()!;
  expect(g.nodes.a.width).toBe(200);
  expect(g.revision).toBe(result.revision);
  expect(result.revision).toBeGreaterThan(first.revision);
  expect(editor.geometry()).toBe(g);
  expect(placed.calls).toBe(1);
  editor.destroy();
});
