/**
 * Draftably as a library: read and print the language, compile a source to a laid-out scene,
 * project and route it, and draw it with the scene components. None of this loads the editor's
 * state, so a host page can draw a diagram without the editor.
 */

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

// Route a projected document, and the drawing conflicts `check` reports.
export { computeRoutes, type DrawnRoute, type SceneRoutes } from './model/routes';
export { sceneConflicts } from './dsl/conflicts';

// A routed document ready to draw, and the components that draw it.
export { buildStaticScene, type StaticScene as StaticDrawing } from './model/static-scene';
export { StaticScene } from './components/scene/StaticScene';
export { NodeView, type NodeViewProps } from './components/scene/NodeView';
export { GroupView, type GroupViewProps } from './components/scene/GroupView';
export { CrossingView, EdgeView, type EdgeViewProps } from './components/scene/EdgeView';
export { Lifelines, SequenceBackdrop } from './components/scene/Lifelines';
export { SceneHostContext, type PlacingLine, type SceneHost } from './components/scene/host';

// A document's resolved look: its palette, canvas colour and type.
export { resolveAppearance, type ResolvedAppearance } from './model/appearance';

// A static SVG of a projected document, for thumbnails and exports.
export { renderSvg, type SvgOptions } from './cli/svg';

export type * from './model/types';
