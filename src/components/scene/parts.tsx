import { createMemo, For, Show } from 'solid-js';
import type { ResolvedAppearance, Swatch } from '../../model/appearance';
import {
  CODE_ADVANCE,
  CODE_TYPE,
  codeLayout,
  codeRuns,
  columnX,
  lineBand,
  moreText,
  rowNumber,
  wrapMarkPath,
  type CodeBlock,
} from '../../model/code';
import { detailInk } from '../../model/colors';
import { codeColors, codeTokens, coloredRuns } from '../../model/highlight';
import { BAND_OPACITY, rangeMarks } from '../../model/ranges';
import { truncateText } from '../../model/fonts';
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

/**
 * A code node's caption band, line numbers and listing, placed by column arithmetic exactly as
 * `renderSvg` places them (`model/code.ts`).
 */
export function CodeBody(props: {
  code: CodeBlock;
  caption: string;
  w: number;
  h: number;
  look: ResolvedAppearance;
  swatch: Swatch;
  strike?: boolean;
  fade?: number;
}) {
  const laid = createMemo(() =>
    codeLayout(props.code, props.caption, props.look, { width: props.w, height: props.h }),
  );
  const numbers = createMemo(() =>
    laid().rows.flatMap((row, i) => {
      const text = rowNumber(props.code, laid(), row, i);
      return text ? [{ text, y: row.y + CODE_TYPE.lineHeight / 2 }] : [];
    }),
  );
  const tokens = createMemo(() => codeTokens(props.code));
  const colors = createMemo(() => codeColors(props.look, props.swatch.fill, props.swatch.ink));
  const bands = createMemo(() =>
    (tokens() ?? []).flatMap((t, line) => {
      const band = (t.line === 'added' || t.line === 'removed') && lineBand(laid(), line);
      return band ? [{ ...band, fill: colors()[t.line as 'added'].fill }] : [];
    }),
  );
  const ranges = createMemo(() =>
    rangeMarks(props.code, laid(), props.look, props.w, props.swatch.fill),
  );
  const bandInk = (line: number) => {
    const t = tokens()?.[line]?.line;
    return t === 'added' || t === 'removed' ? colors()[t].ink : undefined;
  };
  const muted = () => detailInk(props.look, props.swatch),
    mid = CODE_TYPE.lineHeight / 2,
    font = {
      'font-family': CODE_TYPE.family,
      'font-size': String(CODE_TYPE.size),
      'font-weight': String(CODE_TYPE.weight),
    };
  return (
    <g class="code-body" pointer-events="none">
      <For each={bands()}>
        {b => <rect x={1} y={b.y} width={props.w - 2} height={b.h} fill={b.fill} />}
      </For>
      <For each={ranges()}>
        {m => (
          <g class="code-range" opacity={m.opacity < 1 ? m.opacity : undefined}>
            <rect
              x={1}
              y={m.y}
              width={props.w - 2}
              height={m.h}
              fill={m.band}
              fill-opacity={BAND_OPACITY}
            />
            <line
              x1={m.barX}
              y1={m.y}
              x2={m.barX}
              y2={m.y + m.h}
              stroke={m.bar}
              stroke-width={m.barW}
              stroke-dasharray={m.dash}
            />
          </g>
        )}
      </For>
      <Show when={laid().caption}>
        <line
          x1={0}
          y1={laid().caption}
          x2={props.w}
          y2={laid().caption}
          stroke={props.swatch.stroke}
          stroke-width={1}
          stroke-opacity={0.5}
        />
        <text
          x={laid().gutter}
          y={laid().caption / 2}
          dominant-baseline="central"
          font-family={props.look.annotation.family}
          font-size={String(props.look.annotation.size)}
          font-weight={String(props.look.annotation.weight)}
          fill={props.swatch.ink}
          fill-opacity={props.fade}
          text-decoration={props.strike ? 'line-through' : undefined}
        >
          {truncateText(props.caption, props.w - 2 * laid().gutter, props.look.annotation)}
        </text>
      </Show>
      <Show when={props.code.numbers}>
        <text dominant-baseline="central" {...font} fill={muted()}>
          <For each={numbers()}>
            {n => (
              <tspan x={laid().gutter + (laid().numberCols - n.text.length) * CODE_ADVANCE} y={n.y}>
                {n.text}
              </tspan>
            )}
          </For>
        </text>
      </Show>
      <text
        dominant-baseline="central"
        {...font}
        fill={props.swatch.ink}
        fill-opacity={props.fade}
        text-decoration={props.strike ? 'line-through' : undefined}
      >
        <For each={laid().rows}>
          {row => (
            <For
              each={coloredRuns(
                row,
                codeRuns(row, props.code.lines[row.line]),
                tokens()?.[row.line],
              )}
            >
              {run => (
                <tspan
                  x={columnX(laid(), run.col)}
                  y={row.y + mid}
                  fill={run.cls ? colors().tokens[run.cls] : bandInk(row.line)}
                >
                  {run.text}
                </tspan>
              )}
            </For>
          )}
        </For>
        <Show when={laid().moreShown}>
          <tspan x={columnX(laid(), 0)} y={laid().moreY + mid} fill={muted()}>
            {moreText(laid().more)}
          </tspan>
        </Show>
      </text>
      <For each={ranges().filter(m => m.tag)}>
        {m => (
          <g class="code-range-tag" opacity={m.opacity < 1 ? m.opacity : undefined}>
            <rect
              x={m.tag!.x}
              y={m.tag!.y}
              width={m.tag!.w}
              height={m.tag!.h}
              rx={3}
              fill={m.band}
            />
            <text
              x={m.tag!.x + m.tag!.w / 2}
              y={m.tag!.y + m.tag!.h / 2}
              text-anchor="middle"
              dominant-baseline="central"
              font-family={props.look.annotation.family}
              font-size={String(props.look.annotation.size)}
              font-weight={String(props.look.annotation.weight)}
              fill={m.tag!.ink}
            >
              {m.tag!.text}
            </text>
          </g>
        )}
      </For>
      <For each={laid().rows.filter(r => r.wraps)}>
        {row => (
          <path
            d={wrapMarkPath(props.w - laid().gutter / 2, row.y)}
            fill="none"
            stroke={muted()}
            stroke-width={1.1}
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        )}
      </For>
    </g>
  );
}
