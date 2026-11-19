/**
 * Compare: generate several layout or routing candidates from one frozen starting document,
 * inspect them side by side or overlaid, and apply one as a single undo step.
 * Candidates never touch the editor until Apply.
 */
import { batch, createMemo, createRoot } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import {
  ExplorerLab,
  type CandidateResult,
  type ComparisonConfig,
  type ComparisonMode,
} from '../engines/explorer-engine';
import { LANES_HOLD } from '../dsl/layout-edits';
import { holdSlots, measure, pickCandidates, type Measure } from '../model/candidates';
import { documentIdentity, normalize, routingFingerprint } from '../model/document';
import { clamp, clone, rectUnion } from '../model/geometry';
import { findGroup, findNode } from '../model/graph';
import { fitCamera, type ViewCamera } from '../model/camera';
import { anchorPoint, buildStaticScene, type StaticScene } from '../model/static-scene';
import type { Diagram, IntentRole } from '../model/types';
import { CancelledError, inPool, startEngineTask, type RunningTask } from '../lib/engine-tasks';
import { toast } from './toast';
import { closeMenu } from './ui';
import { sourceScope } from './session/file-session';
import { LayoutLab } from '../engines/layout-engine';
import { RouteLab } from '../engines/routing-engine';
import type { CandidateSpec } from '../engines/explorer-engine';
import { activeSession } from './active-session';

const CURRENT: CandidateSpec = {
  key: 'current',
  title: 'Current drawing',
  subtitle: '',
  patch: {},
};

export type Presentation = 'grid' | 'overlay';
export type CameraMode = 'sync' | 'focus' | 'independent';
export type { ViewCamera };

export interface Candidate {
  title: string;
  subtitle: string;
  status: 'pending' | 'ready' | 'error';
  error?: string;
  /** The drawing as it is now. The others are read against it, and it has nothing to apply. */
  current?: boolean;
  measure?: Measure;
  result?: CandidateResult;
  /** In a diagram file: the source this candidate compiles from, which Apply saves. */
  source?: string;
  scene?: StaticScene;
  camera: ViewCamera;
  layer: { visible: boolean; opacity: number; adjusted: boolean };
}

interface ComparisonState {
  open: boolean;
  baseline: Diagram | null;
  signature: string;
  config: ComparisonConfig | null;
  generatedConfig: ComparisonConfig | null;
  cells: Candidate[];
  presentation: Presentation;
  controlsHidden: boolean;
  overlay: { camera: ViewCamera; active: number; allLabels: boolean };
  cameraMode: CameraMode;
  focusId: string;
  shared: ViewCamera;
  busy: boolean;
  progress: { text: string; error: boolean };
  expanded: number | null;
  /** Every candidate is on screen, not only the few chosen to show. */
  showAll: boolean;
  userCameraMoved: boolean;
  /** Measured size of each candidate viewport; index -1 is the overlay. */
  viewports: Record<number, { width: number; height: number }>;
}

/** Alternatives shown beside the current drawing. More shows the rest. */
const SHOWN = 3;
/** Every engine runs, as only the ones worth seeing reach the screen. The study's best go first. */
const COMPARE_ORDER = [
  'boundary-align',
  'tidy',
  'force',
  'layered',
  'tree',
  'grid',
  'compound-flow',
  'flow',
  'compound-spring',
  'stress',
] as const;
export const LAYER_COLORS = [
  '#5263d6',
  '#d37b28',
  '#188c83',
  '#c64e83',
  '#7f56b5',
  '#5b861f',
  '#3b82b5',
  '#96624d',
  '#267969',
  '#ad5273',
  '#5d6398',
  '#896d21',
];
const MIN_K = 0.015;
const MAX_K = 6;

const initial = (): ComparisonState => ({
  open: false,
  baseline: null,
  signature: '',
  config: null,
  generatedConfig: null,
  cells: [],
  presentation: 'grid',
  controlsHidden: true,
  overlay: { camera: { cx: 0, cy: 0, k: 1 }, active: 0, allLabels: false },
  cameraMode: 'independent',
  focusId: '',
  shared: { cx: 0, cy: 0, k: 1 },
  busy: false,
  progress: { text: '', error: false },
  expanded: null,
  showAll: false,
  userCameraMoved: false,
  viewports: {},
});

const [cmp, setCmp] = createRoot(() => createStore<ComparisonState>(initial()));
export const comparison = cmp;

interface Sheet {
  shown: number[];
  others: number[];
  failed: number[];
  alike: number;
}

const scored = (i: number) => {
  const { measure, scene } = cmp.cells[i];
  return measure && scene ? { index: i, measure, scene } : null;
};

/** Which candidates to show: the current drawing, the best few, and the count of the rest. */
export const comparisonSheet = createRoot(() =>
  createMemo<Sheet>(
    before => {
      const cells = cmp.cells,
        all = cells.map((_, i) => i);
      const current = cells.findIndex(c => c.current);
      const failed = all.filter(i => cells[i].status === 'error');
      const pending = all.filter(i => cells[i].status === 'pending' && i !== current);
      // A parameter grid is read as a whole, and failures need a place to be seen.
      if (current < 0 || cells[current].status === 'error')
        return { shown: all, others: [], failed, alike: 0 };
      const base = scored(current);
      if (!base)
        return {
          shown: [current, ...pending.slice(0, SHOWN)],
          others: pending.slice(SHOWN),
          failed,
          alike: 0,
        };
      const ready = all.flatMap(i => (i !== current && scored(i) ? [scored(i)!] : []));
      const pick = pickCandidates(base, ready, SHOWN);
      // During a run a drawn card keeps its slot, so Apply stays on what is being read. The run's
      // end re-ranks once, and any card that is still chosen stays where it is.
      const worthShowing = [...pick.shown, ...pick.others],
        slots = before.shown.filter(i => i !== current),
        keep = cmp.busy
          ? slots.filter(i => cells[i]?.status === 'ready' && worthShowing.includes(i))
          : slots.filter(i => pick.shown.includes(i));
      const shown = holdSlots(slots, keep, [...pick.shown, ...pending], SHOWN);
      return {
        shown: [current, ...shown],
        others: [...worthShowing.filter(i => !shown.includes(i)), ...failed],
        failed,
        alike: pick.alike,
      };
    },
    { shown: [], others: [], failed: [], alike: 0 },
  ),
);

/** Candidates on screen, in order. */
export const shownCells = () => {
  const sheet = comparisonSheet();
  return cmp.showAll ? [...sheet.shown, ...sheet.others] : sheet.shown;
};

export const toggleShowAll = () => {
  setCmp('showAll', on => !on);
  requestAnimationFrame(() => fitAll());
};

function defaultConfig(mode: ComparisonMode): ComparisonConfig {
  const scope = activeSession().currentScope();
  return {
    fixedIds: activeSession().fixedIds(),
    intent: clone(activeSession().doc.layout.intent || {}),
    mode,
    kind: mode === 'routing' ? 'routes' : 'algorithms',
    algorithm: activeSession().doc.settings.algorithm,
    algorithms: [...COMPARE_ORDER],
    axisA: mode === 'routing' ? 'edgeGap' : 'nodeGap',
    valuesA: mode === 'routing' ? '10,18,28' : '12,24,44',
    axisB: mode === 'routing' ? 'bendPenalty' : 'direction',
    valuesB: mode === 'routing' ? '16,64' : 'RIGHT,DOWN',
    run: 'rebuild',
    maxIterations: 640,
    scope: scope.scope === 'container' ? 'container' : 'all',
    autoPorts: false,
    selected: [...activeSession().selection()],
    ...(scope.scope === 'container' ? { containerId: scope.containerId } : {}),
    viewport: { w: activeSession().stageSize().width, h: activeSession().stageSize().height },
    priorRoutes: activeSession()
      .routes()
      .map(r => ({ id: r.id, fromSide: r.fromSide, toSide: r.toSide })),
  };
}

const setProgress = (text: string, error = false) => setCmp('progress', { text, error });

/**
 * In a diagram file, rebuild and routing candidates are source variants: the file with a
 * different layout recipe or routing line, compiled exactly as the file would be.
 * Returns null for runs that start from the current drawing (warm starts and passes).
 */
function candidateSource(baseline: Diagram, spec: CandidateSpec, config: ComparisonConfig) {
  if (!activeSession().fileMode()) return null;
  if (config.mode === 'routing')
    return activeSession().sourceWithRouting(
      RouteLab.settings({ ...baseline.settings.routing, ...spec.patch }),
    );
  if (config.run !== 'rebuild') return null;
  const scope = sourceScope(config);
  if (!scope)
    throw Error('A layout line arranges the whole diagram or one group, not a selection.');
  const settings = LayoutLab.settings({ ...baseline.settings, ...spec.patch, mode: 'rebuild' });
  const asked = spec.patch.direction;
  const direction = asked ? (asked === 'DOWN' ? 'down' : 'right') : undefined;
  return activeSession().sourceWithRecipe(scope, settings, direction).source;
}

export function openComparison(mode: ComparisonMode = 'layout') {
  activeSession().prepareForEdit();
  const blocked = activeSession().fileMode() && activeSession().fileBlocked();
  if (blocked) {
    toast(blocked);
    return;
  }
  if (activeSession().layoutPreview()) {
    toast('Keep or discard the current layout preview before comparing.');
    return;
  }
  activeSession().finishInlineEdit(true);
  if (activeSession().layoutBusy()) activeSession().cancelLayout();
  closeMenu();
  if (cmp.open) {
    setCmp('config', { ...defaultConfig(mode), priorRoutes: cmp.config!.priorRoutes });
    return;
  }
  const baseline = JSON.parse(activeSession().snapshot()) as Diagram;
  setCmp(
    reconcile({
      ...initial(),
      open: true,
      baseline,
      signature: documentIdentity(baseline),
      config: defaultConfig(mode),
      focusId:
        [...activeSession().selection()].find(
          id => findNode(activeSession().doc, id) || findGroup(activeSession().doc, id),
        ) ||
        activeSession().doc.layout.intent?.start?.id ||
        activeSession().doc.graph.nodes[0]?.id ||
        '',
    }),
  );
  // One click opens and generates the default sheet. Later changes regenerate only on request.
  void generate();
}

const running = new Set<RunningTask<CandidateResult>>();
let job = 0;

export function cancelGeneration() {
  if (!cmp.open) return;
  job++;
  for (const task of running) task.cancel();
  running.clear();
  if (cmp.busy) {
    setCmp('busy', false);
    setProgress(`Stopped · ${cmp.cells.filter(c => c.status === 'ready').length} ready`);
  }
}

let returnFocus: Element | null = null;
export const rememberFocus = (el: Element | null) => (returnFocus = el);

export function closeComparison() {
  if (!cmp.open) return;
  cancelGeneration();
  setCmp(reconcile(initial()));
  activeSession().setTool('select');
  if (returnFocus instanceof HTMLElement && returnFocus.isConnected)
    returnFocus.focus({ preventScroll: true });
}

export function updateConfig(patch: Partial<ComparisonConfig>) {
  setCmp('config', c => ({ ...c!, ...patch }));
  if (cmp.cells.length) setProgress('Settings changed. Regenerate to see them.');
}

/** Switch between layout and routing comparisons, from the same frozen starting point. */
export function setComparisonMode(mode: ComparisonMode) {
  cancelGeneration();
  setCmp('config', {
    ...defaultConfig(mode),
    intent: clone(cmp.config?.intent || {}),
    priorRoutes: cmp.config!.priorRoutes,
  });
  void generate();
}

export async function generate(override?: Partial<ComparisonConfig>) {
  if (!cmp.open || !cmp.baseline) return;
  cancelGeneration();
  const config: ComparisonConfig = clone({ ...cmp.config!, ...override });
  let specs;
  try {
    specs = ExplorerLab.specs(config);
    if (cmp.baseline.graph.nodes.length > 160 || cmp.baseline.graph.edges.length > 360)
      throw Error('Compare handles up to 160 shapes and 360 lines.');
    if (config.scope === 'selection' && !config.selected.length)
      throw Error('Select shapes before you open Compare.');
    if (config.scope === 'container' && !config.containerId)
      throw Error('Select one group before you open Compare.');
  } catch (error) {
    setProgress(error instanceof Error ? error.message : String(error), true);
    return { status: 'error' };
  }
  // A grid is one experiment, so it needs no current drawing to read each cell against.
  if (config.kind !== 'parameters') specs.unshift(CURRENT);
  const thisJob = ++job;
  setCmp(
    produce(s => {
      s.config = config;
      s.generatedConfig = clone(config);
      s.busy = true;
      s.expanded = null;
      s.showAll = false;
      s.userCameraMoved = false;
      s.overlay.active = 0;
      s.cells = specs.map((spec, i) => ({
        title: spec.title,
        subtitle: spec.subtitle,
        status: 'pending',
        ...(spec === CURRENT ? { current: true } : {}),
        camera: { cx: 0, cy: 0, k: 1 },
        layer: { visible: true, opacity: i === 0 ? 0.85 : 0.3, adjusted: false },
      }));
    }),
  );
  const started = performance.now(),
    baseline = cmp.baseline;
  const settled = () => cmp.cells.filter(c => c.status !== 'pending').length;
  const compute = async (i: number) => {
    if (thisJob !== job) return;
    let task: RunningTask<CandidateResult> | undefined;
    try {
      const current = specs[i] === CURRENT,
        source = current
          ? activeSession().fileMode() && activeSession().currentSource()
          : candidateSource(baseline, specs[i], config);
      task = source
        ? startEngineTask({ kind: 'source', source, spec: specs[i] }, { timeout: 30000 })
        : startEngineTask(
            {
              kind: 'candidate',
              baseline: clone(baseline),
              spec: specs[i],
              // Routing alone draws the baseline as it stands, with nothing rearranged.
              config: current ? { ...config, mode: 'routing' } : config,
            },
            { timeout: 30000 },
          );
      running.add(task);
      const result = await task.promise;
      if (thisJob !== job) return;
      const scene = buildStaticScene(result.document, result.routing);
      setCmp('cells', i, {
        status: 'ready',
        result,
        scene,
        measure: measure(scene, result.routing),
        ...(source && !current ? { source } : {}),
      });
      if (cmp.presentation === 'grid') fitCell(i);
    } catch (error) {
      if (error instanceof CancelledError || thisJob !== job) return;
      const message = error instanceof Error ? error.message : String(error);
      setCmp('cells', i, { status: 'error', error: message });
      console.warn('[compare] candidate failed', specs[i].key, message);
    } finally {
      if (task) running.delete(task);
    }
    if (thisJob === job) setProgress(`Computing · ${settled()} of ${specs.length} done`);
  };
  setProgress(`Computing · 0 of ${specs.length} done`);
  // The current drawing comes first: every other card is read against it, and it sets the grid.
  const first = specs[0] === CURRENT ? 1 : 0;
  if (first) await compute(0);
  await inPool(specs.length - first, n => compute(n + first));
  if (thisJob !== job) return { status: 'cancelled' };
  const ready = cmp.cells.filter(c => c.status === 'ready').length;
  setCmp('busy', false);
  setProgress('');
  console.info('[compare] generated', {
    ready,
    total: specs.length,
    ms: Math.round(performance.now() - started),
  });
  if (!cmp.userCameraMoved) requestAnimationFrame(() => fitAll());
  return { status: 'complete', ready, total: specs.length };
}

/** Apply a candidate to the editor as one undo step. */
export function applyCandidate(i: number) {
  const cell = cmp.cells[i];
  if (!cmp.open || cell?.status !== 'ready' || !cell.result) return false;
  if (documentIdentity(activeSession().doc) !== cmp.signature) {
    setProgress(
      'The editor changed after this snapshot. Close and reopen Compare to avoid overwriting newer edits.',
      true,
    );
    return false;
  }
  // Rebuild and routing candidates save a recipe line; warm-start and pass candidates depend on
  // the current drawing and are saved as positions, like any other arrangement.
  if (activeSession().fileMode() && cell.source)
    return applyToFile({ ...cell, source: cell.source });
  if (activeSession().fileMode() && activeSession().fileBlocked()) {
    setProgress(activeSession().fileBlocked()!, true);
    return false;
  }
  if (activeSession().doc.layout.sequence) {
    setProgress(LANES_HOLD, true);
    return false;
  }
  const winner = normalize(clone(cell.result.document)),
    routing = clone(cell.result.routing),
    report = cell.result.report && clone(cell.result.report),
    label = cell.title,
    camera = { ...activeSession().doc.camera };
  closeComparison();
  activeSession().transact(
    'Apply comparison: ' + label,
    d => {
      Object.assign(d, winner);
      d.camera = camera;
    },
    'arrangement',
  );
  batch(() => {
    activeSession().setSelection([]);
    activeSession().setConnectFrom(null);
    activeSession().resetRoutes();
    activeSession().setAdoptedRoutes({
      fingerprint: routingFingerprint(activeSession().doc),
      result: routing,
    });
    activeSession().setLayoutReport(report);
  });
  requestAnimationFrame(() => activeSession().fitView());
  toast('Applied ' + label + ' · one undo restores your starting diagram');
  return true;
}

/** The `layout` or `routing` line a file candidate writes, as Apply would save it. */
export const candidateChange = (source: string) =>
  activeSession().changedLine(source) ?? 'Same as the file';

/** Save a file candidate's source: its layout recipe or routing line. */
function applyToFile(cell: Candidate & { source: string }) {
  const label =
    cell.title +
    (cell.subtitle && cell.subtitle !== 'One-parameter sweep' ? ` · ${cell.subtitle}` : '');
  const blocked = activeSession().fileBlocked();
  if (blocked) {
    setProgress(blocked, true);
    return false;
  }
  const source = cell.source;
  closeComparison();
  activeSession().setSelection([]);
  void activeSession()
    .commitSource(source, 'Apply comparison: ' + label, label)
    .then(saved => saved && requestAnimationFrame(() => activeSession().fitView()));
  return true;
}

// --- Cameras ---------------------------------------------------------------------------------

let refitQueued = false;

/** Record a viewport's size. Until the user moves a camera, every resize refits the views. */
export function setViewport(i: number, size: { width: number; height: number }) {
  setCmp('viewports', i, size);
  if (cmp.userCameraMoved || refitQueued) return;
  refitQueued = true;
  queueMicrotask(() => {
    refitQueued = false;
    fitAll();
  });
}

export function anchorFor(i: number) {
  const scene = cmp.cells[i]?.scene;
  return scene ? anchorPoint(scene, cmp.focusId) : { x: 0, y: 0 };
}

/** The camera a candidate is actually drawn with, given the camera mode. */
export function effectiveCamera(i: number): ViewCamera {
  if (i === -1) return cmp.overlay.camera;
  if (cmp.cameraMode === 'independent') return cmp.cells[i].camera;
  if (cmp.cameraMode === 'sync') return cmp.shared;
  const c = anchorFor(i);
  return { cx: c.x + cmp.shared.cx, cy: c.y + cmp.shared.cy, k: cmp.shared.k };
}

/** Ready candidates that are on screen: the shown ones, or only the enlarged one. */
export const visibleReadyCells = () =>
  (cmp.expanded === null ? shownCells() : [cmp.expanded])
    .map(i => ({ cell: cmp.cells[i], i }))
    .filter(({ cell }) => cell.status === 'ready');

export function fitCell(i: number) {
  const cell = cmp.cells[i];
  if (cell?.status !== 'ready' || !cell.scene) return;
  const camera = fitCamera(cell.scene.bounds, cmp.viewports[i]);
  if (!camera) return;
  setCmp('cells', i, 'camera', camera);
  if (cmp.cameraMode !== 'independent' && cmp.cells.filter(c => c.status === 'ready').length === 1)
    fitAll();
}

export function fitAll() {
  if (!cmp.open) return;
  if (cmp.presentation === 'overlay') return fitOverlay();
  const ready = visibleReadyCells();
  if (!ready.length) return;
  setCmp(
    produce(s => {
      for (const { i, cell } of ready) {
        const camera = fitCamera(cell.scene!.bounds, s.viewports[i]);
        if (camera) s.cells[i].camera = camera;
      }
      if (s.cameraMode === 'sync') {
        const bounds = rectUnion(ready.map(({ cell }) => cell.scene!.bounds)),
          c = { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
        let k = 2;
        for (const { i } of ready) {
          const r = s.viewports[i];
          if (r?.width && r?.height)
            k = Math.min(
              k,
              (r.width - 36) / Math.max(1, bounds.w),
              (r.height - 36) / Math.max(1, bounds.h),
            );
        }
        s.shared = { cx: c.x, cy: c.y, k: clamp(k, MIN_K, 2) };
      } else if (s.cameraMode === 'focus') {
        if (s.expanded !== null) {
          const { i, cell } = ready[0],
            b = cell.scene!.bounds,
            f = anchorFor(i);
          s.shared = { cx: b.x + b.w / 2 - f.x, cy: b.y + b.h / 2 - f.y, k: s.cells[i].camera.k };
        } else
          s.shared = {
            cx: 0,
            cy: 0,
            k: Math.min(...ready.map(({ i }) => s.cells[i].camera.k)) * 1.8,
          };
      }
    }),
  );
}

export function fitOverlay() {
  const rects = cmp.cells.flatMap((c, i) => {
    if (c.status !== 'ready' || !c.layer.visible || !c.scene) return [];
    const a = anchorFor(i);
    return [{ ...c.scene.bounds, x: c.scene.bounds.x - a.x, y: c.scene.bounds.y - a.y }];
  });
  const r = cmp.viewports[-1];
  if (!rects.length || !r?.width) return;
  const b = rectUnion(rects),
    k = clamp(Math.min((r.width - 56) / b.w, (r.height - 56) / b.h), MIN_K, 2);
  setCmp('overlay', 'camera', { cx: b.x + b.w / 2, cy: b.y + b.h / 2, k });
}

export function setCamera(i: number, next: ViewCamera) {
  const k = clamp(next.k, MIN_K, MAX_K);
  setCmp(
    produce(s => {
      s.userCameraMoved = true;
      if (i === -1) s.overlay.camera = { ...next, k };
      else if (s.cameraMode === 'independent') s.cells[i].camera = { ...next, k };
      else if (s.cameraMode === 'sync') s.shared = { ...next, k };
      else {
        const c = anchorFor(i);
        s.shared = { cx: next.cx - c.x, cy: next.cy - c.y, k };
      }
    }),
  );
}

export function panCamera(i: number, dx: number, dy: number) {
  const c = effectiveCamera(i);
  setCamera(i, { ...c, cx: c.cx - dx / c.k, cy: c.cy - dy / c.k });
}

/** Zoom around a point given relative to the viewport center. */
export function zoomCamera(i: number, factor: number, dx = 0, dy = 0) {
  const c = effectiveCamera(i),
    k = clamp(c.k * factor, MIN_K, MAX_K);
  setCamera(i, { cx: c.cx + dx / c.k - dx / k, cy: c.cy + dy / c.k - dy / k, k });
}

export function actualSize() {
  setCmp(
    produce(s => {
      s.shared.k = 1;
      s.overlay.camera.k = 1;
      s.cells.forEach(c => (c.camera.k = 1));
    }),
  );
}

export function setCameraMode(mode: CameraMode) {
  const ready = cmp.cells.findIndex(c => c.status === 'ready'),
    old = ready >= 0 ? { ...effectiveCamera(ready) } : null;
  setCmp(
    produce(s => {
      if (mode === 'independent')
        s.cells.forEach((c, i) => {
          if (c.status === 'ready') c.camera = { ...effectiveCamera(i) };
        });
      s.cameraMode = mode;
      if (mode === 'focus') s.shared = { cx: 0, cy: 0, k: Math.max(0.2, old?.k || 0.6) };
      else if (mode === 'sync' && old) s.shared = old;
    }),
  );
}

// --- Presentation ----------------------------------------------------------------------------

let controlsBeforeOverlay = true;

export function setPresentation(mode: Presentation) {
  if (mode === cmp.presentation) return;
  setCmp('presentation', mode);
  // The overlay's layers are listed in the controls. Leaving it puts the controls back.
  if (mode === 'overlay') controlsBeforeOverlay = cmp.controlsHidden;
  setCmp('controlsHidden', mode === 'overlay' ? false : controlsBeforeOverlay);
  requestAnimationFrame(() => fitAll());
}

export const toggleControls = () => {
  setCmp('controlsHidden', hidden => !hidden);
  requestAnimationFrame(() => fitAll());
};

export function toggleExpanded(i: number) {
  setCmp('expanded', current => (current === i ? null : i));
  requestAnimationFrame(() => fitAll());
}

/** Center every candidate (and the overlay) on the same object. Display only. */
export function chooseAnchor(id: string) {
  const baseline = cmp.baseline;
  if (!baseline || ![...baseline.graph.nodes, ...baseline.graph.groups].some(n => n.id === id))
    return;
  setCmp(
    produce(s => {
      s.focusId = id;
      if (s.cameraMode === 'focus') {
        s.shared.cx = 0;
        s.shared.cy = 0;
      }
      s.overlay.camera.cx = 0;
      s.overlay.camera.cy = 0;
    }),
  );
}

export function emphasizeLayer(i: number) {
  setCmp(
    produce(s => {
      const previous = s.cells[s.overlay.active];
      if (previous && !previous.layer.adjusted) previous.layer.opacity = 0.3;
      s.overlay.active = i;
      s.cells[i].layer.visible = true;
      if (!s.cells[i].layer.adjusted) s.cells[i].layer.opacity = 0.85;
    }),
  );
}

export const setLayerVisible = (i: number, visible: boolean) =>
  setCmp('cells', i, 'layer', 'visible', visible);
export const setLayerOpacity = (i: number, opacity: number) =>
  setCmp('cells', i, 'layer', { opacity: clamp(opacity, 0.05, 1), adjusted: true });
export const setAllLabels = (on: boolean) => setCmp('overlay', 'allLabels', on);

/** Choose the clicked shape as the preferred start or end for the next generation. */
export function setComparisonIntent(role: IntentRole, clear = false) {
  if (!cmp.config || !cmp.baseline) return;
  const intent = clone(cmp.config.intent || {});
  if (clear) delete intent[role];
  else {
    if (!cmp.baseline.graph.nodes.some(n => n.id === cmp.focusId)) return;
    const other = role === 'start' ? 'end' : 'start';
    if (intent[other]?.id === cmp.focusId) delete intent[other];
    intent[role] = { id: cmp.focusId, placement: role === 'start' ? 'top-left' : 'bottom-right' };
  }
  setCmp('config', 'intent', intent);
  setProgress(
    'Drawing intent changed. Generate to compare it; existing candidates have not changed.',
  );
}

export function setIntentPlacement(
  role: IntentRole,
  placement: NonNullable<ComparisonConfig['intent'][IntentRole]>['placement'],
) {
  setCmp('config', 'intent', role, p => (p ? { ...p, placement } : p));
  setProgress('Drawing intent changed. Generate to preview; the working diagram is untouched.');
}

/** Column count that keeps candidates as large as possible. */
export function gridColumns(size: { width: number; height: number }) {
  const shown = shownCells(),
    count = cmp.expanded !== null ? 1 : Math.max(1, shown.length);
  if (!size.width || !size.height) return 1;
  let cols = count === 1 ? 1 : Math.min(count, 3);
  if (count <= 4) cols = Math.min(count, 2);
  if (size.width < 660 && count > 2) cols = 2;
  if (count > 9) cols = 4;
  // The current drawing alone sets the shape, so the grid does not reflow as results arrive.
  const anchor = cmp.cells.find(c => c.current && c.scene),
    ready = anchor
      ? [anchor]
      : shown.map(i => cmp.cells[i]).filter(c => c.status === 'ready' && c.scene);
  if (ready.length && cmp.expanded === null) {
    let best = -Infinity;
    for (let cc = 1; cc <= Math.min(count, 4); cc++) {
      const rr = Math.ceil(count / cc),
        w = (size.width - 20 - (cc - 1) * 10) / cc - 38,
        h = (size.height - 20 - (rr - 1) * 10) / rr - 126;
      if (w < 80 || h < 36) continue;
      const score =
        (ready.reduce(
          (sum, c) =>
            sum + Math.min(w / Math.max(1, c.scene!.bounds.w), h / Math.max(1, c.scene!.bounds.h)),
          0,
        ) /
          ready.length) *
        (0.96 + (0.04 * count) / (cc * rr));
      if (score > best) {
        best = score;
        cols = cc;
      }
    }
  }
  const c = cmp.generatedConfig;
  if (c?.kind === 'parameters' && cmp.expanded === null) {
    try {
      cols = ExplorerLab.parseValues(c.axisA, c.valuesA, c.mode).length;
    } catch {
      // Keep the computed column count.
    }
  }
  return cols;
}

export function experiment() {
  if (!cmp.open) return null;
  return clone({
    format: 'diagram-studio/experiment',
    version: 1,
    baseline: cmp.baseline,
    config: cmp.generatedConfig || cmp.config,
    cameraMode: cmp.cameraMode,
    focusId: cmp.focusId,
    presentation: cmp.presentation,
    overlay: cmp.overlay,
    layers: cmp.cells.map(c => c.layer),
    candidates: cmp.cells.filter(c => c.status === 'ready').map(c => c.result),
  });
}
