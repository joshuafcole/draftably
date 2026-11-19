import { createMemo, For, Show } from 'solid-js';
import { SculptLab } from '../../engines/sculpt-engine';
import { center } from '../../model/geometry';
import { findNode, isGroup, styleOf } from '../../model/graph';
import { portPoint, sideToward, SIDE_VECTORS } from '../../model/routes';
import type { NodeLayout, Side } from '../../model/types';
import { roundedPath } from '../../model/geometry';
import { useDiagramSession } from '../session-context';

/** Temporary drawing on top of the diagram: gestures, connection previews and brush feedback. */
export function Overlay() {
  return (
    <g class="overlay-layer">
      <GestureFeedback />
      <ConnectionPreview />
      <QuickAddButtons />
      <TimelineGhosts />
      <HeldObjects />
      <BrushCursor />
    </g>
  );
}

function GestureFeedback() {
  const s = useDiagramSession();
  return (
    <>
      <Show when={s.drag()?.marquee}>
        {r => <rect class="marquee" x={r().x} y={r().y} width={r().w} height={r().h} />}
      </Show>
      <Show when={s.drag()?.draw}>
        {r => (
          <rect class="drawing-preview" x={r().x} y={r().y} width={r().w} height={r().h} rx={8} />
        )}
      </Show>
      <For each={s.drag()?.guides ?? []}>
        {g => (
          <path
            class="guide"
            d={g.axis === 'x' ? `M${g.value} ${g.from}V${g.to}` : `M${g.from} ${g.value}H${g.to}`}
          />
        )}
      </For>
    </>
  );
}

/** Dashed elbow from the connection source to the pointer. */
function ConnectionPreview() {
  const s = useDiagramSession();
  const path = createMemo(() => {
    const from = s.connectFrom(),
      b = s.pointer();
    if (!from || !b || !findNode(s.doc, from.id)) return null;
    const r = s.geometry(from.id),
      side: Side = from.side === 'auto' ? sideToward(r, b) : from.side,
      a = portPoint(styleOf(s.doc, from.id).shape, r, side),
      points =
        side === 'left' || side === 'right'
          ? [a, { x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }, b]
          : [a, { x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }, b];
    return roundedPath(points, s.doc.settings.routing.cornerRadius);
  });
  return <Show when={path()}>{d => <path class="connection-preview" d={d()} />}</Show>;
}

/** "+" buttons beside a single selected shape that add a connected shape. */
function QuickAddButtons() {
  const s = useDiagramSession();
  const owner = () => {
    const id = s.singleSelection();
    const visible =
      id &&
      findNode(s.doc, id) &&
      !s.sculptGeometry() &&
      s.tool() !== 'brush' &&
      !s.drag() &&
      !s.inlineEditId() &&
      !s.connectFrom() &&
      !s.timeline();
    return visible ? id : null;
  };
  return (
    <Show when={owner()}>
      {id => (
        <For each={['right', 'bottom'] as Side[]}>
          {side => {
            const k = () => s.doc.camera.k;
            const at = () => {
              const p = portPoint(styleOf(s.doc, id()).shape, s.geometry(id()), side),
                v = SIDE_VECTORS[side];
              return { x: p.x + (v.x * 26) / k(), y: p.y + (v.y * 26) / k() };
            };
            const size = () => 22 / k();
            return (
              <g
                class="quick-add"
                data-quick-add={side}
                data-owner={id()}
                role="button"
                tabindex="0"
                aria-label={`Add connected shape ${side}`}
              >
                <circle cx={at().x} cy={at().y} r={size() / 2} />
                <path
                  d={`M${at().x - size() / 4} ${at().y}h${size() / 2}M${at().x} ${at().y - size() / 4}v${size() / 2}`}
                />
              </g>
            );
          }}
        </For>
      )}
    </Show>
  );
}

/** Dashed outlines showing where shapes go next while scrubbing a timeline. */
function TimelineGhosts() {
  const s = useDiagramSession();
  const ghosts = createMemo(() => {
    const t = s.timeline();
    if (!t?.data || t.ghost === 'off') return [];
    const k = s.doc.camera.k,
      index = t.peek ?? t.index,
      at = t.data.frames[index],
      next =
        t.ghost === 'final'
          ? t.data.frames.length - 1
          : SculptLab.lookahead(t.data.frames, index, 48, k),
      to = t.data.frames[next];
    return Object.entries(to.nodes)
      .filter(
        ([id, p]) =>
          at.nodes[id] && Math.hypot(at.nodes[id].x - p.x, at.nodes[id].y - p.y) >= 1 / k,
      )
      .map(([id, p]) => ({ id, p, from: center(at.nodes[id]), to: center(p) }));
  });
  return (
    <g aria-hidden="true">
      <For each={ghosts()}>
        {g => (
          <>
            <path class="sculpt-travel" d={`M${g.from.x},${g.from.y} L${g.to.x},${g.to.y}`} />
            <Ghost id={g.id} rect={g.p} color="var(--accent)" opacity={0.48} />
          </>
        )}
      </For>
    </g>
  );
}

function Ghost(props: { id: string; rect: NodeLayout; color: string; opacity: number }) {
  const s = useDiagramSession();
  return (
    <rect
      class="sculpt-ghost"
      x={props.rect.x}
      y={props.rect.y}
      width={props.rect.w}
      height={props.rect.h}
      rx={isGroup(s.doc, props.id) ? 8 : 10}
      style={{ stroke: props.color, opacity: props.opacity }}
      stroke-dasharray="5 4"
    />
  );
}

/** Objects held in place by the brush. */
function HeldObjects() {
  const s = useDiagramSession();
  const k = () => s.doc.camera.k;
  return (
    <For each={s.heldIds()}>
      {id => {
        const p = () => s.geometry(id);
        return (
          <>
            <rect
              class="sculpt-held"
              x={p().x - 4 / k()}
              y={p().y - 4 / k()}
              width={p().w + 8 / k()}
              height={p().h + 8 / k()}
              rx={12}
            />
            <circle
              class="sculpt-held-dot"
              cx={p().x + p().w - 2 / k()}
              cy={p().y - 2 / k()}
              r={4}
            />
          </>
        );
      }}
    </For>
  );
}

/** The brush ring, plus a preview of what the next dab would move. */
function BrushCursor() {
  const s = useDiagramSession();
  const visible = () => s.brushActive() && s.brushPoint() && !s.drag();
  const k = () => s.doc.camera.k;
  const restoring = () => s.restoreKey() || s.brushSettings().mode === 'restore';
  const color = () => (restoring() ? 'var(--sculpt-restore)' : 'var(--accent)');
  const weights = createMemo(() => Object.entries(s.brushHover()?.weights ?? {}));
  return (
    <Show when={visible() && s.brushPoint()}>
      {p => {
        const r = () => s.brushSettings().radius / k();
        const core = () => r() * (1 - s.brushSettings().softness / 100);
        return (
          <>
            <g class="sculpt-brush-ring" style={{ color: color() }} aria-hidden="true">
              <circle cx={p().x} cy={p().y} r={r()} class="brush-outer" />
              <circle cx={p().x} cy={p().y} r={core()} class="brush-core" />
              <path
                d={`M${p().x - 5 / k()},${p().y}h${10 / k()} M${p().x},${p().y - 5 / k()}v${10 / k()}`}
              />
            </g>
            <For each={weights()}>
              {([id, w]) => {
                const base = () => s.geometry(id);
                const target = () =>
                  !s.stroking() ? s.brushHover()?.document.layout.nodes[id] : undefined;
                const moves = () => {
                  const q = target();
                  return q && Math.hypot(q.x - base().x, q.y - base().y) > 0.05;
                };
                return (
                  <>
                    <rect
                      x={base().x}
                      y={base().y}
                      width={base().w}
                      height={base().h}
                      rx={10}
                      fill={color()}
                      opacity={w * 0.12}
                      pointer-events="none"
                    />
                    <Show when={moves()}>
                      <Ghost id={id} rect={target()!} color={color()} opacity={0.8} />
                    </Show>
                  </>
                );
              }}
            </For>
          </>
        );
      }}
    </Show>
  );
}
