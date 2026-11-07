/**
 * `@draftably/solid/host`: compile, lay out and draw a diagram in a Solid app's own tree. This file
 * is the whole contract (pinned by `tests/host-entry.test.ts`); `@experimental` names may change
 * in a minor release.
 */
import { StaticScene as SceneView } from './components/scene/StaticScene';
import type { Scene } from './dsl/compile';
import { projectScene, visibleRects } from './dsl/project';
import { computeRoutes } from './model/routes';
import { buildStaticScene, type StaticScene as StaticDrawing } from './model/static-scene';
import type { JSX } from 'solid-js';

export { compile, type Diagnostic, type Scene } from './dsl/compile';
export { printSource, readSource, type SourceDoc } from './dsl/syntax';
export type { Rect } from './model/types';
export type { StaticDrawing };

/** Lay out and route a compiled scene for `StaticScene`. @experimental */
export function draw(scene: Scene): StaticDrawing {
  const doc = projectScene(scene);
  const { vg, rects } = visibleRects(doc);
  return buildStaticScene(doc, computeRoutes(doc, vg, rects, { previous: [] }).result);
}

/** Draws a `draw` result as SVG children; `idPrefix` keeps marker ids unique. @experimental */
export const StaticScene: (props: { scene: StaticDrawing; idPrefix: string }) => JSX.Element =
  SceneView;

/** @experimental */
export { resolveAppearance } from './model/appearance';

/** Text measurement as the compiler does it; load `@draftably/runtime/fonts.css`. @experimental */
export {
  measureText,
  typeProfile,
  widestPiece,
  wordPieces,
  wrapLines,
  type TypeProfile,
} from './model/fonts';
