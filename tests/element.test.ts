// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../src/runtime/element';

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}

Object.defineProperty(window, 'ResizeObserver', {
  value: ResizeObserverMock,
  configurable: true,
});
// jsdom has no font loading; a set that accepts every embedded face lets a drawing commit.
const faces = new Set<unknown>();
Object.defineProperty(document, 'fonts', {
  value: {
    add: (f: unknown) => faces.add(f),
    delete: (f: unknown) => faces.delete(f),
    [Symbol.iterator]: () => faces.values(),
  },
  configurable: true,
});
Object.defineProperty(window, 'FontFace', {
  value: class {
    status = 'loaded';
    load() {
      return Promise.resolve(this);
    }
  },
  configurable: true,
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('draft-diagram element', () => {
  it('reflects source, keeps fallback until commit, emits current updates, and reconnects', async () => {
    const element = document.createElement('draft-diagram');
    const fallback = document.createElement('p');
    fallback.textContent = 'Diagram fallback';
    element.append(fallback);
    element.options = { execution: { mode: 'main' } };

    let detail: CustomEvent['detail'];
    element.addEventListener('draft-update', event => {
      detail = (event as CustomEvent).detail;
    });
    element.source = 'not a diagram';
    expect(element.getAttribute('source')).toBe('not a diagram');
    document.body.append(element);
    await element.updateComplete;
    expect(detail).toMatchObject({ status: 'error' });
    expect(element.shadowRoot!.querySelector('slot')!.hidden).toBe(false);
    expect(element.shadowRoot!.querySelector<HTMLElement>('.draft-diagram__viewer')!.hidden).toBe(
      true,
    );
    expect(element.shadowRoot!.querySelector('.draft-diagram__status')!.textContent).toContain(
      'Unknown statement',
    );

    element.source = 'still not a diagram';
    const firstViewer = element.viewer;
    await element.updateComplete;
    expect(detail).toMatchObject({ status: 'error' });
    expect(element.shadowRoot!.querySelector('slot')!.hidden).toBe(false);

    element.source = 'pending invalid update';
    const completion = element.updateComplete;
    element.remove();
    await expect(completion).resolves.toMatchObject({ status: 'destroyed' });
    expect(element.viewer).toBeUndefined();
    expect(element.shadowRoot!.querySelector('slot')!.hidden).toBe(false);
    document.body.append(element);
    await element.updateComplete;
    expect(element.viewer).not.toBe(firstViewer);
    expect(detail).toMatchObject({ status: 'error' });
  });

  it('settles mount failures and applies the nonce', async () => {
    const element = document.createElement('draft-diagram');
    element.source = 'not a diagram';
    element.options = {
      execution: { mode: 'worker' },
      render: {
        styleNonce: 'nonce-123',
        links: { mode: 'safe', resolve: () => null },
      },
    };
    let detail: unknown;
    element.addEventListener('draft-update', event => {
      detail = (event as CustomEvent).detail;
    });
    document.body.append(element);

    await expect(element.updateComplete).resolves.toMatchObject({
      status: 'error',
      error: { reason: 'environment', diagnostics: [{ code: 'DRAFT_ELEMENT_MOUNT' }] },
    });
    expect(detail).toMatchObject({ status: 'error' });
    expect(element.shadowRoot!.querySelector('style')!.getAttribute('nonce')).toBe('nonce-123');
    expect(element.getAttribute('status')).toBe('error');
    expect(element.shadowRoot!.querySelector('slot')!.hidden).toBe(false);
    expect(element.shadowRoot!.querySelector<HTMLElement>('.draft-diagram__viewer')!.hidden).toBe(
      true,
    );
  });

  it('mounts once after every property set in the same tick, and keeps host listeners', async () => {
    const element = document.createElement('draft-diagram');
    document.body.append(element);
    element.source = 'node a "A"';
    element.options = { execution: { mode: 'main' }, toolbar: false };
    element.setAttribute('label', 'First');
    const updates: string[] = [];
    element.addEventListener('draft-update', e => updates.push(e.detail.status));
    await element.updateComplete;
    const viewer = element.viewer;
    expect(viewer).toBeDefined();
    expect(element.getAttribute('status')).toBe('ready');
    const root = element.shadowRoot!.querySelector('.draft-viewer')!;
    expect(root.querySelector<HTMLElement>('.draft-viewer__toolbar')!.hidden).toBe(true);
    expect(root.getAttribute('aria-label')).toBe('First');

    // Same values in a new object, a live label and a live toolbar keep the viewer.
    element.options = { execution: { mode: 'main' }, toolbar: true };
    element.setAttribute('label', 'Second');
    expect(element.viewer).toBe(viewer);
    expect(root.getAttribute('aria-label')).toBe('Second');
    expect(root.querySelector<HTMLElement>('.draft-viewer__toolbar')!.hidden).toBe(false);

    // A new execution mode mounts a new viewer; the element's listeners still hear it.
    element.options = {
      execution: {
        mode: 'worker',
        createWorker: () => {
          throw Error('no worker');
        },
      },
    };
    await element.updateComplete;
    expect(element.viewer).not.toBe(viewer);
    expect(updates.length).toBe(2);
  });

  it('settles a mount that never started, when connected and removed in one tick', async () => {
    const rejections: unknown[] = [];
    const onReject = (e: PromiseRejectionEvent) => rejections.push(e.reason);
    window.addEventListener('unhandledrejection', onReject);
    const element = document.createElement('draft-diagram');
    element.source = 'node a "A"';
    document.body.append(element);
    element.remove();
    await expect(element.updateComplete).resolves.toBeUndefined();
    await new Promise(r => setTimeout(r, 0));
    window.removeEventListener('unhandledrejection', onReject);
    expect(rejections).toEqual([]);
    expect(element.viewer).toBeUndefined();
  });

  it('dispatches contextmenu as a cancelable event, and a host cancel stops the browser menu', async () => {
    const element = document.createElement('draft-diagram');
    element.options = { execution: { mode: 'main' } };
    element.source = 'node a "A"';
    document.body.append(element);
    await element.updateComplete;
    const menus: Array<{ id: string | null }> = [];
    element.addEventListener('draft-contextmenu', e => {
      menus.push(e.detail);
      if (e.detail.id) e.preventDefault();
    });
    const right = (target: Element) => {
      const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      target.dispatchEvent(event);
      return event.defaultPrevented;
    };
    const shadow = element.shadowRoot!;
    expect(right(shadow.querySelector('[data-id="a"]')!)).toBe(true);
    expect(right(shadow.querySelector('.draft-viewer__viewport')!)).toBe(false);
    expect(menus.map(m => m.id)).toEqual(['a', null]);
    expect(element.viewer!.geometry()?.nodes.a).toMatchObject({ width: expect.any(Number) });
  });
});
