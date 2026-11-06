import { For, Show } from 'solid-js';
import type { TypeProfile } from '../../model/fonts';
import { markerMarkup } from '../../model/legend';
import type { Rect } from '../../model/types';
import { SceneGlyph } from '../Icon';
import { useSceneHost } from './host';

/** Multi-line, vertically centered text in one of the diagram's type profiles. */
export function SceneText(props: {
  lines: string[];
  x: number;
  y: number;
  lineHeight: number;
  type: TypeProfile;
  fill: string;
  class?: string;
  /** Strike the text through, as for a removed object. */
  strike?: boolean;
  /** Fade of the text alone, as for a removed object. */
  fade?: number;
}) {
  const first = () => props.y - ((props.lines.length - 1) * props.lineHeight) / 2;
  return (
    <text
      class={props.class}
      x={props.x}
      y={first()}
      font-size={String(props.type.size)}
      font-weight={String(props.type.weight)}
      font-family={props.type.family}
      fill={props.fill}
      fill-opacity={props.fade}
      text-decoration={props.strike ? 'line-through' : undefined}
      text-anchor="middle"
      dominant-baseline="central"
    >
      <For each={props.lines}>
        {(line, i) => (
          <tspan x={props.x} dy={i() ? props.lineHeight : 0}>
            {line}
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
  const host = useSceneHost();
  const tip = () => {
    const placed = host.placingLine(props.id);
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
