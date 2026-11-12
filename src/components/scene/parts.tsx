import { For, Show } from 'solid-js';
import type { ResolvedAppearance } from '../../model/appearance';
import type { NodeLabel } from '../../model/labels';
import { markerMarkup } from '../../model/legend';
import type { Rect } from '../../model/types';
import { SceneGlyph } from '../Icon';
import { useSessionIfAny } from '../session-context';
import type { DiagramSession } from '../../state/session';

/** A shape's title: its name lines, then its detail lines a step smaller in `detailFill`. */
export function NodeTitle(props: {
  label: NodeLabel;
  look: ResolvedAppearance;
  fill: string;
  detailFill: string;
  strike?: boolean;
  fade?: number;
}) {
  const t = () => props.look.title,
    d = () => props.look.detail;
  return (
    <text
      class="node-title"
      x={props.label.x}
      y={props.label.y}
      font-size={String(t().size)}
      font-weight={String(t().weight)}
      font-family={t().family}
      fill={props.fill}
      fill-opacity={props.fade}
      text-decoration={props.strike ? 'line-through' : undefined}
      text-anchor="middle"
      dominant-baseline="central"
    >
      <For each={props.label.lines}>
        {(line, i) => (
          <tspan
            x={props.label.x}
            y={props.label.y + props.label.offsets[i()]}
            font-size={line.detail ? String(d().size) : undefined}
            font-weight={line.detail ? String(d().weight) : undefined}
            fill={line.detail ? props.detailFill : undefined}
          >
            {line.text}
          </tspan>
        )}
      </For>
    </text>
  );
}

/** The removed marker, a minus in a disc, centred at (x, y). */
export const RemovedMarker = (props: { x: number; y: number; ink: string; canvas: string }) => (
  <g
    class="removed-marker"
    pointer-events="none"
    // eslint-disable-next-line solid/no-innerhtml -- numbers and theme colors only
    innerHTML={markerMarkup(props.x, props.y, props.ink, props.canvas)}
  />
);

/** Size of the pin glyph on a placed object, in diagram px. */
export const PIN_SIZE = 12;

/** Top left of the pin inside a `w`×`h` shape: its top-left corner, inset to clear a curve or point. */
export function pinSpot(shape: string, w: number, h: number) {
  const half = PIN_SIZE / 2;
  if (shape === 'pill') return { x: h / 2 - half, y: 5 };
  // On the upper-left side, 30% (ellipse) or 18% (diamond) of the way from centre to corner.
  const k = shape === 'circle' ? 0.62 : shape === 'diamond' ? 0.36 : 0;
  if (k) return { x: w / 2 - (w / 2) * k - half, y: h / 2 - (h / 2) * k - half };
  return { x: 5, y: 5 };
}

/** The line that places `id` in the open file (`pin`, `near`, `stay` or `nudge`), if any. */
function placingLine(s: DiagramSession, id: string) {
  const h = s
    .fileScene()
    ?.model.hints.find(
      h => 'id' in h && h.id === id && ['pin', 'near', 'stay', 'nudge'].includes(h.type),
    );
  return h && { type: h.type, line: h.line };
}

/**
 * A small pin with its top left at `x`, `y`, inside the object: filled when pinned, outlined when
 * a softer line placed it. Hovering names the line. Editor chrome, not diagram content, so it
 * never reads as a label the way a text tag did.
 */
export function PositionBadge(props: {
  id: string;
  pinned: boolean;
  manual: boolean;
  x: number;
  y: number;
  /** The object's ink, so the pin reads on its fill. */
  color: string;
}) {
  const s = useSessionIfAny();
  const tip = () => {
    const placed = s && placingLine(s, props.id);
    if (placed) return `Placed by line ${placed.line} (${placed.type})`;
    return props.pinned ? 'Pinned' : 'Moved by hand';
  };
  return (
    <Show when={props.pinned || props.manual}>
      <g
        class="position-badge"
        classList={{ pinned: props.pinned }}
        color={props.color}
        aria-label={tip()}
      >
        <SceneGlyph name="pin" x={props.x} y={props.y} size={PIN_SIZE} color="currentColor" />
      </g>
    </Show>
  );
}

const HANDLES = [
  ['nw', 0, 0],
  ['n', 0.5, 0],
  ['ne', 1, 0],
  ['e', 1, 0.5],
  ['se', 1, 1],
  ['s', 0.5, 1],
  ['sw', 0, 1],
  ['w', 0, 0.5],
] as const;

const CURSORS: Record<string, string> = {
  nw: 'nwse',
  se: 'nwse',
  ne: 'nesw',
  sw: 'nesw',
  n: 'ns',
  s: 'ns',
  e: 'ew',
  w: 'ew',
};

/** Square handles that keep a constant screen size. Shapes use corners only. */
export function ResizeHandles(props: { rect: Rect; zoom: number; corners?: boolean }) {
  const size = () => 7 / props.zoom;
  return (
    <For each={HANDLES.filter(([side]) => !props.corners || side.length === 2)}>
      {([side, fx, fy]) => (
        <rect
          class="resize-handle"
          data-resize={side}
          x={props.rect.w * fx - size() / 2}
          y={props.rect.h * fy - size() / 2}
          width={size()}
          height={size()}
          rx={1 / props.zoom}
          style={{ cursor: `${CURSORS[side]}-resize` }}
          aria-label={props.corners ? 'Resize shape' : 'Resize container only'}
        />
      )}
    </For>
  );
}
