import { createMemo, Show } from 'solid-js';
import { resolveAppearance } from '../../model/appearance';
import { positionMarks, positionMarkup } from '../../model/position-marks';
import type { Diagram, Rect } from '../../model/types';

/**
 * Where changed objects were (`was-at=`, `was-size=`): ghosts of the old boxes and the hairlines
 * that pair them, drawn as `inspect --svg` draws them, over the boxes. `bounds` is what the drawing
 * covers; an old corner well outside it is drawn as a line to its edge. Nothing here moves or
 * bounds the drawing.
 */
export function PositionMarks(props: {
  doc: Diagram;
  rects: ReadonlyMap<string, Rect>;
  bounds: Rect;
}) {
  const markup = createMemo(() =>
    positionMarkup(
      props.doc,
      resolveAppearance(props.doc.appearance),
      positionMarks(props.doc, props.rects, props.bounds),
    ),
  );
  return (
    <Show when={markup()}>
      {/* Numbers, colors and escaped IDs, from the same code as the SVG export. */}
      {/* eslint-disable-next-line solid/no-innerhtml */}
      <g class="position-marks" pointer-events="none" innerHTML={markup()} />
    </Show>
  );
}
