/**
 * Draftably as a library: read and print the language, compile a source to a laid-out scene,
 * project and route it, and draw it with the scene components. None of this loads the editor's
 * state, so a host page can draw a diagram without the editor.
 *
 * The live editor (a session and its canvas) is a separate entry, `./editor`.
 */

import { ENGINES as LINE_ENGINES } from './dsl/syntax';
import { LayoutLab } from './engines/layout-engine.js';

// The language: read, print and format a source.
export {
  DslError,
  formatSource,
  parseModel,
  printSource,
  readSource,
  type Hint,
  type Model,
  type ModelEdge,
  type ModelObject,
  type SourceDoc,
  type Statement,
} from './dsl/syntax';

// What an edit did to a source, statement by statement.
export { sourceOperations, type SourceOperation } from './dsl/operations';

// Compile a source to a laid-out scene; its source diagnostics are on `scene.diagnostics`.
export {
  checkSource,
  compile,
  type Diagnostic,
  type Scene,
  type SceneEdge,
  type SceneObject,
} from './dsl/compile';

// Project a scene into a document for a view, and the geometry the routes run between.
export {
  canonicalGeometry,
  projectScene,
  visibleRects,
  type CanonicalGeometry,
  type ViewState,
} from './dsl/project';

// Make room for containers that open by warping the drawing instead of laying it out again, and
// optionally smooth what the warp leaves with a bounded local tidy.
export {
  dilate,
  warpRoutes,
  type Cut,
  type DilateOptions,
  type Dilation,
  type Opening,
  type WarpBox,
} from './dsl/dilate';
export {
  CannotMakeRoom,
  makeRoom,
  redrawBent,
  relaxRoom,
  RELAX_MAX_MOVE,
  type MadeRoom,
  type RelaxOptions,
  type RoomDrawing,
} from './dsl/make-room';
export type { Route, RoutingResult } from './engines/routing-engine.js';
// The trunks a drawing's routes run as (`routing bundle=N`, `bundle a b`), as the viewer finds them.
export { bundleCount, bundlesOf, type BundledRoute, type DrawnBundle } from './model/bundles';

// Route a projected document, and the drawing conflicts `check` reports.
export { computeRoutes, type DrawnRoute, type SceneRoutes } from './model/routes';
export { sceneConflicts } from './dsl/conflicts';
// Everything `check` reports for a compiled scene, and with `metrics` how its drawing reads.
export { checkScene, drawingNotes, type CheckOptions, type CheckResult } from './dsl/check';
export type { Drawing } from './dsl/metrics';
export { drawingScore, WEIGHTS, type DrawingScore } from './dsl/score';

// `draftably vary` as a call: layout and routing variants of a source, each compiled, routed,
// measured and drawn, ranked against the source as it is. No file is read or written.
export {
  applyEdits,
  drawScene,
  FITS,
  improves,
  vary,
  type Drawn,
  type Edit as VaryEdit,
  type Fit,
  type LineChange,
  type Measured,
  type Metrics as VaryMetrics,
  type Prefer,
  type Variant,
  type VaryOptions,
  type VaryResult,
} from './cli/variants';

// The engines a `layout` line can name, as the Arrange panel offers them: id, name, one line.
// A scope's `layout` line as settings: its recipe or engine, direction, fit, gap and fold.
export { layoutShape, type LayoutShape, type ShapeChange } from './dsl/layout-edits';
export interface LayoutEngine {
  readonly id: string;
  readonly name: string;
  readonly short: string;
}
export const LAYOUT_ENGINES: readonly LayoutEngine[] = LINE_ENGINES.map(id => {
  const one = LayoutLab.algorithms.find(a => a.id === id);
  return { id, name: one?.name ?? id, short: one?.short ?? '' };
});

// A routed document ready to draw, and the components that draw it.
export { buildStaticScene, type StaticScene as StaticDrawing } from './model/static-scene';
export { StaticScene } from './components/scene/StaticScene';
export { NodeView, type NodeViewProps } from './components/scene/NodeView';
export { GroupView, type GroupViewProps } from './components/scene/GroupView';
export { CrossingView, EdgeView, type EdgeViewProps } from './components/scene/EdgeView';
export { Lifelines, SequenceBackdrop } from './components/scene/Lifelines';
// The session the scene components read from context; a page that only draws needs none.
export { DiagramSessionProvider, useSessionIfAny } from './components/session-context';

// A document's resolved look: its palette, canvas colour and type.
export {
  resolveAppearance,
  type AppearanceLayer,
  type DiagramAppearance,
  type ResolvedAppearance,
  type ThemeId,
} from './model/appearance';

// Text measurement from the bundled faces' width tables: how the compiler wraps and sizes, so a
// host that draws text in a node can size it the same way, with no DOM.
export {
  measureText,
  typeProfile,
  widestPiece,
  wordPieces,
  wrapLines,
  type FontRole,
  type TypeProfile,
} from './model/fonts';

// A static SVG of a projected document, for thumbnails and exports.
export { renderSvg, type SvgOptions } from './cli/svg';

export type * from './model/types';
