import { createMemo, For, Match, Show, Switch } from 'solid-js';
import { findNode, isCell, isOpenCell, styleOf } from '../../model/graph';
import { brokenRectPath } from '../../model/geometry';
import { nodeLabel } from '../../model/labels';
import { portPoint } from '../../model/routes';
import { resolveAppearance } from '../../model/appearance';
import { drawnSwatch, participantAccent } from '../../model/colors';
import { accentPath } from '../../cli/svg';
import { HALO_GAP, haloInk, MARKER, statusPaint } from '../../model/status';
import { countText, STACK_OFFSETS } from '../../model/stack';
import { measureText } from '../../model/fonts';
import { linkMark } from '../../model/link';
import type { Diagram, NodeLayout, Side } from '../../model/types';
import { SceneGlyph } from '../Icon';
import { LinkMarkView } from './LinkMark';
import { NodeBody, useNodeContent } from './node-content';
import { pinSpot, PositionBadge, RemovedMarker, ResizeHandles, SceneText } from './parts';

const SIDES: Side[] = ['left', 'right', 'top', 'bottom'];

export interface NodeViewProps {
  doc: Diagram;
  id: string;
  rect: NodeLayout;
  selected?: boolean;
  /** Editor canvas: ports, resize handles and position badges. */
  interactive?: boolean;
  zoom?: number;
  /** Highlight used by comparisons for the visual anchor. */
  focused?: boolean;
  /** Its title is being edited in place, so the drawn title hides. */
  editing?: boolean;
  /** Comparison candidates: focusable so a keyboard user can choose the anchor. */
  focusable?: boolean;
  idPrefix?: string;
}

export function NodeView(props: NodeViewProps) {
  const node = () => findNode(props.doc, props.id)!;
  const style = () => styleOf(props.doc, props.id);
  const look = () => resolveAppearance(props.doc.appearance);
  const color = () => drawnSwatch(props.doc, look(), props.id, 'node');
  const paint = () => statusPaint(look(), style().status, style().spot);
  const label = createMemo(() => nodeLabel(props.doc, props.id, node().title, props.rect));
  const ringRadius = () => {
    const { shape } = style(),
      r = props.rect;
    return shape === 'icon' || shape === 'circle' ? (r.h + 8) / 2 : shape === 'pill' ? r.h / 2 : 14;
  };
  /** Width of the `count` badge on the top-right corner, which the link mark steps left of. */
  const badgeWidth = () =>
    node().count ? measureText(countText(node().count!), look().annotation) + 12 : 0;
  /** Cells share their borders, so their corners are square and they cast no shadow. */
  const cell = () => isCell(props.doc, props.id);
  const radius = () => (cell() ? 0 : look().radius);
  const clipId = () => `${props.idPrefix ?? ''}image-clip-${props.id}`;
  /** A host's body for this node, drawn in place of its title (`NodeContentProvider`). */
  const content = useNodeContent();
  const body = () => (content?.draws(props.id) ? content : undefined);

  const shapeAttrs = () => ({
    fill: color().fill,
    stroke: color().stroke,
    'stroke-width': paint().width ?? 1.2,
    ...(paint().dash ? { 'stroke-dasharray': paint().dash! } : {}),
    class: look().shadow && !cell() ? 'node-shape shadowed' : 'node-shape',
  });

  const glyph = () => {
    const { shape, icon } = style();
    if (!icon || shape === 'image' || shape === 'text' || shape === 'diamond') return null;
    const large = shape === 'icon',
      size = large ? 30 : 20,
      r = props.rect;
    return {
      size,
      x: large || shape === 'circle' ? r.w / 2 - size / 2 : 17,
      y: r.h / 2 - size / 2,
    };
  };

  return (
    <g
      class="node"
      classList={{ selected: props.selected, focused: props.focused, editing: props.editing }}
      data-kind="node"
      data-id={props.id}
      data-href={node().href}
      transform={`translate(${props.rect.x},${props.rect.y})`}
      opacity={paint().opacity < 1 ? paint().opacity : undefined}
      tabindex={props.interactive || props.focusable ? 0 : undefined}
      role={props.interactive || props.focusable ? 'button' : undefined}
      aria-label={
        props.interactive
          ? `${node().title}, ${style().shape}${props.rect.pinned ? ', pinned' : ''}`
          : props.focusable
            ? `Use ${node().title} as visual anchor`
            : undefined
      }
      aria-pressed={props.interactive ? !!props.selected : undefined}
    >
      <Show when={label().leader && label().mode !== 'center'}>
        <path
          class="leader"
          d={`M${props.rect.w / 2},${props.rect.h / 2} L${label().x},${label().y}`}
        />
      </Show>
      <Show when={props.interactive}>
        <rect
          class="selection-ring"
          x={-4}
          y={-4}
          width={props.rect.w + 8}
          height={props.rect.h + 8}
          rx={ringRadius()}
        />
      </Show>
      <Show when={node().count && style().shape !== 'text'}>
        <For each={STACK_OFFSETS}>
          {d => (
            <g transform={`translate(${d},${d})`}>
              <ShapeOutline
                shape={style().shape}
                rect={props.rect}
                radius={radius()}
                attrs={shapeAttrs()}
              />
            </g>
          )}
        </For>
      </Show>
      <Show when={paint().halo}>
        <g transform={`translate(${-HALO_GAP},${-HALO_GAP})`}>
          <ShapeOutline
            shape={style().shape === 'text' ? 'box' : style().shape}
            rect={{
              ...props.rect,
              w: props.rect.w + 2 * HALO_GAP,
              h: props.rect.h + 2 * HALO_GAP,
            }}
            radius={look().radius + HALO_GAP}
            attrs={{ fill: 'none', stroke: haloInk(look()), 'stroke-width': 2 }}
          />
        </g>
      </Show>
      <ShapeOutline
        shape={style().shape}
        rect={props.rect}
        radius={radius()}
        attrs={shapeAttrs()}
        ink={look().text}
        open={isOpenCell(props.doc, props.id)}
      />
      <Show when={style().shape === 'box' && participantAccent(props.doc, look(), props.id)}>
        {accent => (
          <path
            d={accentPath({ x: 0, y: 0, w: props.rect.w, h: props.rect.h }, radius())}
            fill={accent()}
            pointer-events="none"
          />
        )}
      </Show>
      <Show when={style().shape === 'image'}>
        <Show
          when={node().image}
          fallback={
            <SceneGlyph
              name="image"
              x={props.rect.w / 2 - 20}
              y={props.rect.h / 2 - 20}
              size={40}
              color={color().ink}
            />
          }
        >
          <clipPath id={clipId()}>
            <rect x={1} y={1} width={props.rect.w - 2} height={props.rect.h - 2} rx={9} />
          </clipPath>
          <image
            href={node().image}
            x={1}
            y={1}
            width={props.rect.w - 2}
            height={props.rect.h - 2}
            preserveAspectRatio="xMidYMid meet"
            clip-path={`url(#${clipId()})`}
          />
        </Show>
      </Show>
      <Show when={glyph()}>
        {g => (
          <SceneGlyph name={style().icon} x={g().x} y={g().y} size={g().size} color={color().ink} />
        )}
      </Show>
      <Show
        when={body()}
        fallback={
          <SceneText
            class="node-title"
            lines={label().lines}
            x={label().x}
            y={label().y}
            lineHeight={label().lineHeight}
            type={look().title}
            fill={label().mode === 'center' && style().shape !== 'text' ? color().ink : look().text}
            strike={paint().strike}
            fade={paint().inkFade}
          />
        }
      >
        {host => (
          <NodeBody content={host()} id={props.id} rect={props.rect} selected={props.selected} />
        )}
      </Show>
      <Show when={paint().marker && !node().count}>
        <RemovedMarker
          x={props.rect.w - MARKER.inset}
          y={MARKER.inset}
          ink={color().stroke}
          canvas={look().canvas}
        />
      </Show>
      <Show when={node().count}>
        {count => {
          const text = () => countText(count()),
            w = () => measureText(text(), look().annotation) + 12,
            h = () => look().annotation.lineHeight + 4;
          return (
            <g class="count-badge">
              <rect
                x={props.rect.w - w() + 6}
                y={-h() / 2}
                width={w()}
                height={h()}
                rx={h() / 2}
                fill={color().stroke}
              />
              <text
                x={props.rect.w - w() / 2 + 6}
                y={0}
                text-anchor="middle"
                dominant-baseline="central"
                font-family={look().annotation.family}
                font-size={String(look().annotation.size)}
                font-weight={String(look().annotation.weight)}
                fill={look().canvas}
              >
                {text()}
              </text>
            </g>
          );
        }}
      </Show>
      <Show when={node().href}>
        {href => (
          <LinkMarkView
            mark={linkMark(style().shape, props.rect.w, props.rect.h, badgeWidth())}
            href={href()}
            color={
              linkMark(style().shape, props.rect.w, props.rect.h).inside
                ? color().ink
                : look().muted
            }
            interactive={props.interactive}
          />
        )}
      </Show>
      <Show when={props.interactive}>
        <PositionBadge
          id={props.id}
          pinned={!!props.rect.pinned}
          manual={!!props.rect.manual && props.doc.settings.showManual}
          {...pinSpot(style().shape, props.rect.w, props.rect.h)}
          color={color().ink}
        />
        <For each={style().shape === 'marker' ? (['bottom'] as Side[]) : SIDES}>
          {side => {
            const p = () =>
              portPoint(style().shape, { x: 0, y: 0, w: props.rect.w, h: props.rect.h }, side);
            return (
              <circle
                class="port"
                data-port={side}
                cx={p().x}
                cy={p().y}
                r={4.5}
                aria-label={`Connect from ${side}`}
              />
            );
          }}
        </For>
        <Show when={props.selected}>
          <ResizeHandles rect={props.rect} zoom={props.zoom ?? 1} corners />
        </Show>
      </Show>
    </g>
  );
}

function ShapeOutline(props: {
  shape: string;
  rect: NodeLayout;
  radius: number;
  attrs: Record<string, string | number>;
  /** A marker's bar is drawn in the theme's text color, so it reads as a cut. */
  ink?: string;
  /** A field of variable length: its sides are broken. */
  open?: boolean;
}) {
  const w = () => props.rect.w,
    h = () => props.rect.h;
  return (
    <Switch
      fallback={
        <rect
          width={w()}
          height={h()}
          rx={props.shape === 'pill' ? h() / 2 : props.radius}
          {...props.attrs}
        />
      }
    >
      <Match when={props.open}>
        <path d={brokenRectPath({ x: 0, y: 0, w: w(), h: h() })} {...props.attrs} />
      </Match>
      <Match when={props.shape === 'diamond'}>
        <path
          d={`M${w() / 2},0 L${w()},${h() / 2} L${w() / 2},${h()} L0,${h() / 2} Z`}
          {...props.attrs}
        />
      </Match>
      <Match when={props.shape === 'circle' || props.shape === 'icon'}>
        <ellipse cx={w() / 2} cy={h() / 2} rx={w() / 2} ry={h() / 2} {...props.attrs} />
      </Match>
      <Match when={props.shape === 'text'}>
        <rect width={w()} height={h()} rx={6} fill="transparent" stroke="none" />
      </Match>
      <Match when={props.shape === 'image'}>
        <rect width={w()} height={h()} rx={10} {...props.attrs} />
      </Match>
      <Match when={props.shape === 'marker'}>
        <rect width={w()} height={h()} rx={2} fill={props.ink} stroke="none" />
      </Match>
    </Switch>
  );
}
