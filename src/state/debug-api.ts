/**
 * `window.diagramStudio`: a small scripting surface for automated browser checks and the console.
 * The app itself never calls it.
 */
import { LayoutLab } from '../engines/layout-engine';
import { clone } from '../model/geometry';
import { SAMPLES } from '../model/samples';
import {
  applyCandidate,
  closeComparison,
  comparison,
  generate,
  openComparison,
} from './comparison';
import { exportSvg, importText, sceneReady } from './files';
import { svgToPng } from '../lib/svg-export';
import { measured } from '../dsl/project';
import { activeSession } from './active-session';

/** Resolves once the canvas is mounted and the open file is laid out and routed. */
async function ready(timeoutMs = 10_000) {
  const start = performance.now(),
    params = new URLSearchParams(location.search),
    opensFile = params.has('file') || params.has('example');
  for (;;) {
    const canvas = sceneReady(),
      busy =
        (opensFile && !activeSession().fileScene()) ||
        activeSession().fileCompiling() ||
        activeSession().routesPending();
    if (canvas && !busy) return;
    if (performance.now() - start > timeoutMs)
      throw Error(`Not ready after ${timeoutMs}ms: ${canvas ? 'still laying out' : 'no canvas'}.`);
    await new Promise(r => setTimeout(r, 50));
  }
}

export function installDebugApi() {
  const api = {
    ready,
    get: activeSession().snapshotDoc,
    set: (input: unknown) => activeSession().openDocument(input),
    select: (ids: string | string[], options = {}) => {
      activeSession().selectItems(Array.isArray(ids) ? ids : [ids], options);
      return activeSession().selectedIds();
    },
    addNode: activeSession().addNode,
    addEdge: activeSession().addEdge,
    extend: activeSession().quickExtend,
    fastBuild: activeSession().buildFromList,
    undo: activeSession().undo,
    redo: activeSession().redo,
    layout: activeSession().runLayout,
    preview: (options = {}) => activeSession().runLayout({ ...options, preview: true }),
    acceptPreview: activeSession().acceptPreview,
    discardPreview: activeSession().discardPreview,
    reroute: activeSession().reroute,
    algorithms: () => clone(LayoutLab.algorithms),
    samples: () => clone(SAMPLES),
    loadSample: activeSession().openSample,
    import: importText,
    /** The SVG export, once the canvas is ready. */
    exportSvg: async (...args: Parameters<typeof exportSvg>) => {
      await ready();
      return exportSvg(...args);
    },
    /** The PNG export as a data URL. */
    exportPng: async () => {
      await ready();
      const blob = await svgToPng(exportSvg());
      return await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(blob);
      });
    },
    /** The drawn emphasis state, or null; `showState(id)` draws another. */
    state: activeSession().activeState,
    showState: activeSession().showState,
    setColor: activeSession().setColor,
    setShade: activeSession().setShade,
    chooseTheme: activeSession().chooseTheme,
    setAppearanceOverrides: activeSession().setAppearanceOverrides,
    compare: openComparison,
    generateComparison: generate,
    applyCandidate,
    closeComparison,
    timeline: activeSession().openTimeline,
    scrub: activeSession().scrub,
    keepFrame: activeSession().keepStep,
    cancelTimeline: activeSession().closeTimeline,
    brush: activeSession().activateBrush,
    brushDab: activeSession().brushDab,
    /** Geometry in the same form as `pnpm draftably inspect`, for comparing browser and CLI. */
    fileGeometry: () =>
      measured(activeSession().doc, activeSession().sceneRects(), activeSession().routes()),
    fileState: () => ({
      status: activeSession().fileStatus(),
      // Laid out means routed too: a revision drawn before its full routes is still compiling here.
      compiling: activeSession().fileCompiling() || activeSession().routesPending(),
      source: activeSession().currentSource(),
      diagnostics: clone(activeSession().fileDiagnostics()),
    }),
    diagnostics: () => ({
      tool: activeSession().tool(),
      selected: activeSession().selectedIds(),
      visibleNodes: activeSession().visibleScene().nodes.length,
      visibleEdges: activeSession().visibleScene().edges.length,
      // Full routes still being drawn in a worker count as layout work.
      layoutBusy: activeSession().layoutBusy() || activeSession().routesPending(),
      preview: !!activeSession().layoutPreview(),
      layoutReport: clone(activeSession().layoutReport()),
      routingReport: clone(activeSession().routingReport()),
      routes: activeSession()
        .routes()
        .map(r => ({
          id: r.id,
          points: clone(r.points),
          fromSide: r.fromSide,
          toSide: r.toSide,
          blocked: r.blocked,
        })),
      undoDepth: activeSession().undoStack().length,
      canUndo: activeSession().canUndo(),
      canRedo: activeSession().canRedo(),
      timeline: activeSession().timeline()
        ? {
            busy: activeSession().timeline()!.busy,
            index: activeSession().timeline()!.index,
            frames: activeSession().timeline()!.data?.frames.length ?? 0,
          }
        : null,
      comparison: comparison.open
        ? {
            busy: comparison.busy,
            cells: comparison.cells.map(c => ({ title: c.title, status: c.status })),
          }
        : null,
      title: activeSession().doc.title,
    }),
  };
  Object.assign(window, { diagramStudio: Object.freeze(api) });
}
