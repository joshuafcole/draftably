/** Automatic layout: bounded passes, previewed rebuilds, and the layout lab's options. */
import { batch, createSignal } from 'solid-js';
import { LANES_HOLD } from '../../dsl/layout-edits';
import {
  LayoutLab,
  type LayoutOptions,
  type LayoutReport,
  type LayoutScope,
} from '../../engines/layout-engine.js';
import { normalize } from '../../model/document';
import { clamp, clone } from '../../model/geometry';
import { findGroup, selectionRoots } from '../../model/graph';
import { layoutShape, type LayoutShape, type ShapeChange } from '../../dsl/layout-edits';
import type {
  Diagram,
  LayoutAlgorithmId,
  NodeGeometry,
  Point,
  RoutingSettings,
} from '../../model/types';
import type { Route } from '../../engines/routing-engine.js';
import { unwrap } from 'solid-js/store';
import { CancelledError, startEngineTask, type RunningTask } from '../../lib/engine-tasks';
import { type HostArrangement, sourceScope, UnstorableLayout } from './file-session';
import { toast } from '../toast';
import type { DocumentPart } from './document';
import type { FileSessionPart } from './file-session';
import type { EditorPart } from './editor';
import type { ScenePart } from './scene';

export type LabScope = 'auto' | LayoutScope;

export interface LayoutPreview {
  before: string;
  mode: 'pass' | 'rebuild';
  /** Objects a bounded pass moved; a rebuild's preview is a new drawing, so it has no count. */
  moved?: number;
  /** In a diagram file: the source that Keep saves, the line it changes, what it says once saved. */
  file?: {
    source: string;
    label: string;
    message: string;
    line: string | null;
    removed: number;
    /** The direction and format asked for so far. A further choice builds on them. */
    shape?: ShapeChange;
    /** The connection preset asked for, which Keep saves with the shape. */
    routing?: RoutingSettings;
  };
}

export interface RunLayoutOptions extends LayoutOptions {
  preview?: boolean;
  fit?: boolean;
}

export type LayoutOutcome =
  | { status: 'busy' | 'cancelled' }
  /** A diagram file's layout recipe was previewed or saved. */
  | { status: 'recipe' | 'recipe-preview'; source: string }
  | { status: 'error'; message: string }
  | ({ status: 'complete' | 'preview' } & LayoutReport);

const engineName = (id: string) => LayoutLab.algorithms.find(a => a.id === id)?.name ?? id;

/** Recipes whose content sets every position, so moving a shape has nothing to keep. */
const SHAPED_BY_CONTENT: Record<string, string> = {
  sequence: 'Sequence diagrams follow message order.',
  cells: 'Cells follow their columns and spans.',
};

/** Recipes with a structure of their own, which an engine would replace and lose. */
const STRUCTURED: Record<string, string> = {
  ...SHAPED_BY_CONTENT,
  lanes: 'Lanes keep their rows. Another arrangement would remove them.',
};

export function createLayout(s: DocumentPart & FileSessionPart & EditorPart & ScenePart) {
  const state = (() => {
    const [busy, setBusy] = createSignal(false);
    const [report, setReport] = createSignal<LayoutReport | null>(null);
    const [preview, setPreview] = createSignal<LayoutPreview | null>(null);
    const [labScope, setLabScope] = createSignal<LabScope>('auto');
    /** In a diagram file: the engine to rebuild with, when it is not what the file says. */
    const [labEngine, setLabEngine] = createSignal<LayoutAlgorithmId | null>(null);
    const [checkpoint, setCheckpoint] = createSignal<Diagram | null>(null);
    return {
      busy,
      setBusy,
      report,
      setReport,
      preview,
      setPreview,
      labScope,
      setLabScope,
      labEngine,
      setLabEngine,
      checkpoint,
      setCheckpoint,
    };
  })();

  const {
    busy: layoutBusy,
    report: layoutReport,
    setReport: setLayoutReport,
    preview: layoutPreview,
    labScope,
    setLabScope,
    labEngine,
    setLabEngine,
    checkpoint: layoutCheckpoint,
  } = state;

  /** What a layout run applies to, based on the selection. */
  function currentScope(): { scope: LayoutScope; containerId?: string } {
    const roots = selectionRoots(s.doc, s.selection());
    if (roots.length === 1 && findGroup(s.doc, roots[0]))
      return { scope: 'container', containerId: roots[0] };
    if (roots.length) return { scope: 'selection' };
    return { scope: 'all' };
  }

  /** What Tidy positions changes now, as the menu and the toolbar say it. */
  function layoutTarget() {
    const scope = state.labScope() === 'auto' ? currentScope().scope : state.labScope();
    if (scope === 'all') return 'the whole diagram';
    if (scope === 'neighbourhood') return 'the selection and its neighbours';
    return scope === 'container' ? 'this group' : 'the selection';
  }

  /** Ids that layout must not move: brush holds. Set by the brush module. */
  let fixedIdsProvider: () => string[] = () => [];
  const setFixedIdsProvider = (provider: () => string[]) => (fixedIdsProvider = provider);
  const fixedIds = () => fixedIdsProvider();

  let running: RunningTask<{ document: Diagram; report: LayoutReport }> | null = null;
  let job = 0;
  /** The shape still compiling, so a second click stacks on it instead of replacing it. */
  let asked: ShapeChange = {};

  function cancelLayout() {
    job++;
    asked = {};
    running?.cancel();
    running = null;
    state.setBusy(false);
  }

  async function runLayout(options: RunLayoutOptions = {}): Promise<LayoutOutcome> {
    if (state.busy()) return { status: 'busy' };
    if (s.fileMode() && options.mode === 'rebuild') return runRecipe(options);
    if (s.doc.layout.sequence) {
      toast(LANES_HOLD);
      return { status: 'cancelled' };
    }
    s.prepareForEdit();
    const before = s.snapshot(),
      startRevision = s.revision(),
      thisJob = ++job,
      whole = !s.diagramClipped();
    const { preview, fit, ...overrides } = options;
    const opts: LayoutOptions = {
      ...s.doc.settings,
      ...currentScope(),
      fixedIds: fixedIds(),
      ...overrides,
      selected: overrides.selected || [...s.selection()],
      viewport: { w: s.stageSize().width, h: s.stageSize().height },
    };
    state.setBusy(true);
    try {
      LayoutLab.settings(opts);
      console.info('[layout] start', {
        algorithm: opts.algorithm,
        mode: opts.mode || 'pass',
        scope: opts.scope,
      });
      running = startEngineTask({ kind: 'layout', doc: JSON.parse(before), options: opts });
      const result = await running.promise;
      result.report.thread = running.thread();
      if (job !== thisJob || s.revision() !== startRevision) return { status: 'cancelled' };
      const old = clone(s.doc.layout.nodes);
      batch(() => {
        s.restoreDocument(normalize(result.document));
        state.setReport(result.report);
        s.resetRoutes();
      });
      if (preview) {
        state.setPreview({
          before,
          mode: result.report.mode === 'rebuild' ? 'rebuild' : 'pass',
          moved: result.report.moved,
        });
        s.setPersistenceBlocked(true);
      } else s.commit(before, 'Layout: ' + result.report.name, 'arrangement');
      await animateLayout(old, clone(s.doc.layout.nodes));
      // A preview, or a result that grew past a diagram shown whole, is fitted so all of it shows.
      if (fit || ((preview || whole) && s.diagramClipped())) s.fitView();
      const r = result.report;
      toast(
        `${r.mode === 'rebuild' ? 'Rebuild' : 'Pass'} · ${r.name} · ${r.moved} moved · max ${r.maxDisplacement}px` +
          (r.after.overlaps ? ` · ${r.after.overlaps} overlaps remain` : ''),
      );
      return { status: preview ? 'preview' : 'complete', ...r };
    } catch (error) {
      if (error instanceof CancelledError) return { status: 'cancelled' };
      const message = error instanceof Error ? error.message : String(error);
      console.error('[layout] failed', error);
      toast(message);
      return { status: 'error', message };
    } finally {
      if (thisJob === job) {
        running = null;
        state.setBusy(false);
      }
    }
  }

  /**
   * In a diagram file, a rebuild is a layout recipe: the scope's `layout` line names the engine.
   * The new source is compiled and shown exactly as the file will draw it.
   */
  async function runRecipe(options: RunLayoutOptions): Promise<LayoutOutcome> {
    const { preview, fit, ...overrides } = options;
    const fail = (message: string): LayoutOutcome => {
      toast(message);
      return { status: 'error', message };
    };
    const blocked = s.fileBlocked();
    if (blocked) return fail(blocked);
    const scope = sourceScope({ ...currentScope(), ...overrides });
    if (!scope)
      return fail(
        'A layout recipe arranges the whole diagram or one container. Select one container, or nothing.',
      );
    let next: ReturnType<typeof s.sourceWithRecipe>, settings;
    try {
      settings = LayoutLab.settings({ ...s.doc.settings, ...overrides, mode: 'rebuild' });
      next = s.sourceWithRecipe(scope, settings);
    } catch (error) {
      if (error instanceof UnstorableLayout || error instanceof Error) return fail(error.message);
      throw error;
    }
    const name = engineName(settings.algorithm),
      where = scope === 'root' ? 'the diagram' : scope;
    return showRecipe(
      {
        source: next.source,
        label: `Layout: ${name}`,
        message:
          `${where} uses ${name}` +
          (next.removed ? ` · removed ${next.removed} position refinements` : ''),
        line: s.changedLine(next.source),
        removed: next.removed,
      },
      { preview, fit },
    );
  }

  /** Show a new `layout` line on the canvas: as a preview, or saved. */
  async function showRecipe(
    file: NonNullable<LayoutPreview['file']>,
    { preview, fit }: { preview?: boolean; fit?: boolean },
  ): Promise<LayoutOutcome> {
    // One preview replaces another, so the drawing to go back to stays the first one.
    const held = preview ? state.preview() : null;
    if (!held) s.prepareForEdit();
    const before = held?.before ?? s.snapshot(),
      startRevision = s.revision(),
      thisJob = ++job,
      whole = !s.diagramClipped();
    state.setBusy(true);
    try {
      const projected = await s.projectSource(file.source);
      if (job !== thisJob || s.revision() !== startRevision) return { status: 'cancelled' };
      const old = clone(s.doc.layout.nodes);
      if (preview) {
        batch(() => {
          s.restoreDocument(projected);
          s.resetRoutes();
          state.setPreview({ before, mode: 'rebuild', file });
        });
      } else if (!(await s.commitSource(file.source, file.label, file.message)))
        return { status: 'cancelled' };
      await animateLayout(old, clone(s.doc.layout.nodes));
      // A preview, or a result that grew past a diagram shown whole, is fitted so all of it shows.
      if (fit || ((preview || whole) && s.diagramClipped())) s.fitView();
      return { status: preview ? 'recipe-preview' : 'recipe', source: file.source };
    } finally {
      if (thisJob === job) {
        state.setBusy(false);
        asked = {};
      }
    }
  }

  /** Run with the lab's scope. `mode` is a bounded pass or a full rebuild. */
  function runLabLayout(
    mode: 'pass' | 'rebuild' = 'pass',
    preview = false,
    settings: LayoutOptions = {},
  ) {
    const scope = state.labScope(),
      engine = state.labEngine();
    if (s.fileMode() && mode === 'rebuild' && !engine) return previewShape({});
    return runLayout({
      ...(scope === 'auto' ? currentScope() : { scope }),
      mode,
      preview,
      ...(engine ? { algorithm: engine } : {}),
      ...settings,
    });
  }

  /**
   * Preview a browser diagram with a new direction or format, on top of any already being previewed.
   * The settings change only with the preview, so Discard puts them back too.
   */
  async function previewSettings(patch: Partial<Pick<LayoutOptions, 'direction' | 'aspect'>>) {
    const next = {
      ...(state.preview()
        ? { direction: s.doc.settings.direction, aspect: s.doc.settings.aspect }
        : {}),
      ...patch,
    };
    cancelLayout();
    discardPreview();
    const outcome = await runLabLayout('rebuild', true, next);
    if (outcome.status === 'preview') updateLayoutSettings(next);
  }

  /** The source scope the Arrange panel acts on, or null for a loose selection. */
  function arrangeScope() {
    const scope = state.labScope();
    return sourceScope(scope === 'auto' ? currentScope() : { ...currentScope(), scope });
  }

  /** The recipes that hold here: the scope's own, and the root's, which holds a loose selection. */
  function arrangeRecipes() {
    if (!s.fileMode()) return [];
    const source = state.preview()?.file?.source ?? s.currentSource(),
      scope = arrangeScope();
    return [...new Set([scope, 'root'])].flatMap(id =>
      id ? [layoutShape(source, id).recipe] : [],
    );
  }

  const ruleFrom = (rules: Record<string, string>) =>
    arrangeRecipes()
      .map(recipe => rules[recipe])
      .find(Boolean) ?? null;

  /** Why shapes here cannot be moved by a layout tool, or null when they can. */
  const movesBlocked = () => ruleFrom(SHAPED_BY_CONTENT);

  /** Why the arrangement here cannot be replaced, or null when it can. */
  const rebuildBlocked = () => ruleFrom(STRUCTURED);

  /** A sequence draws its messages straight across, so there are no routes to choose. */
  const routesBlocked = () =>
    arrangeRecipes().includes('sequence') ? SHAPED_BY_CONTENT.sequence : null;

  /**
   * Preview a change to the scope's `layout` line, on top of any direction or format already being
   * previewed. A choice that returns to the file ends the preview. With no change, this removes the
   * scope's hand placements, so the recipe alone draws it.
   */
  async function previewShape(change: ShapeChange): Promise<LayoutOutcome> {
    const blocked = s.fileBlocked(),
      scope = arrangeScope();
    if (blocked || !scope) {
      const message = blocked ?? 'A layout line arranges the whole diagram or one group.';
      toast(message);
      return { status: 'error', message };
    }
    const file = layoutShape(s.currentSource(), scope),
      held = state.preview()?.file,
      routing = held?.routing,
      shape: ShapeChange = { ...held?.shape, ...asked, ...change };
    for (const key of Object.keys(shape) as Array<keyof LayoutShape & keyof ShapeChange>)
      if (shape[key] === file[key]) delete shape[key];
    const fresh = !Object.keys(change).length;
    if (!Object.keys(shape).length && !fresh && !routing) return endPreview();
    const next = Object.keys(shape).length || fresh ? s.sourceWithShape(scope, shape) : null;
    if (fresh && !next?.removed) {
      toast('Nothing to reset: the recipe already draws this.');
      return { status: 'cancelled' };
    }
    const source = routing
      ? s.sourceWithRouting(routing, next?.source ?? s.currentSource())
      : next!.source;
    const line = s.changedLines(source).join(' · ') || null;
    asked = shape;
    return showRecipe(
      {
        source,
        label: 'Arrange',
        message: line ?? 'Removed hand placements',
        line,
        removed: next?.removed ?? 0,
        shape,
        routing,
      },
      { preview: true },
    );
  }

  /** Preview router settings, stacked on any direction or format being previewed. */
  async function previewRouting(routing: RoutingSettings): Promise<LayoutOutcome> {
    const held = state.preview()?.file,
      source = s.sourceWithRouting(routing, held?.source);
    if (source === s.currentSource()) return endPreview();
    const line = s.changedLines(source).join(' · ') || null;
    return showRecipe(
      {
        source,
        label: 'Change routing',
        message: line ?? 'Change routing',
        line,
        removed: held?.removed ?? 0,
        shape: held?.shape,
        routing,
      },
      { preview: true },
    );
  }

  /** The choices have returned to the file, so nothing is left to show or to finish computing. */
  function endPreview(): LayoutOutcome {
    cancelLayout();
    discardPreview();
    return { status: 'cancelled' };
  }

  /** Ease shapes from their old to new positions. Edits during the animation stop it. */
  function animateLayout(from: NodeGeometry, to: NodeGeometry): Promise<void> {
    // Hidden pages get no animation frames, so skip straight to the result.
    if (s.reducedMotion() || document.hidden) return Promise.resolve();
    const startRevision = s.revision();
    return new Promise(resolve => {
      const start = performance.now();
      const frame = (now: number) => {
        if (s.revision() !== startRevision) {
          s.setAnimationGeometry(null);
          resolve();
          return;
        }
        const t = clamp((now - start) / 180, 0, 1),
          k = 1 - (1 - t) ** 3,
          nodes: NodeGeometry = {};
        for (const [id, p] of Object.entries(to)) {
          const old = from[id] || p;
          nodes[id] = {
            ...p,
            x: old.x + (p.x - old.x) * k,
            y: old.y + (p.y - old.y) * k,
            w: old.w + (p.w - old.w) * k,
            h: old.h + (p.h - old.h) * k,
          };
        }
        s.setAnimationGeometry(t < 1 ? nodes : null);
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /** How long a host-arranged change glides, and its curve: the editor's own expand motion. */
  const GLIDE_MS = 200;

  /**
   * Show a source the host placed itself (`HostArrangement`, made by `makeRoom`), gliding from the
   * drawing on screen: every shape eases to its new rectangle and every line that keeps its bends
   * eases point by point with them, so nothing is routed while it moves. A shape that is new rides
   * with its nearest container that was already drawn and fades in. With reduced motion, or on a
   * hidden page, the new drawing is shown at once; the places are the same either way.
   */
  async function receiveArranged(
    source: string,
    arrangement: HostArrangement,
    { motion = true }: { motion?: boolean } = {},
  ): Promise<{ settled: Promise<void> }> {
    const from = clone(unwrap(s.doc.layout.nodes)),
      fromRoutes = new Map(s.routing().result.routes.map(r => [r.id, clone(r)]));
    await s.receiveSource(source, { arrangement });
    if (!motion || s.reducedMotion() || document.hidden) return { settled: Promise.resolve() };
    // Resolves once the source is drawn; `settled` once the glide has ended.
    return { settled: glide(from, fromRoutes, arrangement) };
  }

  function glide(
    from: NodeGeometry,
    fromRoutes: Map<string, Route>,
    arrangement: HostArrangement,
  ): Promise<void> {
    const to = clone(unwrap(s.doc.layout.nodes)),
      parentOf = new Map(
        [...s.doc.graph.nodes, ...s.doc.graph.groups].map(o => [o.id, o.parentId] as const),
      ),
      startRevision = s.revision(),
      fresh = Object.keys(to).filter(id => !from[id]);
    /** The nearest container above `id` that was drawn before, which a new shape rides with. */
    const carrier = (id: string) => {
      for (let p = parentOf.get(id); p; p = parentOf.get(p)) if (from[p]) return p;
      return undefined;
    };
    const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
    const point = (a: Point, b: Point, k: number) => ({
      x: lerp(a.x, b.x, k),
      y: lerp(a.y, b.y, k),
    });
    fadeIn(fresh);
    return new Promise(resolve => {
      const start = performance.now();
      const frame = (now: number) => {
        if (s.revision() !== startRevision) {
          batch(() => {
            s.setAnimationGeometry(null);
            s.setAnimationRoutes(null);
          });
          resolve();
          return;
        }
        const t = clamp((now - start) / GLIDE_MS, 0, 1),
          k = 1 - (1 - t) ** 3,
          nodes: NodeGeometry = {};
        for (const [id, p] of Object.entries(to)) {
          const old = from[id];
          if (old) {
            nodes[id] = {
              ...p,
              x: lerp(old.x, p.x, k),
              y: lerp(old.y, p.y, k),
              w: lerp(old.w, p.w, k),
              h: lerp(old.h, p.h, k),
            };
            continue;
          }
          const c = carrier(id),
            was = c ? from[c] : undefined,
            now_ = c ? to[c] : undefined;
          nodes[id] =
            was && now_
              ? {
                  ...p,
                  x: p.x + lerp(was.x, now_.x, k) - now_.x,
                  y: p.y + lerp(was.y, now_.y, k) - now_.y,
                }
              : p;
        }
        const routes = arrangement.routes.routes.map(r => {
          const old = fromRoutes.get(r.id);
          return old && old.points.length === r.points.length
            ? { ...r, points: r.points.map((p, i) => point(old.points[i], p, k)) }
            : r;
        });
        batch(() => {
          s.setAnimationGeometry(t < 1 ? nodes : null);
          s.setAnimationRoutes(t < 1 ? { ...arrangement.routes, routes } : null);
        });
        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
  }

  /** Fade in what a change reveals: new shapes, and the lines that reach them. */
  function fadeIn(ids: string[]) {
    const svg = s.canvasElement(),
      fresh = new Set(ids);
    if (!svg || !fresh.size) return;
    requestAnimationFrame(() => {
      for (const el of svg.querySelectorAll<SVGGElement>('g[data-kind][data-id]')) {
        const id = el.dataset.id!,
          edge = s.doc.graph.edges.find(e => e.id === id);
        if (edge ? fresh.has(edge.from) || fresh.has(edge.to) : fresh.has(id))
          el.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: GLIDE_MS,
            easing: 'cubic-bezier(0.2, 0, 0, 1)',
            delay: 60,
          });
      }
    });
  }

  function acceptPreview() {
    const p = state.preview();
    if (!p) return;
    batch(() => {
      state.setPreview(null);
      s.setAnimationGeometry(null);
      s.setPersistenceBlocked(false);
    });
    if (p.file) void s.commitSource(p.file.source, p.file.label, p.file.message);
    else s.commit(p.before, 'Layout preview', 'arrangement');
  }

  function discardPreview() {
    const p = state.preview();
    if (!p) return;
    batch(() => {
      state.setPreview(null);
      s.setAnimationGeometry(null);
      s.setPersistenceBlocked(false);
      s.restoreDocument(normalize(JSON.parse(p.before)));
      s.resetRoutes();
    });
    s.persist();
  }

  /** While held, show the arrangement from before the previewed layout. */
  function holdPreviewBefore(held: boolean) {
    const p = state.preview();
    s.setAnimationGeometry(held && p ? (JSON.parse(p.before) as Diagram).layout.nodes : null);
  }

  /** Layout settings are preferences, not edits: they save without an undo step. */
  function updateLayoutSettings(patch: Partial<Diagram['settings']>) {
    try {
      const next = LayoutLab.settings({ ...s.doc.settings, ...patch });
      s.mutate(d => Object.assign(d.settings, next));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    }
  }

  function captureCheckpoint() {
    acceptPreview();
    state.setCheckpoint(JSON.parse(s.snapshot()));
    toast('Checkpoint captured. Restore it before trying another approach.');
  }

  /** Registered by the document actions module to avoid a circular import at startup. */
  let openDocument: (doc: Diagram, label: string) => void = () => {};
  const setDocumentOpener = (open: (doc: Diagram, label: string) => void) => (openDocument = open);

  function restoreCheckpoint() {
    const saved = state.checkpoint();
    if (!saved) return;
    discardPreview();
    openDocument(clone(saved), 'Restore layout checkpoint');
  }

  // Starting an edit keeps the previewed layout, as if Keep had been pressed.
  s.onBeforeEdit(() => acceptPreview());
  return {
    layoutBusy,
    layoutReport,
    setLayoutReport,
    layoutPreview,
    labScope,
    setLabScope,
    labEngine,
    setLabEngine,
    layoutCheckpoint,
    currentScope,
    layoutTarget,
    setFixedIdsProvider,
    fixedIds,
    cancelLayout,
    runLayout,
    runLabLayout,
    previewSettings,
    arrangeScope,
    movesBlocked,
    rebuildBlocked,
    routesBlocked,
    previewShape,
    previewRouting,
    acceptPreview,
    discardPreview,
    holdPreviewBefore,
    updateLayoutSettings,
    captureCheckpoint,
    setDocumentOpener,
    restoreCheckpoint,
    receiveArranged,
  };
}

export type LayoutPart = ReturnType<typeof createLayout>;
