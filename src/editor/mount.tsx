import { createEffect, createMemo, createSignal, on, untrack } from 'solid-js';
import { render } from 'solid-js/web';
import { registerFonts } from '../lib/font-data';
import { resolveAppearance } from '../model/appearance';
import { hasActiveSession, releaseActiveSession, setActiveSession } from '../state/active-session';
import { eventTarget } from '../state/dom-root';
import { copyShapes, handleCanvasKey, handleKeyUp, pasteShapes } from '../state/canvas-keyboard';
import { createDiagramSession, type SessionOptions } from '../state/session';
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
} from '../runtime/camera';
import { findEdge, findNode, isGroup, objectRect } from '../model/graph';
import { placedItems, type Geometry } from '../runtime/geometry';
import { drawnLegend, usedStatuses } from '../model/status';
import { createAnchorLayer, type Anchor, type DraftSlot } from '../runtime/anchors';
import { watchColorScheme } from '../runtime/color-scheme';
import type { Diagnostic } from '../runtime/types';
import type { EditorUpdate } from '../runtime/host';
import { adoptEditorCss } from './css';
import { Editor } from './Editor';
import { sessions } from './internal';
import '../styles/app.css';

/**
 * Shortcuts act on the session the user last pointed at. Clicking a shape leaves focus on the
 * page, so they listen on the document, once for all editors, and skip keys meant for the host's
 * own controls. A key on the page body reaches an editor only while the user's last pointer press
 * was inside one; a press on the page outside every editor ends that.
 */
let engaged = false;
const inEditor = (e: Event) =>
  e.composedPath().some(n => n instanceof Element && n.classList.contains('draft-editor'));
const forEditor =
  <E extends Event>(handle: (e: E) => unknown) =>
  (e: Event) => {
    if (!hasActiveSession()) return;
    // Marked host content takes its own keys; shortcuts never fire there.
    if (e.composedPath().some(n => n instanceof Element && n.hasAttribute('data-draft-input')))
      return;
    const target = eventTarget(e) as Element;
    if ((target === document.body && engaged) || target.closest?.('.draft-editor'))
      void handle(e as E);
  };
const KEYS: Array<[string, (e: Event) => void, boolean?]> = [
  ['pointerdown', (e: Event) => (engaged = inEditor(e)), true],
  ['keydown', forEditor(handleCanvasKey)],
  ['keyup', forEditor(handleKeyUp)],
  ['copy', forEditor(copyShapes)],
  ['paste', forEditor(pasteShapes)],
];
let mounted = 0;

/** The options a host sets on `<draft-editor>`: every mount option but the text and `onChange`. */
export type EditorOptions = Pick<
  SessionOptions,
  | 'storageKey'
  | 'openLink'
  | 'confirm'
  | 'onInteract'
  // A read-only editor and what its user does (`prove:view-state`).
  | 'readOnly'
  | 'onSelect'
  | 'onHover'
  | 'onActivate'
> & {
  /** `auto` (default) hides slot bodies and shows titles again below a zoom of 0.4. */
  detail?: 'auto' | 'full';
};

export interface MountOptions extends EditorOptions {
  /** The `.draft` text to edit. */
  source: string;
  /** Receives the new text after every kept edit, undo and redo. */
  onChange?: (source: string) => void;
}

/** What `on` reports. `camera` comes at most once per animation frame. */
export interface EditorEvents {
  /** After each drawing, after `anchor()`, and with `[]` before `destroy` detaches the targets. */
  anchors: { anchors: readonly Anchor[] };
  /** A source that does not parse (`DRAFT_PARSE`), then slot warnings: an unknown slot, or content larger than its node. */
  diagnostics: { revision: number; diagnostics: readonly Diagnostic[]; stale: boolean };
  /** Each update's result, from the first text on. */
  update: EditorUpdateResult;
  /** A link mark was pressed. `preventDefault()` stops the editor opening it. */
  link: {
    itemId: string;
    href: string;
    target: '_blank';
    preventDefault(): void;
  };
  camera: { camera: Camera; reason: CameraReason };
  /** The selection changed, by the user or through `select()`. */
  select: { ids: readonly string[]; reason: 'user' | 'api' };
  /** A right-click; `id` is null on the background. The editor shows no menu of its own. */
  contextmenu: {
    id: string | null;
    kind?: 'node' | 'group' | 'edge';
    clientX: number;
    clientY: number;
    preventDefault(): void;
  };
}

/** An editor update's outcome: `EditorUpdate` in `@draftably/runtime/host`. */
export type EditorUpdateResult = EditorUpdate;

/** The editor's handle: the viewer's camera, plus editing. */
export interface MountedEditor {
  /** Resolves once the first text is drawn. */
  readonly ready: Promise<EditorUpdateResult>;
  /** The text as the editor holds it now. */
  source(): string;
  /** Show text the host changed. Resolves once it is drawn. */
  update(source: string): Promise<EditorUpdateResult>;
  /** Where each item is drawn, in world units: the viewer's shapes. The same object for one revision. */
  geometry(): Geometry | null;
  /** Select these items (unknown IDs are dropped); `[]` clears the selection. */
  select(ids: readonly string[]): void;
  selection(): readonly string[];
  /** Plain-DOM hosts only: keep a target per slot; `<draft-editor>` sets this from its children. */
  anchor(slots: readonly DraftSlot[]): void;
  getCamera(): Camera;
  /** Zoom is clamped to `ZOOM_MIN`–`ZOOM_MAX`, as in the viewer. */
  setCamera(camera: Camera): void;
  /** Frame these items, or the whole drawing without ids. At most actual size by default. */
  fit(ids?: readonly string[], options?: FrameOptions): MoveResult;
  /** The least move that shows the item; zooms out only if it does not fit. */
  reveal(id: string, options?: FrameOptions): MoveResult;
  on<K extends keyof EditorEvents>(type: K, listener: (event: EditorEvents[K]) => void): () => void;
  /** Remove the editor and stop its session. Safe to call twice. */
  destroy(): void;
}

type View = { width: number; height: number };
/** The editor keeps `{ x, y, k }` (the screen offset of the world origin) inside; hosts see `Camera`. */
const toCamera = (c: { x: number; y: number; k: number }, view: View): Camera => ({
  centerX: (view.width / 2 - c.x) / c.k,
  centerY: (view.height / 2 - c.y) / c.k,
  zoom: c.k,
});
const fromCamera = (c: Camera, view: View) => ({
  x: view.width / 2 - c.centerX * c.zoom,
  y: view.height / 2 - c.centerY * c.zoom,
  k: c.zoom,
});
const toBox = (r: { x: number; y: number; w: number; h: number }) => ({
  x: r.x,
  y: r.y,
  width: r.w,
  height: r.h,
});

/**
 * Edit one diagram inside `host`: the canvas with selection, dragging, inline editing and its
 * shortcuts. Each edit is written back to the source and reported through `onChange`. Give the
 * host a size; the canvas fills it.
 */
export function mountEditor(host: HTMLElement, options: MountOptions): MountedEditor {
  // The session reads options when it needs them, so getters on `options` stay live. A link
  // press is offered to the host's `link` listeners before it opens. Object.create keeps the
  // getters: never spread these options, since a spread copies each getter's value once.
  const session = createDiagramSession(
    Object.create(options, {
      onLink: {
        value: ({ href, itemId }: { href: string; itemId: string | undefined }) => {
          if (!itemId) return false;
          let stopped = false;
          emit('link', { itemId, href, target: '_blank', preventDefault: () => (stopped = true) });
          return stopped;
        },
      },
    }) as MountOptions,
  );
  // The default theme draws dark on a dark page. The canvas redraws its colors only: the dark
  // theme has the light one's sizes, so nothing moves. The editor's own controls set their
  // color-scheme inside a shadow root, so there the page's scheme is read at its top. The element
  // that holds the tokens, `<draft-editor>` or the mounted host, says the page's scheme too: the
  // editor's controls go dark with the page unless it sets its own `data-theme`. The scheme is
  // read before the first render, so the canvas never draws light first on a dark page.
  const shadow = host.getRootNode() instanceof ShadowRoot;
  const themed = shadow ? (host.getRootNode() as ShadowRoot).host : host;
  const scheme = watchColorScheme(shadow ? (host.getRootNode() as ShadowRoot) : host, dark => {
    session.setDark(dark);
    themed.setAttribute('data-draft-scheme', dark ? 'dark' : 'light');
  });
  registerFonts();
  let destroyed = false,
    opened = false,
    firstFit = 0;
  /**
   * One revision for the drawing: it counts changes to what the editor draws, and an update
   * resolves with the revision it drew, so `geometry().revision` matches it as in the viewer.
   */
  let revision = 0;
  let revisionNow = () => revision;
  /** The source's parse error, as the viewer reports one. */
  const parseDiagnostics = (): Diagnostic[] => {
    const e = session.sourceError();
    if (!e) return [];
    const message = e.message.replace(/^Line \d+(?:, column \d+)?: /, '');
    return [
      { code: 'DRAFT_PARSE', severity: 'error', message, location: { line: e.line }, itemIds: [] },
    ];
  };
  /** Every update, the first text's included, ends here: it reports its result and diagnostics. */
  const settle = (thrown?: { error: unknown }) => (): EditorUpdateResult => {
    const at = revisionNow();
    if (destroyed) return { status: 'destroyed', revision: at };
    const failed = parseDiagnostics();
    if (thrown && !failed.length)
      failed.push({
        code: 'DRAFT_INTERNAL',
        severity: 'error',
        message:
          thrown.error instanceof Error
            ? thrown.error.message
            : 'The editor could not show this source.',
        itemIds: [],
      });
    const result: EditorUpdateResult = failed.length
      ? {
          status: 'error',
          revision: at,
          error: { ok: false, reason: thrown ? 'internal' : 'input', diagnostics: failed },
        }
      : { status: 'committed', revision: at };
    // A host hidden until now could not see a scheme change; read it again.
    scheme.check();
    emit('update', result);
    tellSlots();
    return result;
  };
  const ready: Promise<EditorUpdateResult> = session
    .openSource(options.source, options.onChange)
    .then(() => {
      opened = true;
      if (destroyed) return;
      syncAnchors();
      firstFit = requestAnimationFrame(() => {
        session.fitView();
        if (pendingMove) whenSized(pendingMove);
      });
    })
    .then(settle(), error => settle({ error })());
  let latest = ready;

  /** Geometry for one revision, built when a host first asks for it. */
  let geometry: Geometry | null = null;
  let selectReason: 'user' | 'api' = 'user';
  const kindOf = (id: string) =>
    findNode(session.doc, id)
      ? ('node' as const)
      : isGroup(session.doc, id)
        ? ('group' as const)
        : findEdge(session.doc, id)
          ? ('edge' as const)
          : undefined;

  // --- The host's camera: the viewer's shape and rules -----------------------------------------
  const listeners = new Map<keyof EditorEvents, Set<(event: never) => void>>();
  const emit = <K extends keyof EditorEvents>(type: K, event: EditorEvents[K]) => {
    for (const listener of listeners.get(type) ?? []) {
      try {
        (listener as (value: EditorEvents[K]) => void)(event);
      } catch {
        // One listener's error does not stop the others.
      }
    }
  };
  let cameraReason: CameraReason = 'user',
    cameraFrame = 0;
  const stopCamera = session.onCamera(reason => {
    cameraReason = reason;
    if (cameraFrame) return;
    cameraFrame = requestAnimationFrame(() => {
      cameraFrame = 0;
      emit('camera', {
        camera: toCamera(session.doc.camera, session.stageSize()),
        reason: cameraReason,
      });
    });
  });
  let pendingMove: ((view: View) => MoveResult) | undefined;
  /** Run now, or once the editor has drawn and the canvas has a size; the latest call wins. */
  const whenSized = (run: (view: View) => MoveResult): MoveResult => {
    if (destroyed) return 'unchanged';
    const view = session.stageSize();
    if (!opened || view.width <= 1 || view.height <= 1) {
      pendingMove = run;
      return 'pending';
    }
    pendingMove = undefined;
    return run(view);
  };
  const moveTo = (camera: Camera, view: View, reason: CameraReason): MoveResult => {
    const next = fromCamera({ ...camera, zoom: clampZoom(camera.zoom) }, view),
      c = session.doc.camera;
    if (sameCamera(toCamera(c, view), toCamera(next, view))) return 'unchanged';
    session.setCamera(next, reason);
    return 'moved';
  };
  /** Any item's box in world units: a node or group's rectangle, or an edge's route and label. */
  const boxOf = (id: string) => {
    if (session.doc.layout.nodes[id] || isGroup(session.doc, id))
      return toBox(objectRect(session.doc, session.geometry, id));
    const route = session.routesById().get(id);
    if (!route) return undefined;
    const boxes = route.points.map(p => ({ x: p.x, y: p.y, width: 0, height: 0 }));
    if (route.label)
      boxes.push({
        x: route.label.x - route.label.w / 2,
        y: route.label.y - route.label.h / 2,
        width: route.label.w,
        height: route.label.h,
      });
    return unionBox(boxes);
  };
  // The first editor on a page is active until another one is used.
  if (!hasActiveSession()) setActiveSession(session);

  // Host slots: the layer sits between the drawing and the chrome layer, for the editor's life.
  const anchorLayer = createAnchorLayer(document, {
    detail: options.detail,
    onOverflow: () => tellSlots(),
  });
  const [bodies, setBodies] = createSignal<ReadonlySet<string>>(new Set());
  const tellSlots = () =>
    emit('diagnostics', {
      revision,
      diagnostics: [...parseDiagnostics(), ...anchorLayer.warnings()],
      stale: false,
    });
  const tellAnchors = () => {
    const next = anchorLayer.bodyIds();
    if (next.join('\n') !== [...bodies()].join('\n')) setBodies(new Set(next));
    emit('anchors', { anchors: anchorLayer.anchors() });
  };
  const drawAnchors = (g: Geometry) => {
    const before = anchorLayer.warnings().length;
    const changed = anchorLayer.setGeometry(g);
    placeAnchors();
    // A drag frame only moves targets: no target came or went, so there is nothing to tell.
    if (!changed) return;
    tellAnchors();
    if (before || anchorLayer.warnings().length) tellSlots();
  };
  /** Only an editor with slots reads geometry, so one without them stays lazy. */
  const syncAnchors = () => {
    if (opened && !destroyed && anchorLayer.hasSlots()) drawAnchors(handle.geometry()!);
  };
  let stage: Element | null = null;
  const placeAnchors = () => {
    if (!anchorLayer.hasSlots()) return;
    const c = session.doc.camera;
    anchorLayer.place(c.x, c.y, c.k);
    stage ??= host.querySelector('.stage');
    const detail = anchorLayer.el.dataset.draftDetail!;
    if (stage && stage.getAttribute('data-draft-detail') !== detail)
      stage.setAttribute('data-draft-detail', detail);
  };
  anchorLayer.el.addEventListener('focusin', e => {
    const target = eventTarget(e);
    const id = target instanceof Node ? anchorLayer.idOf(target) : undefined;
    // A press on marked content focuses it too; a camera move then could lose its click.
    if (id && !anchorLayer.pressed()) handle.reveal(id);
  });
  anchorLayer.el.addEventListener('keydown', e => {
    if (e.key === 'Escape') session.focusCanvas();
  });
  anchorLayer.el.addEventListener('draft-anchor-focus-lost', () => session.focusCanvas());

  const dispose = render(() => {
    createEffect(() =>
      host.style.setProperty(
        '--diagram-canvas',
        resolveAppearance(session.drawnAppearance()).canvas,
      ),
    );
    // Reads the drawing's inputs and builds nothing from them, so a drag with no geometry
    // reader never runs the frame and item placement.
    const changes = createMemo(() => {
      session.sceneRects();
      session.routes();
      session.visibleScene();
      JSON.stringify(session.doc.appearance);
      JSON.stringify(session.doc.layout.sequence ?? null);
      usedStatuses(session.doc);
      drawnLegend(session.doc);
      return ++revision;
    });
    revisionNow = changes;
    // Slots follow each new drawing. Before the first text is drawn no slot is unknown yet, and
    // `ready` places the targets.
    createEffect(on(changes, syncAnchors, { defer: true }));
    createEffect(() => {
      // Track the camera.
      const { x, y, k } = session.doc.camera;
      void [x, y, k];
      placeAnchors();
    });
    // Every selection change is reported once, with who made it.
    createEffect(
      on(
        session.selection,
        set => {
          emit('select', { ids: [...set], reason: selectReason });
          selectReason = 'user';
        },
        { defer: true },
      ),
    );
    // A fit or reveal asked for before the canvas had a size runs once it has one.
    createEffect(() => {
      const view = session.stageSize();
      if (pendingMove && view.width > 1 && view.height > 1) whenSized(pendingMove);
    });
    return (
      <Editor
        session={session}
        anchorLayer={anchorLayer.el}
        bodies={bodies}
        onContextMenu={e => {
          const id =
            (eventTarget(e) as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id') ??
            null;
          const kind = id ? kindOf(id) : undefined;
          emit('contextmenu', {
            id: kind ? id : null,
            ...(kind ? { kind } : {}),
            clientX: e.clientX,
            clientY: e.clientY,
            preventDefault: () => {},
          });
        }}
      />
    );
  }, host);
  host.classList.add('draft-editor');
  // Tokens live on the mounted host, or on `:host` when the editor is in an element's shadow root.
  if (!shadow) host.classList.add('draft-editor-root');
  // A host mounted detached has itself as its root; it styles from its document until attached.
  adoptEditorCss(shadow ? (host.getRootNode() as ShadowRoot) : host.ownerDocument);
  if (!mounted++)
    for (const [type, fn, capture] of KEYS) document.addEventListener(type, fn, capture);

  const handle: MountedEditor = {
    get ready() {
      return latest;
    },
    source: session.currentSource,
    update(next) {
      latest = session.receiveSource(next).then(settle(), error => settle({ error })());
      return latest;
    },
    geometry() {
      if (destroyed || !opened) return null;
      const at = revisionNow();
      if (geometry?.revision !== at)
        geometry = untrack(() => {
          const f = session.viewerFrame();
          return {
            revision: at,
            frame: { x: f.x, y: f.y, width: f.w, height: f.h },
            ...placedItems(session.doc, session.sceneRects(), session.routes()),
          };
        });
      return geometry;
    },
    select(ids) {
      if (destroyed) return;
      selectReason = 'api';
      session.setSelection(ids);
      // An unchanged selection fires no effect; the next user change must not read as api.
      queueMicrotask(() => (selectReason = 'user'));
    },
    selection: () => session.selectedIds(),
    anchor(slots) {
      if (destroyed) return;
      const before = anchorLayer.warnings().length;
      anchorLayer.setSlots(slots);
      // The layer saw no drawing while it had no slots.
      if (opened) anchorLayer.setGeometry(handle.geometry());
      placeAnchors();
      tellAnchors();
      if (before || anchorLayer.warnings().length) tellSlots();
    },
    getCamera: () => toCamera(session.doc.camera, session.stageSize()),
    setCamera(camera) {
      if (
        destroyed ||
        !Number.isFinite(camera.centerX) ||
        !Number.isFinite(camera.centerY) ||
        !Number.isFinite(camera.zoom) ||
        camera.zoom <= 0
      )
        return;
      moveTo(camera, session.stageSize(), 'api');
    },
    fit: (ids, frameOptions) =>
      whenSized(view => {
        const box = ids
          ? unionBox(ids.flatMap(id => boxOf(id) ?? []))
          : toBox(session.viewerFrame());
        return box ? moveTo(fitCamera(box, view, frameOptions), view, 'api') : 'missing';
      }),
    reveal: (id, frameOptions) =>
      whenSized(view => {
        const box = boxOf(id);
        return box
          ? moveTo(revealCamera(handle.getCamera(), box, view, frameOptions), view, 'api')
          : 'missing';
      }),
    on(type, listener) {
      if (destroyed) return () => {};
      const set = listeners.get(type) ?? new Set();
      set.add(listener as (event: never) => void);
      listeners.set(type, set);
      return () => set.delete(listener as (event: never) => void);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pendingMove = undefined;
      cancelAnimationFrame(firstFit);
      cancelAnimationFrame(cameraFrame);
      stopCamera();
      scheme.stop();
      emit('anchors', { anchors: [] });
      anchorLayer.destroy();
      listeners.clear();
      if (!--mounted)
        for (const [type, fn, capture] of KEYS) document.removeEventListener(type, fn, capture);
      releaseActiveSession(session);
      session.cancelLayout();
      session.closeFileSession();
      dispose();
      session.dispose();
      host.classList.remove('draft-editor', 'draft-editor-root');
      themed.removeAttribute('data-draft-scheme');
    },
  };
  sessions.set(handle, session);
  return handle;
}

export type { Camera, CameraReason, FrameOptions, MoveResult } from '../runtime/camera';
export type { Box, EdgeOut, Geometry, PlacedBox } from '../runtime/geometry';
export type { Anchor, DraftSlot } from '../runtime/anchors';
export { ZOOM_MAX, ZOOM_MIN } from '../runtime/camera';
