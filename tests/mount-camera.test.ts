// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { mountEditor, type CameraEvent } from '../src/editor/mount';
import '../src/editor/element';

vi.hoisted(() => {
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {} })) as never;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as never;
});

const SOURCE = 'node a "Alpha"\nnode b "Beta"\npin a x=0 y=0\npin b x=2000 y=1000';
const drawn = async (host: HTMLElement) => {
  for (let i = 0; i < 100 && !host.querySelector('[data-id="b"]'); i++)
    await new Promise(r => setTimeout(r, 10));
};

describe('the camera through mountEditor', () => {
  it('takes the calls on its session and reports them through onCamera', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const events: CameraEvent[] = [];
    const editor = mountEditor(host, { source: SOURCE, onCamera: e => events.push(e) });
    await drawn(host);
    editor.session.setStageSize({ width: 800, height: 600 });
    events.length = 0;
    expect(editor.session.fitTo(['b'])).toBe(true);
    expect(events).toEqual([{ camera: editor.session.getCamera(), reason: 'api' }]);
    editor.destroy();
  });

  it('fires draft-camera on <draft-editor>', async () => {
    const element = document.createElement('draft-editor');
    element.setAttribute('source', SOURCE);
    const events: CameraEvent[] = [];
    element.addEventListener('draft-camera', e =>
      events.push((e as CustomEvent<CameraEvent>).detail),
    );
    document.body.append(element);
    await drawn(element);
    element.editor!.session.setCamera({ x: 5, y: 6, k: 0.5 });
    expect(events.at(-1)).toEqual({ camera: { x: 5, y: 6, k: 0.5 }, reason: 'api' });
    element.remove();
  });
});
