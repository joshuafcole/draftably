import {
  clampZoom,
  fitCamera,
  revealCamera,
  sameCamera,
  unionBox,
  type Camera,
  type CameraReason,
  type FrameOptions,
  type MoveResult,
} from './camera';
import { createAnchorLayer, type Anchor, type DraftSlot } from './anchors';
import { watchColorScheme } from './color-scheme';
import { itemBox, type Geometry } from './geometry';
import { releaseFace, renderInWorker, retainFace, sharedFace } from './page-shared';
import { fontMetricsVersion, runtimeVersion } from './version';
import { FACES } from '../model/font-faces';
import type {
  CommonRenderOptions,
  Diagnostic,
  LinkPolicy,
  RenderFailure,
  RenderOptions,
  RenderResult,
} from './types';

export { fontMetricsVersion, runtimeVersion };

export type { Camera, CameraReason, FrameOptions, MoveResult } from './camera';
export type { Box, EdgeOut, Geometry, PlacedBox } from './geometry';
export type { Anchor, DraftSlot } from './anchors';
export { ZOOM_MAX, ZOOM_MIN } from './camera';

export type ViewerExecution =
  { mode: 'worker'; createWorker?: () => Worker; timeoutMs?: number } | { mode: 'main' };

export type ViewerRenderOptions = Omit<CommonRenderOptions, 'signal' | 'state'> & {
  fonts?: 'host' | 'embed';
};

export interface ViewerOptions {
  label?: string;
  toolbar?: boolean;
  /**
   * The keyboard and screen-reader list of items. `'hidden'` (default) keeps it for assistive tech
   * and shows it while it holds focus; `'visible'` always shows it under the drawing.
   */
  outline?: 'visible' | 'hidden';
  execution?: ViewerExecution;
  /** `auto` (default) hides slot bodies and shows titles again below a zoom of 0.4. */
  detail?: 'auto' | 'full';
  render?: ViewerRenderOptions;
}

export interface UpdateOptions {
  camera?: 'preserve' | 'fit';
  state?: string | null;
  signal?: AbortSignal;
}

export type UpdateResult =
  | {
      status: 'committed';
      revision: number;
      value: Extract<RenderResult, { ok: true }>['value'];
      diagnostics: readonly Diagnostic[];
    }
  | { status: 'error'; revision: number; error: RenderFailure }
  | { status: 'superseded' | 'destroyed' | 'aborted'; revision: number };

export interface ViewerEvents {
  /** After each commit, after `anchor()`, and with `[]` before `destroy` detaches the targets. */
  anchors: { anchors: readonly Anchor[] };
  /** After each commit: the drawing, and where each item is (`null` for compare and states). */
  render: {
    revision: number;
    value: Extract<RenderResult, { ok: true }>['value'];
    geometry: Geometry | null;
  };
  diagnostics: { revision: number; diagnostics: readonly Diagnostic[]; stale: boolean };
  /** At most once per animation frame, with the latest reason. */
  camera: { camera: Camera; reason: CameraReason };
  itemactivate: {
    id: string;
    kind: 'node' | 'group' | 'edge';
    input: 'pointer' | 'keyboard';
    revision: number;
  };
  /** `preventDefault()` stops the viewer opening the link. */
  link: { itemId: string; href: string; target: '_self' | '_blank'; preventDefault(): void };
  /** A right-click or the menu key; `id` is null on the background. `preventDefault()` stops the browser's menu. */
  contextmenu: {
    id: string | null;
    kind?: ItemKind;
    clientX: number;
    clientY: number;
    preventDefault(): void;
  };
}

export type ItemKind = 'node' | 'group' | 'edge';

export interface ViewerHandle {
  /** Resolves after the first commit or failure; then after each later one. */
  readonly ready: Promise<UpdateResult>;
  update(source: string, options?: UpdateOptions): Promise<UpdateResult>;
  /** Where each item is drawn, in world units. `null` before the first commit, and for compare and states. The same object for one revision. */
  geometry(): Geometry | null;
  on<K extends keyof ViewerEvents>(type: K, listener: (event: ViewerEvents[K]) => void): () => void;
  getCamera(): Camera;
  /** Zoom is clamped to `ZOOM_MIN`–`ZOOM_MAX`. */
  setCamera(camera: Camera): void;
  /** Frame these items, or the whole drawing without ids. At most actual size by default. */
  fit(ids?: readonly string[], options?: FrameOptions): MoveResult;
  /** The least move that shows the item; zooms out only if it does not fit. */
  reveal(id: string, options?: FrameOptions): MoveResult;
  focusItem(id: string): boolean;
  /**
   * Plain-DOM hosts only: keep a target for each slot (`body:<id>`, `overlay:<id>`). Targets come
   * in the `anchors` event; put content in them. The elements set this from their marked children.
   */
  anchor(slots: readonly DraftSlot[]): void;
  destroy(): void;
}

type Drawing = Extract<RenderResult, { ok: true }>['value'];
type FontSpec = { family: string; weight: string };
type EmbeddedFace = FontSpec & { data: string };
type PreparedFace = { key: string; face: FontFace };

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(
  'svg title desc metadata defs style marker g a path rect ellipse circle line polyline polygon text tspan'.split(
    ' ',
  ),
);
const ATTRS = new Set(
  'aria-labelledby role id data-id data-phase data-state data-theme xmlns viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill fill-rule fill-opacity stroke stroke-opacity stroke-width stroke-linecap stroke-linejoin stroke-dasharray opacity font-family font-size font-weight text-anchor dominant-baseline dy text-decoration marker-start marker-end markerWidth markerHeight markerUnits refX refY orient class clip-path nonce href target rel'.split(
    ' ',
  ),
);
let instanceCount = 0;

function parseSvg(doc: Document, svg: string): XMLDocument {
  return new doc.defaultView!.DOMParser().parseFromString(svg, 'image/svg+xml');
}

function fontSpecs(parsed: XMLDocument): FontSpec[] {
  const specs = new Map<string, FontSpec>();
  for (const text of Array.from(parsed.querySelectorAll('text[font-family]'))) {
    const family = (text.getAttribute('font-family') ?? '')
      .split(',')[0]
      .trim()
      .replace(/^['"]|['"]$/g, '');
    const weight = text.getAttribute('font-weight') ?? '400';
    if (
      !Object.values(FACES).some(face => face.family === family && String(face.weight) === weight)
    ) {
      throw new Error('Runtime SVG requested an unknown bundled font face.');
    }
    specs.set(`${family}:${weight}`, { family, weight });
  }
  return [...specs.values()];
}

function embeddedFaces(parsed: XMLDocument, required: readonly FontSpec[]): EmbeddedFace[] {
  const found = new Map<string, EmbeddedFace>();
  for (const style of Array.from(parsed.querySelectorAll('style'))) {
    const css = style.textContent ?? '';
    for (const [, rule] of css.matchAll(/@font-face\s*\{([^{}]{1,200000})\}/g)) {
      const family = /font-family\s*:\s*['"]([^'"]+)['"]/i.exec(rule)?.[1];
      const weight = /font-weight\s*:\s*(\d{1,4})/i.exec(rule)?.[1];
      const data = /src\s*:\s*url\((data:font\/woff2;base64,[A-Za-z0-9+/=]+)\)/i.exec(rule)?.[1];
      if (!family || !weight || !data) continue;
      if (
        !Object.values(FACES).some(face => face.family === family && String(face.weight) === weight)
      )
        continue;
      found.set(`${family}:${weight}`, { family, weight, data });
    }
  }
  return required.map(spec => {
    const face = found.get(`${spec.family}:${spec.weight}`);
    if (!face) throw new Error(`Embedded font ${spec.family} ${spec.weight} is missing.`);
    return face;
  });
}

function safeSvg(
  doc: Document,
  parsed: XMLDocument,
  stripFontRules: boolean,
  maxNodes = 100_000,
): SVGSVGElement {
  // The renderer owns this bounded SVG vocabulary; copy it through DOM APIs without parsing host markup.
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg') {
    throw new Error('Runtime returned invalid SVG.');
  }

  const ids = new Set(
    Array.from(parsed.querySelectorAll('[id]'), element => element.getAttribute('id') ?? ''),
  );
  let nodes = 0;
  const copy = (source: Element): Element => {
    if (++nodes > maxNodes || !TAGS.has(source.localName)) {
      throw new Error('Runtime SVG exceeded the allowed drawing vocabulary.');
    }
    const target = doc.createElementNS(SVG_NS, source.localName);
    for (const { name, value } of Array.from(source.attributes)) {
      if (/^on/i.test(name)) continue;
      if (name === 'href') {
        if (source.localName !== 'a') continue;
        try {
          const url = new URL(value, doc.baseURI);
          if (url.protocol === 'http:' || url.protocol === 'https:')
            target.setAttribute('href', url.href);
        } catch {
          // Ignore unsafe or malformed link values.
        }
        continue;
      }
      if (!ATTRS.has(name) && !/^data-[a-z0-9-]+$/.test(name)) continue;
      const refs = [...value.matchAll(/url\(#([^)]*)\)/g)].map(match => match[1]);
      if (/url\s*\(/i.test(value) && (refs.length === 0 || refs.some(id => !ids.has(id)))) continue;
      if (name === 'aria-labelledby' && value.split(/\s+/).some(id => !ids.has(id))) continue;
      target.setAttribute(name, value);
    }
    if (source.localName === 'a' && target.getAttribute('target') === '_blank') {
      target.setAttribute('rel', 'noopener noreferrer');
    }
    for (const child of Array.from(source.childNodes)) {
      if (child.nodeType === 1) target.append(copy(child as Element));
      else if (child.nodeType === 3) {
        const text = child.nodeValue ?? '';
        target.append(
          doc.createTextNode(
            source.localName === 'style' && stripFontRules
              ? text.replace(/@font-face\s*\{[^{}]*\}/g, '')
              : text,
          ),
        );
      }
    }
    return target;
  };
  return copy(parsed.documentElement) as SVGSVGElement;
}

function fail(reason: RenderFailure['reason'], code: string, message: string): RenderFailure {
  return {
    ok: false,
    reason,
    diagnostics: [{ code, severity: 'error', message, itemIds: [] }],
  };
}

export function mountViewer(host: HTMLElement, options: ViewerOptions = {}): ViewerHandle {
  const view = host?.ownerDocument?.defaultView;
  if (!view || !(host instanceof view.HTMLElement))
    throw new TypeError('host must be an HTMLElement.');
  if (host.childNodes.length) throw new Error('Viewer host must be empty and exclusively owned.');
  if (
    (options.execution ?? { mode: 'worker' }).mode === 'worker' &&
    options.render?.links?.mode === 'safe' &&
    options.render.links.resolve
  ) {
    throw new TypeError('A link resolver requires execution: { mode: "main" }.');
  }

  const doc = host.ownerDocument;
  const win = view;
  const root = doc.createElement('section');
  root.className = 'draft-viewer';
  if (options.outline !== 'visible') root.classList.add('draft-viewer--outline-hidden');
  root.setAttribute('aria-label', options.label ?? 'Diagram viewer');
  const toolbar = doc.createElement('div');
  toolbar.className = 'draft-viewer__toolbar';
  toolbar.setAttribute('role', 'toolbar');
  toolbar.setAttribute('aria-label', 'Diagram controls');
  const viewport = doc.createElement('div');
  viewport.className = 'draft-viewer__viewport';
  viewport.tabIndex = 0;
  viewport.setAttribute('aria-label', options.label ?? 'Diagram');
  const live = doc.createElement('p');
  live.className = 'draft-viewer__status';
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  const outline = doc.createElement('ol');
  outline.className = 'draft-viewer__outline';
  outline.setAttribute('aria-label', 'Diagram outline');
  root.append(toolbar, viewport, live, outline);
  // The drawing and the frame follow the page's scheme: the SVG holds both in light-dark()
  // colors, so a change restyles it and draws nothing again.
  const scheme = watchColorScheme(host, dark => (root.style.colorScheme = dark ? 'dark' : 'light'));
  // The anchor layer sits above the drawing and is never detached while the viewer lives.
  const anchorLayer = createAnchorLayer(doc, {
    detail: options.detail,
    onOverflow: () => tellDiagnostics(),
  });
  viewport.append(anchorLayer.el);
  host.append(root);

  const idPrefix = `draftViewer${(++instanceCount).toString(36)}${Math.random().toString(36).slice(2, 9)}`;
  let revision = 0;
  let destroyed = false;
  let camera: Camera = { centerX: 0, centerY: 0, zoom: 1 };
  let userCamera = false;
  let drawing: Drawing | undefined;
  /** The viewport's size, from the ResizeObserver: no layout read per camera move. */
  let size = { width: 0, height: 0 };
  /** Keys of the page's font faces this viewer holds. */
  const heldFonts = new Set<string>();
  const listeners = new Map<keyof ViewerEvents, Set<(event: never) => void>>();
  const pending = new Map<number, { resolve: (result: UpdateResult) => void }>();
  const emit = <K extends keyof ViewerEvents>(type: K, event: ViewerEvents[K]) => {
    for (const listener of listeners.get(type) ?? []) {
      try {
        (listener as (value: ViewerEvents[K]) => void)(event);
      } catch {
        // Keep one consumer callback from blocking other listeners.
      }
    }
  };
  const addButton = (label: string, action: () => void) => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', action);
    toolbar.append(button);
  };
  const applyCamera = () => {
    const svg = viewport.querySelector('svg');
    if (!svg || !drawing) return;
    const [x, y] = drawing.viewBox;
    const rect = size;
    const scale = camera.zoom;
    const tx = rect.width / 2 - (camera.centerX - x) * scale;
    const ty = rect.height / 2 - (camera.centerY - y) * scale;
    svg.style.transformOrigin = '0 0';
    svg.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    svg.style.width = `${drawing.width}px`;
    svg.style.height = `${drawing.height}px`;
    svg.style.maxWidth = 'none';
    anchorLayer.place(tx - x * scale, ty - y * scale, scale);
    const detail = anchorLayer.el.dataset.draftDetail;
    if (viewport.dataset.draftDetail !== detail) viewport.dataset.draftDetail = detail;
  };
  /** Nodes with a body hide their drawn title; the anchors event names every target. */
  const tellAnchors = () => {
    const ids = new Set(anchorLayer.bodyIds());
    for (const g of viewport.querySelectorAll<SVGElement>(':scope > svg [data-id]'))
      g.toggleAttribute('data-draft-body', ids.has(g.getAttribute('data-id')!));
    emit('anchors', { anchors: anchorLayer.anchors() });
  };
  let lastDiagnostics: { revision: number; diagnostics: readonly Diagnostic[]; stale: boolean } = {
    revision: 0,
    diagnostics: [],
    stale: false,
  };
  /** Diagnostics with the slot warnings of this moment. */
  const tellDiagnostics = () =>
    emit('diagnostics', {
      ...lastDiagnostics,
      diagnostics: [...lastDiagnostics.diagnostics, ...anchorLayer.warnings()],
    });
  /** Camera events go out at most once per animation frame, with the latest reason. */
  let cameraReason: CameraReason = 'user',
    cameraFrame = 0;
  const frameLater = (fn: () => void) =>
    win.requestAnimationFrame ? win.requestAnimationFrame(fn) : win.setTimeout(fn, 16);
  const noteCamera = (reason: CameraReason) => {
    cameraReason = reason;
    if (cameraFrame) return;
    cameraFrame = frameLater(() => {
      cameraFrame = 0;
      if (!destroyed) emit('camera', { camera: { ...camera }, reason: cameraReason });
    });
  };
  const move = (next: Camera, reason: CameraReason, user: boolean): MoveResult => {
    const clamped = { ...next, zoom: clampZoom(next.zoom) };
    userCamera = user;
    if (sameCamera(camera, clamped)) return 'unchanged';
    camera = clamped;
    applyCamera();
    noteCamera(reason);
    return 'moved';
  };
  const frameBox = () => {
    const [x, y, width, height] = drawing!.viewBox;
    return { x, y, width, height };
  };
  /** The committed drawing's geometry, with its revision; one object per revision. */
  let geometry: Geometry | null = null;
  const boxOf = (id: string) => (geometry ? itemBox(geometry, id) : undefined);
  /** The latest fit or reveal asked for before the viewport had a size or a drawing. */
  let pendingMove: (() => MoveResult) | undefined;
  const whenSized = (run: () => MoveResult): MoveResult => {
    if (destroyed) return 'unchanged';
    if (!drawing || !size.width || !size.height) {
      pendingMove = run;
      return 'pending';
    }
    pendingMove = undefined;
    return run();
  };
  const fitTo = (
    ids: readonly string[] | undefined,
    frameOptions: FrameOptions | undefined,
    reason: CameraReason,
  ): MoveResult =>
    whenSized(() => {
      const box = ids ? unionBox(ids.flatMap(id => boxOf(id) ?? [])) : frameBox();
      if (!box) return 'missing';
      // A whole-drawing fit follows later resizes; a framed selection stays put.
      return move(fitCamera(box, size, frameOptions), reason, !!ids);
    });
  const fit = (reason: CameraReason = 'fit') => fitTo(undefined, undefined, reason);
  const zoomBy = (factor: number) => move({ ...camera, zoom: camera.zoom * factor }, 'user', true);
  const actualSize = () => move({ ...camera, zoom: 1 }, 'user', true);
  addButton('Zoom in', () => zoomBy(1.2));
  addButton('Zoom out', () => zoomBy(1 / 1.2));
  addButton('Fit diagram', () => fit());
  addButton('Actual size', actualSize);
  toolbar.hidden = options.toolbar === false;

  const resize = new win.ResizeObserver(entries => {
    const box = entries.at(-1)?.contentRect;
    if (box) size = { width: box.width, height: box.height };
    if (drawing && !size.width) return;
    if (pendingMove) whenSized(pendingMove);
    else if (!userCamera) fit('resize');
    else applyCamera();
  });
  resize.observe(viewport);

  const setError = (at: number, diagnostics: readonly Diagnostic[]) => {
    live.textContent = diagnostics.map(diagnostic => diagnostic.message).join(' ');
    root.classList.add('draft-viewer--stale');
    lastDiagnostics = { revision: at, diagnostics, stale: !!drawing };
    tellDiagnostics();
  };
  const prepareFonts = async (
    parsed: XMLDocument,
    mode: 'host' | 'embed',
  ): Promise<PreparedFace[]> => {
    const required = fontSpecs(parsed);
    if (!required.length) return [];
    if (!doc.fonts) throw new Error('The host document cannot load diagram fonts.');
    if (mode === 'host') {
      for (const spec of required) {
        const css = `${spec.weight} 12px "${spec.family}"`;
        const loaded = await doc.fonts.load(css);
        const hasFace = loaded.some(
          face =>
            face.family.replace(/^['"]|['"]$/g, '') === spec.family &&
            face.weight === spec.weight &&
            face.status === 'loaded',
        );
        if (!hasFace || !doc.fonts.check(css))
          throw new Error(`Host font ${spec.family} ${spec.weight} is unavailable.`);
      }
      return [];
    }

    // Faces the page already holds need no decoding.
    const keys = required.map(spec => `${spec.family}:${spec.weight}`);
    if (keys.every(key => sharedFace(doc, key)))
      return keys.map(key => ({ key, face: sharedFace(doc, key)! }));
    const fonts = embeddedFaces(parsed, required);
    const FontFaceCtor = (win as Window & typeof globalThis).FontFace;
    if (!FontFaceCtor) throw new Error('The browser cannot load embedded diagram fonts.');
    return Promise.all(
      fonts.map(async font => {
        const key = `${font.family}:${font.weight}`;
        const existing = sharedFace(doc, key);
        if (existing) return { key, face: existing };
        const face = new FontFaceCtor(font.family, `url("${font.data}")`, { weight: font.weight });
        await face.load();
        if (face.status !== 'loaded')
          throw new Error(`Embedded font ${font.family} ${font.weight} did not load.`);
        return { key, face };
      }),
    );
  };
  const render = async (
    source: string,
    renderOptions: RenderOptions,
    signal?: AbortSignal,
  ): Promise<RenderResult> => {
    const execution = options.execution ?? { mode: 'worker' };
    if (execution.mode === 'main') {
      // The compiler loads only for main-thread rendering, so a worker page never downloads it.
      const { renderSvg } = await import('./render');
      return renderSvg(source, { ...renderOptions, signal });
    }
    return renderInWorker(source, renderOptions, {
      create: execution.createWorker,
      timeoutMs: execution.timeoutMs,
      signal,
    });
  };

  let pan:
    | { pointerId: number; x: number; y: number; centerX: number; centerY: number; scale: number }
    | undefined;
  const isBackground = (target: EventTarget | null) => {
    const svg = viewport.querySelector('svg');
    const background = svg?.querySelector(':scope > rect');
    return target === viewport || target === svg || target === background;
  };
  /** Slot content is the host's: its nodes are never drawing items. */
  const fromHost = (event: Event) =>
    !(event.target instanceof win.Node) ||
    !viewport.contains(event.target) ||
    anchorLayer.el.contains(event.target);
  /** Marked content (`data-draft-input`) takes its own pointer, wheel and keys. */
  const hostInput = (event: Event) =>
    event
      .composedPath()
      .some(node => node instanceof win.Element && node.hasAttribute('data-draft-input'));
  viewport.addEventListener(
    'wheel',
    event => {
      if (hostInput(event)) return;
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    { passive: false },
  );
  viewport.addEventListener('pointerdown', event => {
    if (!isBackground(event.target) || !drawing) return;
    pan = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      centerX: camera.centerX,
      centerY: camera.centerY,
      scale: camera.zoom,
    };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    if (!pan) return;
    move(
      {
        centerX: pan.centerX - (event.clientX - pan.x) / pan.scale,
        centerY: pan.centerY - (event.clientY - pan.y) / pan.scale,
        zoom: camera.zoom,
      },
      'user',
      true,
    );
  });
  const endPan = () => {
    if (!pan) return;
    try {
      viewport.releasePointerCapture(pan.pointerId);
    } catch {
      // Pointer capture can already be released by the browser.
    }
    pan = undefined;
  };
  viewport.addEventListener('pointerup', endPan);
  viewport.addEventListener('pointercancel', endPan);
  viewport.addEventListener('click', event => {
    if (fromHost(event)) return;
    const target = event.target instanceof win.Element ? event.target : null;
    const anchor = target?.closest('a[href]');
    if (anchor && viewport.contains(anchor)) {
      const itemId = anchor.querySelector('[data-id]')?.getAttribute('data-id');
      const href = anchor.getAttribute('href');
      if (itemId && href) {
        emit('link', {
          itemId,
          href,
          target: anchor.getAttribute('target') === '_blank' ? '_blank' : '_self',
          preventDefault: () => event.preventDefault(),
        });
      }
      return;
    }
    const id = target?.closest('[data-id]')?.getAttribute('data-id');
    const item = drawing?.items.find(value => value.id === id);
    if (item) emit('itemactivate', { id: item.id, kind: item.kind, input: 'pointer', revision });
  });
  viewport.addEventListener('contextmenu', event => {
    if (fromHost(event)) return;
    const target = event.target instanceof win.Element ? event.target : null;
    const id = target?.closest('[data-id]')?.getAttribute('data-id') ?? null;
    const item = id ? drawing?.items.find(value => value.id === id) : undefined;
    emit('contextmenu', {
      id: item?.id ?? null,
      ...(item ? { kind: item.kind } : {}),
      clientX: event.clientX,
      clientY: event.clientY,
      preventDefault: () => event.preventDefault(),
    });
  });
  // Focus that enters a body or overlay brings its item into view; Escape from marked content
  // returns to the drawing, and so does losing the item that held focus.
  anchorLayer.el.addEventListener('focusin', event => {
    const id = event.target instanceof win.Node ? anchorLayer.idOf(event.target) : undefined;
    // A press on marked content focuses it too; a camera move then could lose its click.
    if (id && !anchorLayer.pressed()) handle.reveal(id);
  });
  anchorLayer.el.addEventListener('keydown', event => {
    if (event.key === 'Escape') viewport.focus({ preventScroll: true });
  });
  anchorLayer.el.addEventListener('draft-anchor-focus-lost', () =>
    viewport.focus({ preventScroll: true }),
  );
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '+' || event.key === '=') zoomBy(1.2);
    else if (event.key === '-') zoomBy(1 / 1.2);
    else if (event.key.toLowerCase() === 'f') fit();
  });

  const finishPending = (at: number, status: 'superseded' | 'destroyed' | 'aborted') => {
    for (const [request, work] of pending) {
      if (request !== at) work.resolve({ status, revision: request });
    }
  };
  /** Cancels the render in flight; a newer update or destroy calls it. */
  let cancelRender = () => {};
  const update = (source: string, updateOptions: UpdateOptions = {}): Promise<UpdateResult> => {
    const id = ++revision;
    if (destroyed) return Promise.resolve({ status: 'destroyed', revision: id });
    finishPending(id, 'superseded');
    cancelRender();
    const job = new AbortController();
    cancelRender = () => job.abort();
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: UpdateResult) => {
        if (settled) return;
        settled = true;
        updateOptions.signal?.removeEventListener('abort', abort);
        pending.delete(id);
        const terminal = destroyed
          ? { status: 'destroyed' as const, revision: id }
          : id !== revision
            ? { status: 'superseded' as const, revision: id }
            : updateOptions.signal?.aborted
              ? { status: 'aborted' as const, revision: id }
              : result;
        resolve(terminal);
      };
      const abort = () => {
        job.abort();
        finish({ status: 'aborted', revision: id });
      };
      pending.set(id, { resolve: finish });
      if (updateOptions.signal?.aborted) {
        abort();
        return;
      }
      updateOptions.signal?.addEventListener('abort', abort, { once: true });
      const renderOptions = {
        ...(options.render ?? {}),
        target: 'inline',
        idPrefix,
        fonts: options.render?.fonts ?? 'embed',
        colorScheme: 'auto',
        ...(updateOptions.state !== undefined ? { state: updateOptions.state } : {}),
      } satisfies RenderOptions;
      void render(source, renderOptions, job.signal)
        .then(async result => {
          if (destroyed || id !== revision || updateOptions.signal?.aborted) {
            finish({ status: 'superseded', revision: id });
            return;
          }
          if (!result.ok) {
            setError(id, result.diagnostics);
            finish({ status: 'error', revision: id, error: result });
            return;
          }
          let preparedFonts: PreparedFace[];
          let parsed: XMLDocument;
          try {
            parsed = parseSvg(doc, result.value.svg);
            preparedFonts = await prepareFonts(parsed, renderOptions.fonts ?? 'embed');
          } catch (fontError) {
            if (destroyed || id !== revision || updateOptions.signal?.aborted) {
              finish({
                status: updateOptions.signal?.aborted ? 'aborted' : 'superseded',
                revision: id,
              });
              return;
            }
            const error = fail(
              'environment',
              'DRAFT_FONT_UNAVAILABLE',
              fontError instanceof Error ? fontError.message : 'Diagram fonts are unavailable.',
            );
            setError(id, error.diagnostics);
            finish({ status: 'error', revision: id, error });
            return;
          }
          if (destroyed || id !== revision || updateOptions.signal?.aborted) {
            finish({ status: 'superseded', revision: id });
            return;
          }
          let svg: SVGSVGElement;
          try {
            svg = safeSvg(doc, parsed, renderOptions.fonts !== 'host');
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Could not build safe SVG.';
            const failure = fail('internal', 'DRAFT_VIEWER_DOM', message);
            setError(id, failure.diagnostics);
            finish({ status: 'error', revision: id, error: failure });
            return;
          }
          const addedFonts: string[] = [];
          try {
            for (const prepared of preparedFonts) {
              if (heldFonts.has(prepared.key)) continue;
              retainFace(doc, prepared.key, prepared.face);
              heldFonts.add(prepared.key);
              addedFonts.push(prepared.key);
            }
          } catch (fontError) {
            for (const key of addedFonts) {
              releaseFace(doc, key);
              heldFonts.delete(key);
            }
            const error = fail(
              'environment',
              'DRAFT_FONT_UNAVAILABLE',
              fontError instanceof Error
                ? fontError.message
                : 'Loaded fonts could not be registered.',
            );
            setError(id, error.diagnostics);
            finish({ status: 'error', revision: id, error });
            return;
          }
          const hadDrawing = !!drawing;
          drawing = result.value;
          geometry = drawing.geometry ? { ...drawing.geometry, revision: id } : null;
          // Replace only the drawing: the anchor layer beside it keeps its targets.
          const old = viewport.querySelector(':scope > svg');
          if (old) old.replaceWith(svg);
          else viewport.prepend(svg);
          anchorLayer.setGeometry(geometry);
          // The rebuild drops a focused outline button: give focus back to the same item's
          // button, or to the drawing when that item is gone, so a screen reader keeps its place.
          const focused = (outline.getRootNode() as Document | ShadowRoot).activeElement;
          const focusedId = outline.contains(focused)
            ? (focused as HTMLElement).dataset.itemId
            : undefined;
          outline.replaceChildren(
            ...drawing.items.map(item => {
              const li = doc.createElement('li');
              const button = doc.createElement('button');
              button.type = 'button';
              const label =
                item.label.trim() ||
                (item.kind === 'edge' ? `${item.from ?? '?'} to ${item.to ?? '?'}` : item.id);
              button.textContent = `${item.kind}: ${label}`;
              button.dataset.itemId = item.id;
              button.addEventListener('click', () => {
                emit('itemactivate', {
                  id: item.id,
                  kind: item.kind,
                  input: 'keyboard',
                  revision: id,
                });
                const mark = Array.from(viewport.querySelectorAll('[data-id]')).find(
                  element => element.getAttribute('data-id') === item.id,
                );
                if (mark) {
                  const target = mark.getBoundingClientRect();
                  const frame = viewport.getBoundingClientRect();
                  if ((target.width || target.height) && frame.width && frame.height) {
                    move(
                      {
                        centerX:
                          camera.centerX +
                          (target.left + target.width / 2 - (frame.left + frame.width / 2)) /
                            camera.zoom,
                        centerY:
                          camera.centerY +
                          (target.top + target.height / 2 - (frame.top + frame.height / 2)) /
                            camera.zoom,
                        zoom: Math.max(1, camera.zoom),
                      },
                      'user',
                      true,
                    );
                  }
                }
              });
              li.append(button);
              return li;
            }),
          );
          if (focusedId !== undefined) {
            const again = Array.from(outline.querySelectorAll<HTMLButtonElement>('button')).find(
              button => button.dataset.itemId === focusedId,
            );
            (again ?? viewport).focus({ preventScroll: true });
          }
          const retainedFonts = new Set(preparedFonts.map(font => font.key));
          for (const key of heldFonts) {
            if (retainedFonts.has(key)) continue;
            releaseFace(doc, key);
            heldFonts.delete(key);
          }
          root.classList.remove('draft-viewer--stale');
          live.textContent = result.diagnostics.map(diagnostic => diagnostic.message).join(' ');
          if (pendingMove) whenSized(pendingMove);
          else if (!hadDrawing || updateOptions.camera === 'fit') fit();
          else applyCamera();
          const committed: UpdateResult = {
            status: 'committed',
            revision: id,
            value: drawing,
            diagnostics: result.diagnostics,
          };
          // A host hidden until now could not see a scheme change; read it again.
          scheme.check();
          // Listeners hear the commit before `update` and `ready` resolve.
          emit('render', { revision: id, value: drawing, geometry });
          lastDiagnostics = { revision: id, diagnostics: result.diagnostics, stale: false };
          tellDiagnostics();
          tellAnchors();
          finish(committed);
        })
        .catch(error => {
          if (destroyed || id !== revision || updateOptions.signal?.aborted) {
            finish({
              status: updateOptions.signal?.aborted ? 'aborted' : 'superseded',
              revision: id,
            });
            return;
          }
          const failure = fail(
            'environment',
            'DRAFT_VIEWER_WORKER',
            error instanceof Error ? error.message : 'Viewer render failed.',
          );
          setError(id, failure.diagnostics);
          finish({ status: 'error', revision: id, error: failure });
        });
    });
  };

  /** The latest update's settled result; a superseded one waits for the update that replaced it. */
  let latest: Promise<UpdateResult> | undefined;
  let firstSettled!: (result: UpdateResult) => void;
  const first = new Promise<UpdateResult>(resolve => (firstSettled = resolve));
  const tracked = (source: string, updateOptions?: UpdateOptions) => {
    const result = update(source, updateOptions);
    const settled: Promise<UpdateResult> = result.then(r =>
      r.status === 'superseded' && latest !== settled ? latest! : r,
    );
    latest = settled;
    void settled.then(firstSettled);
    return result;
  };

  const handle: ViewerHandle = {
    get ready() {
      return latest ?? first;
    },
    update: tracked,
    geometry: () => geometry,
    anchor(slots) {
      if (destroyed) return;
      const unknownBefore = anchorLayer.warnings().length;
      anchorLayer.setSlots(slots);
      applyCamera();
      tellAnchors();
      if (anchorLayer.warnings().length || unknownBefore) tellDiagnostics();
    },
    on(type, listener) {
      if (destroyed) return () => {};
      const set = listeners.get(type) ?? new Set();
      set.add(listener as (event: never) => void);
      listeners.set(type, set);
      return () => set.delete(listener as (event: never) => void);
    },
    getCamera: () => ({ ...camera }),
    setCamera(value) {
      if (
        destroyed ||
        !Number.isFinite(value.centerX) ||
        !Number.isFinite(value.centerY) ||
        !Number.isFinite(value.zoom) ||
        value.zoom <= 0
      )
        return;
      move({ ...value }, 'api', true);
    },
    fit: (ids, frameOptions) => fitTo(ids, frameOptions, 'api'),
    reveal: (id, frameOptions) =>
      whenSized(() => {
        const box = boxOf(id);
        return box ? move(revealCamera(camera, box, size, frameOptions), 'api', true) : 'missing';
      }),
    focusItem(id) {
      if (!drawing?.items.some(item => item.id === id)) return false;
      const button = Array.from(outline.querySelectorAll<HTMLButtonElement>('button')).find(
        item => item.dataset.itemId === id,
      );
      button?.focus();
      return !!button;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      scheme.stop();
      revision++;
      pendingMove = undefined;
      if (cameraFrame) (win.cancelAnimationFrame ?? win.clearTimeout)(cameraFrame);
      if (pan) {
        try {
          viewport.releasePointerCapture(pan.pointerId);
        } catch {
          // Pointer capture can already be released by the browser.
        }
        pan = undefined;
      }
      for (const [request, work] of pending)
        work.resolve({ status: 'destroyed', revision: request });
      pending.clear();
      cancelRender();
      for (const key of heldFonts) releaseFace(doc, key);
      heldFonts.clear();
      resize.disconnect();
      emit('anchors', { anchors: [] });
      anchorLayer.destroy();
      listeners.clear();
      host.replaceChildren();
      drawing = undefined;
    },
  };
  return handle;
}

export type { LinkPolicy };
