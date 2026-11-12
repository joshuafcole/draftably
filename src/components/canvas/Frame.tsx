import { createMemo, createSignal, For, Show } from 'solid-js';
import { resolveAppearance } from '../../model/appearance';
import { MIN_FRAME_WIDTH, type DiagramFrame } from '../../model/frame';
import { headingLines, headingTypes } from '../../model/heading';
import { footnoteMarkup } from '../../model/footnote';
import { legendMarkup } from '../../model/legend';
import type { Diagram } from '../../model/types';
import { exportHref } from '../../state/links';
import { HEADING_EDIT } from '../../state/session/actions';
import { useDiagramSession } from '../session-context';

type Key = 'title' | 'subtitle';

/**
 * Where the title or subtitle line sits, or would sit once added: a missing title goes in the
 * frame's top margin, or above the subtitle; a missing subtitle goes under the title. A subtitle
 * is offered only once there is a title.
 */
export function headingSlot(doc: Diagram, frame: DiagramFrame, key: Key) {
  const look = resolveAppearance(doc.appearance),
    types = headingTypes(look),
    lines = headingLines(
      look,
      doc.appearance.heading,
      frame.heading.x,
      frame.heading.y,
      frame.heading.wrap,
    ),
    line = lines.find(l => l.key === key),
    title = lines.find(l => l.key === 'title'),
    w = Math.max(240, frame.x + frame.w - frame.heading.x - 40),
    // A wrapped subtitle edits over all its lines.
    h = types[key].lineHeight * Math.max(1, lines.filter(l => l.key === key).length);
  const y = line
    ? line.y
    : key === 'title'
      ? lines.length
        ? lines[0].y - h
        : frame.y + 2
      : title && title.y + title.type.lineHeight;
  return y === undefined ? undefined : { x: frame.heading.x, y, w, h, type: types[key] };
}

/**
 * The frame an export draws round the diagram, drawn on the canvas: the heading above the drawing
 * and the key under it, from the same geometry as `inspect --svg` and the editor's exports.
 * Double-click the title or subtitle to edit it; drag the right edge to widen the frame.
 */
export function Frame() {
  const s = useDiagramSession();
  const look = () => resolveAppearance(s.drawnAppearance());
  const frame = createMemo(s.viewerFrame);
  // Width while the right edge is dragged, before it is saved.
  const [dragW, setDragW] = createSignal<number | null>(null);
  const w = () => dragW() ?? frame().w;
  const lines = () =>
    headingLines(
      look(),
      s.doc.appearance.heading,
      frame().heading.x,
      frame().heading.y,
      frame().heading.wrap,
    );
  // Footnotes, then the key; link clicks land on the click targets `TextHits` draws over them.
  const legend = () =>
    footnoteMarkup(look(), frame().foot, frame().foot.x, frame().foot.y, href =>
      exportHref(s, href),
    ) + legendMarkup(look(), frame().key, frame().legend.x, frame().legend.y);
  const ghost = (key: Key) => {
    if (s.doc.appearance.heading?.[key] || s.inlineEditId() === HEADING_EDIT[key]) return;
    // Frame notes sit where a missing subtitle would go, as exports draw them.
    if (key === 'subtitle' && frame().notes.some(n => n.inFrame)) return;
    return headingSlot(s.doc, frame(), key);
  };
  let start = 0;
  const onEdgeDown = (e: PointerEvent) => {
    if (e.button) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    start = s.screenToWorld(e.clientX, 0).x - (frame().x + frame().w);
    setDragW(frame().w);
  };
  const onEdgeMove = (e: PointerEvent) => {
    if (dragW() === null) return;
    e.stopPropagation();
    const right = s.screenToWorld(e.clientX, 0).x - start;
    setDragW(Math.max(frame().natural, MIN_FRAME_WIDTH, right - frame().x));
  };
  const onEdgeUp = (e: PointerEvent) => {
    const next = dragW();
    if (next === null) return;
    e.stopPropagation();
    setDragW(null);
    // Back at the content's own width, the frame follows the content again.
    const width = next - frame().natural < 4 ? undefined : Math.round(next);
    if (width === s.doc.appearance.heading?.width) return;
    s.transact('Resize frame', d => {
      const heading = (d.appearance.heading ??= {});
      if (width) heading.width = width;
      else delete heading.width;
    });
  };

  return (
    <g class="diagram-frame" classList={{ resizing: dragW() !== null }}>
      <rect
        class="diagram-frame-page"
        x={frame().x}
        y={frame().y}
        width={w()}
        height={frame().h}
        fill={look().canvas}
        // The UI's line color glares on a dark drawing; there the border is the drawing's own.
        style={look().dark ? { stroke: look().group.stroke } : undefined}
      />
      <For each={lines()}>
        {line => (
          <text
            class="diagram-frame-heading"
            classList={{ editing: s.inlineEditId() === HEADING_EDIT[line.key] }}
            x={line.x}
            y={line.y + line.type.lineHeight / 2}
            dominant-baseline="central"
            font-family={line.type.family}
            font-size={String(line.type.size)}
            font-weight={String(line.type.weight)}
            fill={line.fill}
            data-text={HEADING_EDIT[line.key]}
          >
            {line.text}
          </text>
        )}
      </For>
      <For each={['title', 'subtitle'] as const}>
        {key => (
          <Show when={ghost(key)}>
            {slot => (
              <text
                class="diagram-frame-ghost"
                x={slot().x}
                y={slot().y + slot().h / 2}
                dominant-baseline="central"
                font-family={look().annotation.family}
                font-size={String(look().annotation.size)}
                fill={look().muted}
                data-text={HEADING_EDIT[key]}
              >
                {key === 'title' ? 'Double-click to add a title' : 'Double-click to add a subtitle'}
              </text>
            )}
          </Show>
        )}
      </For>
      {/* The key markup escapes its labels, as in exports. */}
      {/* eslint-disable-next-line solid/no-innerhtml */}
      <g class="diagram-frame-legend" pointer-events="none" innerHTML={legend()} />
      <rect
        class="diagram-frame-edge"
        data-frame-edge
        role="separator"
        aria-orientation="vertical"
        aria-label="Frame width. Drag to widen the frame."
        x={frame().x + w() - 6 / s.doc.camera.k}
        y={frame().y}
        width={12 / s.doc.camera.k}
        height={frame().h}
        onPointerDown={onEdgeDown}
        onPointerMove={onEdgeMove}
        onPointerUp={onEdgeUp}
        onPointerCancel={() => setDragW(null)}
      />
    </g>
  );
}
