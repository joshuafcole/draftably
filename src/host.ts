/**
 * `@draftably/solid/host`: the compiler, the layout and the scene drawing, for a Solid app that
 * composes them in its own tree, on its own Solid. `@draftably/runtime` renders a finished
 * diagram to SVG or mounts a viewer that brings its own Solid; this entry hands a host the pieces
 * instead, so it can lay a diagram out, read what was laid out, and draw it inside its own
 * components.
 *
 * This file is the whole contract. Everything it exports is named in `tests/host-entry.test.ts`,
 * so the surface cannot grow by accident. Exports marked `@experimental` may change in a minor
 * release; the rest change only in a major one. The data a function returns (`Scene`,
 * `StaticDrawing`, `SourceDoc`) is read-only, and its fields are experimental throughout.
 *
 * Text is measured against the bundled faces; load them in the page with
 * `@draftably/runtime/fonts.css`. For a standalone SVG of a source, use `renderSvg` from
 * `@draftably/runtime`.
 */
import { StaticScene as SceneView } from './components/scene/StaticScene';
import type { Scene } from './dsl/compile';
import { projectScene, visibleRects } from './dsl/project';
import { computeRoutes } from './model/routes';
import { buildStaticScene, type StaticScene as StaticDrawing } from './model/static-scene';
import type { JSX } from 'solid-js';

/** Read, print and compile a `.draft` source: the language, as the CLI reads and writes it. */
export { compile, type Diagnostic, type Scene } from './dsl/compile';
export { printSource, readSource, type SourceDoc } from './dsl/syntax';
export type { Rect } from './model/types';
export type { StaticDrawing };

/**
 * A compiled scene projected with its own settings, routed, and packed for `StaticScene`.
 *
 * @experimental
 */
export function draw(scene: Scene): StaticDrawing {
  const doc = projectScene(scene);
  const { vg, rects } = visibleRects(doc);
  return buildStaticScene(doc, computeRoutes(doc, vg, rects, { previous: [] }).result);
}

/**
 * Draws a `draw` result as SVG children, in the host's own `<svg>`. `idPrefix` keeps the
 * drawing's marker ids apart from any other drawing on the page.
 *
 * @experimental
 */
export const StaticScene: (props: { scene: StaticDrawing; idPrefix: string }) => JSX.Element =
  SceneView;

/**
 * A document's resolved look: its palette, canvas colour, spacing and type. With no argument,
 * the default theme's.
 *
 * @experimental
 */
export { resolveAppearance } from './model/appearance';

/**
 * Text measurement from the bundled faces' width tables, as the compiler wraps and sizes, so a
 * host that draws text in a node can size it the same way, with no DOM.
 *
 * @experimental
 */
export {
  measureText,
  typeProfile,
  widestPiece,
  wordPieces,
  wrapLines,
  type TypeProfile,
} from './model/fonts';
