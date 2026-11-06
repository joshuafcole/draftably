import { createMemo, For, Show } from 'solid-js';
import { cellsBandOf, descendants, findGroup, findNode, isCollapsed } from '../../model/graph';
import { resolveAppearance, type ResolvedAppearance } from '../../model/appearance';
import { drawnSwatch } from '../../model/colors';
import { HALO_GAP, haloInk, MARKER, statusPaint } from '../../model/status';
import { truncateText } from '../../model/fonts';
import { groupTitleLines } from '../../model/labels';
import { groupLinkMark } from '../../model/link';
import type { Diagram, NodeLayout } from '../../model/types';
import { SceneGlyph } from '../Icon';
import { LinkMarkView } from './LinkMark';
import { PIN_SIZE, PositionBadge, RemovedMarker, ResizeHandles } from './parts';
import { SOFT_PAD, SOFT_RADIUS, SOFT_TITLE } from '../../dsl/frame';

/** The rest of a field that runs on into another row: its title after an ellipsis. */
export const pieceLabel = (title: string, w: number, look: ResolvedAppearance) =>
  truncateText(`… ${title}`, Math.max(0, w - 8), look.annotation);

/** A container's border is quieter than a connection: thinner and partly transparent. */
export const GROUP_BORDER = { width: 1, opacity: 0.65 };

export interface GroupViewProps {
  doc: Diagram;
  id: string;
  rect: NodeLayout;
  selected?: boolean;
  /** Drawn as if the pointer were over it, such as when a host points at it from elsewhere. */
  hovered?: boolean;
  dropTarget?: boolean;
  interactive?: boolean;
  zoom?: number;
  focused?: boolean;
  /** Its title is being edited in place, so the drawn title hides. */
  editing?: boolean;
}

export function GroupView(props: GroupViewProps) {
  const group = () => findGroup(props.doc, props.id)!;
  const look = () => resolveAppearance(props.doc.appearance);
  const color = () => drawnSwatch(props.doc, look(), props.id, 'group');
  const paint = () =>
    statusPaint(look(), props.doc.styles[props.id]?.status, props.doc.styles[props.id]?.spot);
  const collapsed = () => isCollapsed(props.doc, props.id);
  const shapeCount = createMemo(
    () => descendants(props.doc, props.id).filter(id => findNode(props.doc, id)).length,
  );
  /** A `cells` group's title band; its cells fill the rest of the frame edge to edge. */
  const cells = () => (collapsed() ? undefined : cellsBandOf(props.doc, props.id));
  /** Where the title starts: after the group glyph, or at the band's padding for cells. */
  const titleX = () => (cells() ? 12 : 33);
  // Titles wrap to the lines the compiler reserved, leaving room for the controls; a cells band
  // and the last line are shortened to fit.
  const lines = () =>
    cells()
      ? [truncateText(group().title, Math.max(40, props.rect.w - titleX() - 36), look().groupTitle)]
      : groupTitleLines(group().title, props.rect.w, look(), group().titleLines);
  const title = () => lines()[lines().length - 1];
  const lineHeight = () => look().groupTitle.lineHeight;
  /** Middle of the title's last line. */
  const lastBand = () => band() + (lines().length - 1) * lineHeight();
  const chrome = () => (cells() ? props.doc.layout.containers[props.id]?.cellsChrome : undefined);
  const w = () => props.rect.w;
  /** Middle of the title band at the top of the frame, the same open or collapsed. */
  const band = () => (cells() ? cells()! / 2 : look().groupHeader / 2 - 7);

  // A frameless group draws nothing; a soft group is a tint with a small label and no controls.
  const hull = () =>
    group().hull?.length ? group().hull! : [{ x: 0, y: 0, w: w(), h: props.rect.h }];
  const soft = () => (
    <g
      class="group soft"
      classList={{ selected: props.selected, hovered: props.hovered, focused: props.focused }}
      data-kind="group"
      data-id={props.id}
      transform={`translate(${props.rect.x},${props.rect.y})`}
      opacity={paint().opacity < 1 ? paint().opacity : undefined}
      tabindex={props.interactive ? 0 : undefined}
      role={props.interactive ? 'button' : undefined}
      aria-label={props.interactive ? `${group().title}, soft group` : undefined}
      aria-pressed={props.interactive ? !!props.selected : undefined}
    >
      <For each={hull()}>
        {h => (
          <rect
            class="group-bg"
            x={h.x}
            y={h.y}
            width={h.w}
            height={h.h}
            rx={SOFT_RADIUS}
            fill={color().fill}
          />
        )}
      </For>
      <text
        class="group-title"
        x={hull()[0].x + SOFT_TITLE.x}
        y={hull()[0].y + SOFT_TITLE.y}
        dominant-baseline="central"
        font-family={look().annotation.family}
        font-size={String(look().annotation.size)}
        font-weight={String(look().annotation.weight)}
        fill={color().ink}
        fill-opacity={paint().inkFade}
        text-decoration={paint().strike ? 'line-through' : undefined}
      >
        {truncateText(group().title, Math.max(40, hull()[0].w - 2 * SOFT_PAD), look().annotation)}
      </text>
    </g>
  );

  const boxed = () => (
    <g
      class="group"
      classList={{
        selected: props.selected,
        hovered: props.hovered,
        'drop-target': props.dropTarget,
        focused: props.focused,
        editing: props.editing,
      }}
      data-kind="group"
      data-id={props.id}
      data-href={group().href}
      transform={`translate(${props.rect.x},${props.rect.y})`}
      opacity={paint().opacity < 1 ? paint().opacity : undefined}
      tabindex={props.interactive ? 0 : undefined}
      role={props.interactive ? 'button' : undefined}
      aria-label={
        props.interactive ? `${group().title}, container, ${shapeCount()} shapes` : undefined
      }
      aria-pressed={props.interactive ? !!props.selected : undefined}
    >
      <Show when={paint().halo}>
        <rect
          x={-HALO_GAP}
          y={-HALO_GAP}
          width={w() + 2 * HALO_GAP}
          height={props.rect.h + 2 * HALO_GAP}
          rx={Math.min(10, look().radius + 4) + HALO_GAP}
          fill="none"
          stroke={haloInk(look())}
          stroke-width={2}
        />
      </Show>
      <rect
        class="group-bg"
        width={w()}
        height={props.rect.h}
        rx={cells() ? Math.min(4, look().radius) : Math.min(10, look().radius + 4)}
        fill={color().fill}
        stroke={color().stroke}
        stroke-width={paint().width ?? GROUP_BORDER.width}
        stroke-opacity={paint().stroke ? 1 : GROUP_BORDER.opacity}
        stroke-dasharray={paint().dash}
      />
      <rect
        class="group-header"
        data-group-header
        width={Math.max(0, w() - 30)}
        height={lastBand() + band()}
        fill="transparent"
      />
      <Show when={!cells()}>
        <SceneGlyph name="group" x={12} y={band() - 6.5} size={13} color={color().ink} />
      </Show>
      <text
        class="group-title"
        x={titleX()}
        y={band()}
        dominant-baseline="central"
        font-family={look().groupTitle.family}
        font-size={String(look().groupTitle.size)}
        font-weight={String(look().groupTitle.weight)}
        fill={color().ink}
        fill-opacity={paint().inkFade}
        text-decoration={paint().strike ? 'line-through' : undefined}
        pointer-events="none"
      >
        <For each={lines()}>
          {(line, i) => (
            <tspan x={titleX()} y={band() + i() * lineHeight()}>
              {line}
            </tspan>
          )}
        </For>
      </text>
      <Show when={paint().marker}>
        <RemovedMarker
          x={w() - MARKER.inset}
          y={MARKER.inset}
          ink={color().stroke}
          canvas={look().canvas}
        />
      </Show>
      <Show when={group().href}>
        {href => (
          <LinkMarkView
            mark={groupLinkMark(title(), look().groupTitle, lastBand())}
            href={href()}
            color={color().ink}
            interactive={props.interactive}
          />
        )}
      </Show>
      <Show when={chrome()?.ruler}>
        {ruler => (
          <g
            class="cells-ruler"
            data-text-hint="Bit numbers come from the cells' sizes. Edit a cell's size to change them."
          >
            <For each={ruler().ticks}>
              {t => (
                <text
                  x={t.x}
                  y={ruler().y + ruler().h / 2}
                  text-anchor="middle"
                  dominant-baseline="central"
                  font-family={look().annotation.family}
                  font-size={String(look().annotation.size)}
                  fill={color().ink}
                >
                  {t.label}
                </text>
              )}
            </For>
          </g>
        )}
      </Show>
      <For each={Object.entries(chrome()?.pieces ?? {})}>
        {([id, pieces]) => {
          const c = () => drawnSwatch(props.doc, look(), id, 'node');
          return (
            <For each={pieces}>
              {r => (
                <g class="cell-piece" pointer-events="none">
                  <rect
                    x={r.x}
                    y={r.y}
                    width={r.w}
                    height={r.h}
                    fill={c().fill}
                    stroke={c().stroke}
                    stroke-width={1.2}
                  />
                  <text
                    x={r.x + r.w / 2}
                    y={r.y + r.h / 2}
                    text-anchor="middle"
                    dominant-baseline="central"
                    font-family={look().annotation.family}
                    font-size={String(look().annotation.size)}
                    fill={c().ink}
                    opacity={0.75}
                  >
                    {pieceLabel(findNode(props.doc, id)?.title ?? '', r.w, look())}
                  </text>
                </g>
              )}
            </For>
          );
        }}
      </For>
      <Show when={props.interactive}>
        <g
          class="group-collapse"
          data-collapse
          aria-label={`${collapsed() ? 'Expand' : 'Collapse'} container`}
        >
          <rect
            x={w() - 29}
            y={cells() ? band() - 12 : 5}
            width={24}
            height={24}
            rx={5}
            fill="transparent"
          />
          <path
            d={`M${w() - 22} ${cells() ? band() : 17}h10${collapsed() ? 'm-5-5v10' : ''}`}
            fill="none"
            stroke={color().ink}
            stroke-width={1.4}
          />
        </g>
        <PositionBadge
          id={props.id}
          pinned={!!props.rect.pinned}
          manual={!!props.rect.manual && props.doc.settings.showManual}
          x={w() - 26 - 9 - PIN_SIZE}
          y={band() - PIN_SIZE / 2}
          color={color().ink}
        />
      </Show>
      <Show when={collapsed()}>
        <text
          x={33}
          y={band() * 2 + 9}
          font-family={look().annotation.family}
          font-size="10"
          fill={color().ink}
          data-text-hint="Expand the container to see and edit its shapes."
        >
          {shapeCount()} shapes
        </text>
      </Show>
      <Show when={props.interactive && props.selected && !collapsed()}>
        <ResizeHandles rect={props.rect} zoom={props.zoom ?? 1} />
      </Show>
    </g>
  );

  return (
    <Show when={group().frame !== 'none'}>
      <Show when={group().frame === 'soft'} fallback={boxed()}>
        {soft()}
      </Show>
    </Show>
  );
}
