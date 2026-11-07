// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mountEditor } from '../src/editor/mount';

vi.hoisted(() => {
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {} })) as never;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as never;
});

describe('mountEditor nodeContent', () => {
  it("draws the host's body in the nodes it names", async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const editor = mountEditor(host, {
      source: 'node a "Alpha"\nnode b "Beta"\nsize a width=160 height=auto min-height=100',
      nodeContent: {
        draws: id => id === 'a',
        Body: props => {
          const div = document.createElement('div');
          div.textContent = `host ${props.id} ${props.width}x${props.height}`;
          return div;
        },
      },
    });
    for (let i = 0; i < 100 && !host.querySelector('[data-id="b"] .node-title'); i++)
      await new Promise(r => setTimeout(r, 10));
    expect(host.querySelector('[data-id="a"] foreignObject')?.textContent).toBe('host a 160x100');
    expect(host.querySelector('[data-id="b"] .node-title')?.textContent).toBe('Beta');
    editor.destroy();
  });
});
