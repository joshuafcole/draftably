import { createSignal, For, onCleanup, Show } from 'solid-js';
import { resolveAppearance } from '../../model/appearance';
import type { DrawnBundle } from '../../model/bundles';
import { findEdge, findObject } from '../../model/graph';
import { edgeLabelType } from '../../model/labels';
import type { DrawnRoute } from '../../model/routes';
import { edgeInk, isDiff } from '../../model/status';
import type { Diagram } from '../../model/types';
import { EdgeView } from './EdgeView';

export interface BundleViewProps {
  doc: Diagram;
  bundle: DrawnBundle;
  route: (id: string) => DrawnRoute | undefined;
  selected: (id: string) => boolean;
  hovered: (id: string) => boolean;
  editing: (id: string) => boolean;
  /** Spread into its lanes: held by the pointer, by focus, or picked. */
  spread: boolean;
  /** The pointer or focus came onto the bundle (`true`) or left it. */
  onHold: (held: boolean) => void;
  /** A press on the trunk: pick it, so it stays spread, or let it go. */
  onPick: () => void;
  /** Name the trunk; absent on a read-only drawing. */
  onName?: (name: string) => void;
  interactive?: boolean;
}

/** How far a held trunk's room reaches past its outer lanes, so the pointer can cross the lanes. */
const ROOM_PAD = 10;
/** The router's spacing between parallel lines, which a trunk's lanes take. */
const LANE = 16;

/**
 * One bundle: a trunk while nothing holds it, its lanes while something does. A member that is
 * selected or pointed at stands out of the trunk in its own lane. The trunk's label is its name or
 * its count; double-clicking it names the bundle.
 */
export function BundleView(props: BundleViewProps) {
  const look = () => resolveAppearance(props.doc.appearance);
  const first = () => findEdge(props.doc, props.bundle.members[0]);
  const ink = () => {
    const e = first();
    return e ? edgeInk(look(), e, isDiff(props.doc)) : look().text;
  };
  const type = () => edgeLabelType(look(), false);
  const title = (id: string) => findObject(props.doc, id)?.title ?? id;
  const description = () =>
    `${props.bundle.text} between ${title(props.bundle.a)} and ${title(props.bundle.b)}. Hold to spread.`;
  const out = (id: string) => props.spread || props.selected(id) || props.hovered(id);
  const [naming, setNaming] = createSignal(false);
  const head = () => `bundle-head-${props.bundle.id}`;
  let leave: ReturnType<typeof setTimeout> | undefined;
  const hold = (held: boolean) => {
    clearTimeout(leave);
    // A pointer crossing between lanes leaves and comes back at once; only a real leave lets go.
    if (held) props.onHold(true);
    else leave = setTimeout(() => props.onHold(false), 120);
  };
  onCleanup(() => clearTimeout(leave));

  const commit = (input: HTMLInputElement, keep: boolean) => {
    if (!naming()) return;
    setNaming(false);
    if (keep) props.onName?.(input.value);
  };

  return (
    <g
      class="bundle"
      classList={{ spread: props.spread }}
      data-bundle={props.bundle.id}
      data-members={props.bundle.members.join(' ')}
      onPointerEnter={() => hold(true)}
      onPointerLeave={() => hold(false)}
      onFocusIn={() => hold(true)}
      onFocusOut={() => hold(false)}
    >
      <defs>
        <marker
          id={head()}
          markerWidth={10}
          markerHeight={10}
          refX={8}
          refY={5}
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M1,1 L9,5 L1,9 Z" fill={ink()} />
        </marker>
      </defs>
      {/* The room the trunk holds: wide enough to cross its lanes without letting go. */}
      <Show when={props.interactive}>
        <path
          class="bundle-room"
          d={props.bundle.path}
          stroke-width={props.bundle.members.length * LANE + 2 * ROOM_PAD}
          tabindex={0}
          role="button"
          aria-label={description()}
          aria-expanded={props.spread}
          on:pointerdown={event => {
            // The canvas would read a press here as one on the background.
            event.stopPropagation();
            props.onPick();
          }}
        />
      </Show>
      <Show when={!props.spread}>
        <path
          class="bundle-trunk"
          d={props.bundle.path}
          stroke={ink()}
          stroke-width={4}
          marker-end={props.bundle.toB ? `url(#${head()})` : undefined}
          marker-start={props.bundle.toA ? `url(#${head()})` : undefined}
        />
      </Show>
      <For each={props.bundle.members}>
        {id => (
          <Show when={out(id) && props.route(id)}>
            {route => (
              <EdgeView
                doc={props.doc}
                route={route()}
                selected={props.selected(id)}
                hovered={props.hovered(id)}
                editing={props.editing(id)}
                interactive={props.interactive}
              />
            )}
          </Show>
        )}
      </For>
      <g
        class="bundle-label"
        data-bundle-label
        opacity={props.spread ? 0.55 : undefined}
        on:dblclick={event => {
          if (!props.onName) return;
          event.stopPropagation();
          setNaming(true);
        }}
      >
        <rect
          class="edge-label-bg"
          x={props.bundle.label.x - props.bundle.label.w / 2}
          y={props.bundle.label.y - props.bundle.label.h / 2}
          width={props.bundle.label.w}
          height={props.bundle.label.h}
          rx={props.bundle.label.h / 2}
          fill={look().canvas}
          stroke={ink()}
          stroke-width={1}
        />
        <text
          class="edge-label"
          x={props.bundle.label.x}
          y={props.bundle.label.y}
          fill={ink()}
          font-family={type().family}
          font-size={String(type().size)}
          font-weight={String(type().weight)}
        >
          {props.bundle.text}
        </text>
      </g>
      <Show when={naming()}>
        <foreignObject
          x={props.bundle.label.x - Math.max(140, props.bundle.label.w) / 2}
          y={props.bundle.label.y - 14}
          width={Math.max(140, props.bundle.label.w)}
          height={28}
        >
          <input
            class="bundle-name-input"
            aria-label="Bundle name"
            value={props.bundle.name ?? ''}
            placeholder={props.bundle.text}
            ref={input => queueMicrotask(() => input.select())}
            on:pointerdown={event => event.stopPropagation()}
            on:keydown={event => {
              event.stopPropagation();
              if (event.key === 'Enter') commit(event.currentTarget, true);
              if (event.key === 'Escape') commit(event.currentTarget, false);
            }}
            on:blur={event => commit(event.currentTarget, true)}
          />
        </foreignObject>
      </Show>
    </g>
  );
}
