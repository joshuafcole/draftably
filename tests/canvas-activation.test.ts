// @vitest-environment jsdom
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '../src/editor';
import { createDiagramSession } from '../src/state/session';
import { activeSession, setActiveSession } from '../src/state/active-session';

vi.hoisted(() => {
  globalThis.matchMedia = (() => ({ matches: false, addEventListener() {} })) as never;
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as never;
});

afterEach(() => document.body.replaceChildren());

describe('the zoom controls act on their own map', () => {
  it('a click with no press before it makes its session the active one', () => {
    const other = createDiagramSession({});
    const mine = createDiagramSession({});
    setActiveSession(other);
    const host = document.body.appendChild(document.createElement('div'));
    const dispose = render(() => createComponent(Editor, { session: mine }), host);
    const fit = host.querySelector<HTMLButtonElement>('.zoom-controls button')!;
    expect(activeSession()).toBe(other);
    fit.click();
    expect(activeSession()).toBe(mine);
    dispose();
  });
});
