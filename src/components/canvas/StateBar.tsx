import { createEffect, createMemo, For, Show } from 'solid-js';
import { unwrap } from 'solid-js/store';
import { renderSvg } from '../../cli/svg';
import { tip } from '../controls';
import { useDiagramSession } from '../session-context';
import { rootOf } from '../../state/dom-root';

/**
 * The file's emphasis states as chips over the canvas: none, each state, and a grid of all of
 * them. Hidden when the file has no `state` lines.
 */
export function StateBar() {
  const s = useDiagramSession();
  return (
    <Show when={s.states().length}>
      <nav class="state-bar" aria-label="Emphasis states">
        <button
          type="button"
          class="state-chip"
          aria-pressed={!s.activeState() && !s.gridOpen()}
          onClick={() => (s.setGridOpen(false), s.showState(null))}
        >
          All
        </button>
        <For each={s.states()}>
          {state => (
            <button
              type="button"
              class="state-chip"
              aria-pressed={s.activeState() === state.id && !s.gridOpen()}
              onClick={() => (s.setGridOpen(false), s.showState(state.id))}
            >
              {state.label}
            </button>
          )}
        </For>
        <span class="state-bar-rule" />
        <button
          type="button"
          class="state-chip"
          aria-pressed={s.gridOpen()}
          onClick={() => s.setGridOpen(!s.gridOpen())}
        >
          Grid
        </button>
      </nav>
      <Show when={s.gridOpen()}>
        <StateGrid />
      </Show>
    </Show>
  );
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Every state side by side, read-only, drawn as `inspect --svg --states` draws it. The wheel zooms
 * and a drag pans every panel together, so the same region is compared across states; a click
 * without a drag opens that state, and Fit shows the whole panels again.
 */
function StateGrid() {
  const s = useDiagramSession();
  const markup = createMemo(() => renderSvg(structuredClone(unwrap(s.doc)), { states: true }));
  let host!: HTMLDivElement;
  let views: SVGGElement[] = [];
  // The same view in every panel: a scale and an offset, in panel units.
  let view = { k: 1, x: 0, y: 0 };
  const apply = () => {
    for (const g of views)
      g.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
  };
  /** Wrap each panel's drawing in a group the view moves, clipped to the panel's own box. */
  createEffect(() => {
    markup();
    const svg = host.querySelector('svg');
    if (!svg) return;
    view = { k: 1, x: 0, y: 0 };
    views = [...svg.querySelectorAll<SVGGElement>('[data-state]')].map((panel, i) => {
      const box = panel.getBBox(),
        clip = document.createElementNS(SVG_NS, 'clipPath'),
        rect = document.createElementNS(SVG_NS, 'rect'),
        inner = document.createElementNS(SVG_NS, 'g');
      clip.id = `state-panel-${i}`;
      for (const [k, v] of Object.entries({
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      }))
        rect.setAttribute(k, String(v));
      clip.append(rect);
      inner.append(...panel.childNodes);
      const frame = document.createElementNS(SVG_NS, 'g');
      frame.setAttribute('clip-path', `url(#${clip.id})`);
      frame.append(inner);
      panel.append(clip, frame);
      return inner;
    });
  });
  /** A pointer position in panel units, in the panel under it (any panel when between them). */
  const local = (e: { clientX: number; clientY: number }) => {
    const svg = host.querySelector('svg')!,
      under = (rootOf(host).elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest(
        '[data-state]',
      ) as SVGGElement | null,
      m = (under ?? svg.querySelector('[data-state]'))!.getScreenCTM()!.inverse();
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m);
    return { x: p.x, y: p.y, unit: m.a };
  };
  let drag: { x: number; y: number; moved: boolean } | null = null;
  return (
    <>
      <div
        ref={host}
        class="state-grid"
        role="dialog"
        aria-label="All emphasis states. Scroll to zoom, drag to pan."
        onWheel={e => {
          e.preventDefault();
          const p = local(e),
            k = Math.min(8, Math.max(1, view.k * Math.exp(-e.deltaY * 0.001)));
          // Keep the point under the pointer where it is, in every panel.
          view = {
            k,
            x: p.x - ((p.x - view.x) * k) / view.k,
            y: p.y - ((p.y - view.y) * k) / view.k,
          };
          apply();
        }}
        onPointerDown={e => (drag = { x: e.clientX, y: e.clientY, moved: false })}
        onPointerMove={e => {
          if (!drag || !(e.buttons & 1)) return;
          const { unit } = local(e),
            dx = e.clientX - drag.x,
            dy = e.clientY - drag.y;
          if (!drag.moved && Math.hypot(dx, dy) < 4) return;
          drag = { x: e.clientX, y: e.clientY, moved: true };
          view = { ...view, x: view.x + dx * unit, y: view.y + dy * unit };
          apply();
        }}
        onClick={e => {
          // Links in the panels would leave the page; a click picks the state instead.
          e.preventDefault();
          const moved = drag?.moved;
          drag = null;
          if (moved) return;
          const panel = (e.target as Element).closest('[data-state]');
          if (!panel) return;
          s.setGridOpen(false);
          s.showState(panel.getAttribute('data-state'));
        }}
        // The markup is drawn from the file by `renderSvg`, which escapes every label.
        // eslint-disable-next-line solid/no-innerhtml
        innerHTML={markup()}
      />
      <button
        type="button"
        class="state-grid-fit"
        {...tip('Fit', undefined, 'Show the whole panels.')}
        onClick={() => ((view = { k: 1, x: 0, y: 0 }), apply())}
      >
        Fit
      </button>
    </>
  );
}
