import { createMemo, createRoot, For, Show, type Accessor } from 'solid-js';
import { findEdge, findObject } from '../../model/graph';
import { HALO_WIDTH, type DrawnRoute } from '../../model/routes';
import { resolveAppearance, swatchFor } from '../../model/appearance';
import { edgeLabelLines, edgeLabelType } from '../../model/labels';
import {
  headOf,
  markerBox,
  markerFill,
  MARKER_SHAPES,
  MARKER_STROKE,
  tailOf,
  type EndMarker,
} from '../../model/markers';
import { edgeInk, isDiff, statusPaint } from '../../model/status';
import { haloPieces, surfaces } from '../../model/surface';
import type { Diagram } from '../../model/types';

const surfaceMemos = new WeakMap<Diagram, Accessor<ReturnType<typeof surfaces>>>();
/**
 * One surface lookup per document, shared by every edge. The memo reruns when the layout it reads
 * changes, so it follows the editor store's in-place updates without a rebuild per edge.
 */
function sharedSurfaces(doc: Diagram) {
  let memo = surfaceMemos.get(doc);
  if (!memo)
    surfaceMemos.set(
      doc,
      (memo = createRoot(() => createMemo(() => surfaces(doc, resolveAppearance(doc.appearance))))),
    );
  return memo;
}

export interface EdgeViewProps {
  doc: Diagram;
  route: DrawnRoute;
  selected?: boolean;
  interactive?: boolean;
  /** Its label is being edited in place, so the drawn label hides. */
  editing?: boolean;
  /** Keeps marker ids unique when several scenes share a page. */
  idPrefix?: string;
}

/** One end's mark, from the definitions the CLI draws too. */
function EndMarkerDef(props: {
  id: string;
  kind: EndMarker;
  tail?: boolean;
  ink: string;
  surface: string;
}) {
  return (
    <Show when={props.kind !== 'none' && (props.kind as Exclude<EndMarker, 'none'>)} keyed>
      {kind => {
        const box = markerBox(kind, !!props.tail);
        return (
          <marker
            id={props.id}
            markerWidth={box.markerWidth}
            markerHeight={box.markerHeight}
            refX={box.refX}
            refY={box.refY}
            orient={box.orient}
            markerUnits="userSpaceOnUse"
          >
            <path
              d={MARKER_SHAPES[kind].d}
              fill={markerFill(kind, props.ink, props.surface)}
              stroke={props.ink}
              stroke-width={MARKER_STROKE}
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </marker>
        );
      }}
    </Show>
  );
}

export function EdgeView(props: EdgeViewProps) {
  const edge = () => findEdge(props.doc, props.route.id)!;
  const look = () => resolveAppearance(props.doc.appearance);
  const paint = () => statusPaint(look(), edge().status, edge().spot);
  const stroke = () =>
    props.route.blocked
      ? swatchFor(look(), 'red', 600).fill
      : edge().emphasis && !edge().dashed && !isDiff(props.doc)
        ? swatchFor(look(), 'primary', 700).fill
        : edgeInk(look(), edge(), isDiff(props.doc));
  /** A sequence message's label wraps and is set a step larger. */
  const message = () => props.doc.layout.edges[props.route.id]?.row !== undefined;
  const labelType = () => edgeLabelType(look(), message());
  const labelLines = () => edgeLabelLines(edge().label, look(), message());
  const under = () => sharedSurfaces(props.doc)();
  const labelBg = () => (props.route.label ? under()(props.route.label) : { fill: look().canvas });
  const halos = () => (props.route.halo ? haloPieces(under(), props.route.halo) : []);
  const markerId = () => `${props.idPrefix ?? ''}arrow-${props.route.id}`;
  const tailId = () => `${props.idPrefix ?? ''}tail-${props.route.id}`;
  const markerInk = () => (props.selected ? 'var(--accent)' : stroke());
  const waypoints = () =>
    props.interactive && props.selected
      ? (props.doc.layout.edges[props.route.id]?.waypoints ?? [])
      : [];
  const description = () => {
    const e = edge();
    return `${findObject(props.doc, e.from)?.title} to ${findObject(props.doc, e.to)?.title}${e.label ? ', ' + e.label : ''}`;
  };

  return (
    <g
      class="edge"
      classList={{ selected: props.selected, editing: props.editing }}
      data-kind="edge"
      data-id={props.route.id}
      opacity={paint().opacity < 1 ? paint().opacity : undefined}
      tabindex={props.interactive ? 0 : undefined}
      role={props.interactive ? 'button' : undefined}
      aria-label={props.interactive ? description() : undefined}
    >
      <defs>
        <EndMarkerDef
          id={markerId()}
          kind={headOf(edge())}
          ink={markerInk()}
          surface={look().canvas}
        />
        <EndMarkerDef
          id={tailId()}
          kind={tailOf(edge())}
          tail
          ink={markerInk()}
          surface={look().canvas}
        />
      </defs>
      <Show when={props.interactive}>
        <path class="edge-hit" d={props.route.path} />
      </Show>
      {/* A halo in the color under it breaks container borders and other lines where this line
          crosses them, so the connection reads as the stronger mark. Only there: along its whole
          length it reads as a doubled line, inside a tinted group most of all. */}
      <For each={halos()}>
        {piece => (
          <>
            <path
              class="edge-halo"
              d={piece.d}
              stroke={piece.surface.fill}
              stroke-width={HALO_WIDTH}
              fill="none"
            />
            <Show when={piece.surface.tint}>
              {t => (
                <path
                  class="edge-halo"
                  d={piece.d}
                  stroke={t().fill}
                  stroke-opacity={t().opacity}
                  stroke-width={HALO_WIDTH}
                  fill="none"
                />
              )}
            </Show>
          </>
        )}
      </For>
      <path
        class="edge-line"
        d={props.route.path}
        fill="none"
        stroke-linecap="round"
        stroke-linejoin="round"
        stroke={stroke()}
        stroke-width={paint().width ? paint().width! - 0.5 : edge().emphasis ? 2 : 1.4}
        stroke-dasharray={
          paint().dash ?? (edge().dashed || props.route.blocked ? '5 5' : undefined)
        }
        marker-end={headOf(edge()) === 'none' ? undefined : `url(#${markerId()})`}
        marker-start={tailOf(edge()) === 'none' ? undefined : `url(#${tailId()})`}
      />
      <Show when={props.route.label}>
        {label => (
          <g data-edge-label>
            <rect
              class="edge-label-bg"
              x={label().x - label().w / 2}
              y={label().y - label().h / 2}
              width={label().w}
              height={label().h}
              rx={4}
              fill={labelBg().fill}
            />
            <Show when={labelBg().tint}>
              {t => (
                <rect
                  class="edge-label-bg"
                  x={label().x - label().w / 2}
                  y={label().y - label().h / 2}
                  width={label().w}
                  height={label().h}
                  rx={4}
                  fill={t().fill}
                  fill-opacity={t().opacity}
                />
              )}
            </Show>
            <text
              class="edge-label"
              text-anchor="middle"
              dominant-baseline="central"
              x={label().x}
              y={label().y - ((labelLines().length - 1) * labelType().lineHeight) / 2}
              fill={stroke()}
              font-family={labelType().family}
              font-size={String(labelType().size)}
              font-weight={String(labelType().weight)}
              fill-opacity={paint().inkFade}
              text-decoration={paint().strike ? 'line-through' : undefined}
            >
              <For each={labelLines()}>
                {(line, i) => (
                  <tspan x={label().x} dy={i() ? labelType().lineHeight : 0}>
                    {line}
                  </tspan>
                )}
              </For>
            </text>
          </g>
        )}
      </Show>
      <For each={waypoints()}>
        {(p, i) => (
          <rect
            class="waypoint"
            data-waypoint={i()}
            x={p.x - 5}
            y={p.y - 5}
            width={10}
            height={10}
            rx={2}
            aria-label="Bend point"
          />
        )}
      </For>
    </g>
  );
}

/**
 * The stretch of a line that crosses cells to reach a cell with no free side, drawn over the
 * cells, with a dot where it meets that cell.
 */
export function CrossingView(props: { doc: Diagram; route: DrawnRoute; selected?: boolean }) {
  const edge = () => findEdge(props.doc, props.route.id)!;
  const look = () => resolveAppearance(props.doc.appearance);
  const paint = () => statusPaint(look(), edge().status);
  const ink = () => (props.selected ? 'var(--accent)' : edgeInk(look(), edge(), isDiff(props.doc)));
  return (
    <Show when={props.route.cross}>
      {cross => (
        <g
          class="edge-crossing"
          pointer-events="none"
          opacity={paint().opacity < 1 ? paint().opacity : undefined}
        >
          <line
            x1={cross()[0].x}
            y1={cross()[0].y}
            x2={cross()[1].x}
            y2={cross()[1].y}
            stroke={ink()}
            stroke-width={paint().width ? paint().width! - 0.5 : 1.4}
            stroke-dasharray={paint().dash ?? (edge().dashed ? '5 5' : undefined)}
          />
          <circle cx={cross()[1].x} cy={cross()[1].y} r={3.5} fill={ink()} />
        </g>
      )}
    </Show>
  );
}
