// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// Three cores: the page's worker pool holds two workers (cores − 1).
vi.hoisted(() =>
  Object.defineProperty(globalThis.navigator, 'hardwareConcurrency', {
    value: 3,
    configurable: true,
  }),
);
import { resetPageShared } from '../src/runtime/page-shared';
import { mountViewer } from '../src/runtime/viewer';
import { renderSvg } from '../src/runtime/render';
import type { RenderOptions } from '../src/runtime/types';

const source = `diagram "viewer" version=1
node a "API" href="https://example.com/api"
node b "Store"
edge ab a -> b "reads"
`;
const jobs: Array<{ worker: FakeWorker; id: number; source: string; options: RenderOptions }> = [];
const workers: FakeWorker[] = [];
let workerMode: 'render' | 'hold' | 'error' = 'render';
let fontMode: 'loaded' | 'blocked' = 'loaded';

class FontFaceMock {
  status: FontFaceLoadStatus = 'unloaded';
  family: string;
  weight: string;
  constructor(family: string, _source: string, descriptors: FontFaceDescriptors) {
    this.family = family;
    this.weight = descriptors.weight ?? '400';
  }
  async load() {
    if (fontMode === 'blocked') {
      this.status = 'error';
      throw new Error('Font source blocked by CSP.');
    }
    this.status = 'loaded';
    return this as unknown as FontFace;
  }
}

class FontSetMock {
  faces = new Set<FontFaceMock>();
  add(face: FontFace) {
    this.faces.add(face as unknown as FontFaceMock);
    return this as unknown as FontFaceSet;
  }
  delete(face: FontFace) {
    return this.faces.delete(face as unknown as FontFaceMock);
  }
  async load(css: string) {
    const match = /^(\d+)\s+12px\s+"([^"]+)"$/.exec(css);
    if (!match) return [];
    return [...this.faces].filter(
      face => face.family === match[2] && face.weight === match[1] && face.status === 'loaded',
    ) as unknown as FontFace[];
  }
  check() {
    return true;
  }
  [Symbol.iterator]() {
    return (this.faces as Set<FontFace>).values();
  }
}

class FakeWorker {
  listeners = new Map<string, Set<(event: never) => void>>();
  terminated = false;
  constructor() {
    workers.push(this);
  }
  addEventListener(type: string, callback: (event: never) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(callback);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, callback: (event: never) => void) {
    this.listeners.get(type)?.delete(callback);
  }
  postMessage(request: { id: number; source: string; options: RenderOptions }) {
    jobs.push({ worker: this, ...request });
    if (workerMode === 'error')
      queueMicrotask(() =>
        this.fire('error', new ErrorEvent('error', { message: 'blocked by CSP' })),
      );
    else if (workerMode === 'render')
      void renderSvg(request.source, request.options).then(result =>
        queueMicrotask(() => this.fire('message', { data: { id: request.id, result } })),
      );
  }
  terminate() {
    this.terminated = true;
  }
  fire(type: string, event: object) {
    for (const listener of this.listeners.get(type) ?? [])
      (listener as (value: object) => void)(event);
  }
}

class ResizeObserverMock {
  static current: ResizeObserverMock[] = [];
  callback: ResizeObserverCallback;
  disconnected = false;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.current.push(this);
  }
  observe() {}
  disconnect() {
    this.disconnected = true;
  }
  trigger(width: number, height: number) {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

Object.defineProperty(window, 'Worker', { value: FakeWorker, configurable: true });
Object.defineProperty(window, 'ResizeObserver', { value: ResizeObserverMock, configurable: true });
Object.defineProperty(window, 'FontFace', { value: FontFaceMock, configurable: true });
const fontSet = new FontSetMock();
Object.defineProperty(document, 'fonts', { value: fontSet, configurable: true });
/** Answer a held job with a real render. */
const reply = async (job: (typeof jobs)[number]) =>
  job.worker.fire('message', {
    data: { id: job.id, result: await renderSvg(job.source, job.options) },
  });
const host = () => {
  const el = document.createElement('div');
  document.body.append(el);
  return el;
};
afterEach(() => {
  document.body.replaceChildren();
  resetPageShared();
  jobs.length = 0;
  workers.length = 0;
  ResizeObserverMock.current.length = 0;
  workerMode = 'render';
  fontMode = 'loaded';
  fontSet.faces.clear();
  vi.restoreAllMocks();
});

describe('independent viewer lifecycle', () => {
  it('renders actual runtime SVG by default and namespaces two instances', async () => {
    const firstHost = host(),
      secondHost = host();
    const first = mountViewer(firstHost, { render: { links: { mode: 'safe' } } }),
      second = mountViewer(secondHost, { render: { links: { mode: 'safe' } } });
    expect((await first.update(source)).status).toBe('committed');
    expect((await second.update(source)).status).toBe('committed');
    const svgs = Array.from(document.querySelectorAll('svg'));
    expect(svgs).toHaveLength(2);
    expect(svgs[0].id).not.toBe(svgs[1].id);
    expect(svgs[0].querySelector('title')?.textContent).toBe('viewer');
    expect(svgs[0].querySelector('a[href="https://example.com/api"]')).not.toBeNull();
    expect(svgs[0].querySelector('marker')).not.toBeNull();
    const ids = new Set(Array.from(svgs[0].querySelectorAll('[id]'), el => el.id));
    const refs = [...svgs[0].outerHTML.matchAll(/url\(#([^)]*)\)/g)].map(match => match[1]);
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.every(id => ids.has(id))).toBe(true);
    let linked = false;
    first.on('link', event => {
      linked = event.itemId === 'a';
      event.preventDefault();
    });
    const link = svgs[0].querySelector('a[href]')!;
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(click);
    expect(linked).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    let activated = false;
    first.on('itemactivate', event => {
      activated = event.id === 'b' && event.input === 'pointer';
    });
    svgs[0]
      .querySelector('[data-id="b"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activated).toBe(true);
    expect(fontSet.faces.size).toBeGreaterThan(0);
    first.destroy();
    expect(fontSet.faces.size).toBeGreaterThan(0);
    second.destroy();
    expect(fontSet.faces.size).toBe(0);
  });

  it('keeps the last successful drawing visible after invalid source', async () => {
    const element = host(),
      viewer = mountViewer(element);
    expect((await viewer.update(source)).status).toBe('committed');
    const prior = element.querySelector('svg');
    const result = await viewer.update('not a diagram');
    expect(result.status).toBe('error');
    expect(element.querySelector('svg')).toBe(prior);
    expect(element.querySelector('.draft-viewer--stale')).not.toBeNull();
    expect(element.querySelector('[role="status"]')?.textContent).toContain('Unknown statement');
    viewer.destroy();
  });

  it('shares a pool of two workers, drops superseded work, and settles destroyed work', async () => {
    workerMode = 'hold';
    const element = host(),
      viewer = mountViewer(element),
      other = mountViewer(host());
    const old = viewer.update(source);
    const latest = viewer.update(source);
    void other.update(source);
    void other.update(source);
    await expect(old).resolves.toMatchObject({ status: 'superseded' });
    expect(workers).toHaveLength(2);
    // Both workers are busy; the other viewer's superseded queued job never reaches a worker.
    expect(jobs).toHaveLength(2);
    await reply(jobs[0]);
    await reply(jobs[1]);
    await reply(jobs[2]);
    await expect(latest).resolves.toMatchObject({ status: 'committed' });
    expect(jobs).toHaveLength(3);
    const controller = new AbortController();
    const aborted = viewer.update(source, { signal: controller.signal });
    controller.abort();
    await expect(aborted).resolves.toMatchObject({ status: 'aborted' });
    const pending = viewer.update(source);
    viewer.destroy();
    other.destroy();
    await expect(pending).resolves.toMatchObject({ status: 'destroyed' });
    expect(workers).toHaveLength(2);
    expect(element.childNodes).toHaveLength(0);
  });

  it('times a job from dispatch, so a job that waited in the queue still draws', async () => {
    workerMode = 'hold';
    // Wide margins: a slow CI runner adds tens of milliseconds to each wait.
    const options = { execution: { mode: 'worker' as const, timeoutMs: 400 } };
    const viewers = [0, 1, 2].map(() => mountViewer(host(), options));
    const results = viewers.map(v => v.update(source));
    expect(jobs).toHaveLength(2);
    await new Promise(r => setTimeout(r, 250));
    await reply(jobs[0]);
    await reply(jobs[1]);
    expect(jobs).toHaveLength(3);
    // The third job waited 250 ms and runs 250 more: past 400 ms in all, within it once dispatched.
    await new Promise(r => setTimeout(r, 250));
    await reply(jobs[2]);
    for (const result of results)
      await expect(result).resolves.toMatchObject({ status: 'committed' });
    expect(workers.every(w => !w.terminated)).toBe(true);
    for (const v of viewers) v.destroy();
  });

  it('reports worker errors and timeouts without falling back to the main thread', async () => {
    workerMode = 'error';
    const errored = mountViewer(host());
    await expect(errored.update(source)).resolves.toMatchObject({
      status: 'error',
      error: { reason: 'environment' },
    });
    expect(workers[0].terminated).toBe(true);
    errored.destroy();
    workerMode = 'hold';
    const timed = mountViewer(host(), { execution: { mode: 'worker', timeoutMs: 5 } });
    await expect(timed.update(source)).resolves.toMatchObject({
      status: 'error',
      error: { diagnostics: [{ code: 'DRAFT_VIEWER_WORKER' }] },
    });
    expect(workers.at(-1)?.terminated).toBe(true);
    timed.destroy();
  });

  it('requires main-thread execution for host link resolvers', async () => {
    const render = {
      links: { mode: 'safe' as const, resolve: () => 'https://host.example/route' },
    };
    expect(() => mountViewer(host(), { render })).toThrow(/execution:.*main/);
    const viewer = mountViewer(host(), { execution: { mode: 'main' }, render });
    await expect(viewer.update(source)).resolves.toMatchObject({ status: 'committed' });
    expect(document.querySelector('svg a')?.getAttribute('href')).toBe(
      'https://host.example/route',
    );
    viewer.destroy();
  });

  it('does not trust FontFaceSet.check when no matching host face loaded', async () => {
    const element = host();
    const viewer = mountViewer(element, { render: { fonts: 'host' } });
    const result = await viewer.update(source);
    expect(result).toMatchObject({
      status: 'error',
      error: { reason: 'environment', diagnostics: [{ code: 'DRAFT_FONT_UNAVAILABLE' }] },
    });
    expect(element.querySelector('svg')).toBeNull();
    viewer.destroy();
  });

  it('gives unlabeled edge outline controls a useful accessible name', async () => {
    const viewer = mountViewer(host());
    await expect(
      viewer.update('diagram "Outline" version=1\nnode a "A"\nnode b "B"\nedge ab a -> b\n'),
    ).resolves.toMatchObject({ status: 'committed' });
    expect(
      document.querySelector('.draft-viewer__outline button[data-item-id="ab"]')?.textContent,
    ).toBe('edge: a to b');
    viewer.destroy();
  });

  it('keeps focus on the same outline item across an update', async () => {
    const element = host(),
      viewer = mountViewer(element);
    await viewer.update(source);
    const button = (id: string) =>
      element.querySelector<HTMLButtonElement>(
        `.draft-viewer__outline button[data-item-id="${id}"]`,
      );
    button('b')!.focus();
    await viewer.update(source.replace('"Store"', '"Orders"'));
    expect(document.activeElement).toBe(button('b'));
    expect(document.activeElement?.textContent).toBe('node: Orders');
    // The focused item is removed: focus moves to the drawing, not to the page.
    await viewer.update('diagram "viewer" version=1\nnode a "API"\n');
    expect(document.activeElement).toBe(element.querySelector('.draft-viewer__viewport'));
    viewer.destroy();
  });

  it('rejects blocked embedded faces and keeps the last committed view', async () => {
    const element = host();
    const viewer = mountViewer(element);
    expect((await viewer.update(source)).status).toBe('committed');
    const prior = element.querySelector('svg');
    // A new page: the shared faces are gone, and the font source is now blocked.
    resetPageShared();
    fontSet.faces.clear();
    fontMode = 'blocked';
    const result = await viewer.update(source.replace('"Store"', '"Archive"'));
    expect(result).toMatchObject({
      status: 'error',
      error: { reason: 'environment', diagnostics: [{ code: 'DRAFT_FONT_UNAVAILABLE' }] },
    });
    expect(element.querySelector('svg')).toBe(prior);
    expect(element.querySelector('.draft-viewer--stale')).not.toBeNull();
    viewer.destroy();
  });

  it('fits a hidden host after resize without recompiling and preserves camera scale', async () => {
    const element = host(),
      viewer = mountViewer(element);
    expect((await viewer.update(source)).status).toBe('committed');
    expect(viewer.getCamera().centerX).toBe(0);
    const count = workers.length;
    ResizeObserverMock.current.at(-1)!.trigger(600, 400);
    expect(viewer.getCamera().centerX).toBeGreaterThan(0);
    expect(viewer.getCamera().zoom).toBeLessThanOrEqual(1);
    expect(workers).toHaveLength(count);
    const camera = { centerX: 40, centerY: 20, zoom: 0.37 };
    viewer.setCamera(camera);
    ResizeObserverMock.current.at(-1)!.trigger(300, 200);
    expect(viewer.getCamera()).toEqual(camera);
    viewer.destroy();
  });

  it('runs a fit asked for before the viewport has a size, and sends one camera event a frame', async () => {
    const viewer = mountViewer(host());
    const events: string[] = [];
    viewer.on('camera', e => events.push(e.reason));
    expect(viewer.fit()).toBe('pending');
    expect((await viewer.update(source)).status).toBe('committed');
    ResizeObserverMock.current.at(-1)!.trigger(600, 400);
    expect(viewer.getCamera().centerX).toBeGreaterThan(0);
    expect(viewer.fit()).toBe('unchanged');
    expect(viewer.reveal('nope')).toBe('missing');
    for (const zoom of [0.5, 0.6, 0.7, 20]) viewer.setCamera({ centerX: 1, centerY: 2, zoom });
    expect(viewer.getCamera().zoom).toBe(8);
    await new Promise(r => requestAnimationFrame(() => r(null)));
    expect(events).toEqual(['api']);
    viewer.destroy();
  });
});
