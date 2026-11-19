import { createMemo, For, onMount, Show } from 'solid-js';
import { LayoutLab } from '../../engines/layout-engine';
import { clamp } from '../../model/geometry';
import { type GhostMode } from '../../state/session/sculpt';
import { IconButton, Select, tip } from '../controls';
import { useDiagramSession } from '../session-context';

/** Scrub recorded layout steps, bookmark one as a restore source, and keep a step. */
export function TimelineDeck() {
  const s = useDiagramSession();
  let deck!: HTMLElement;
  return (
    <Show when={s.timeline()}>
      {t => {
        const algorithm = () =>
          LayoutLab.algorithms.find(a => a.id === t().algorithm)?.name ?? 'Layout';
        return (
          <section ref={deck} class="timeline-deck floating-panel" aria-label="Layout timeline">
            <header class="timeline-head">
              <div class="timeline-title">
                <span class="eyebrow">Layout timeline</span>
                <strong>
                  {algorithm()} <span class="muted">· {t().scope}</span>
                </strong>
              </div>
              <span class="timeline-outcome">
                {t().busy
                  ? 'Computing a finish. Your diagram is unchanged.'
                  : `${t().data!.report.termination} · ${t().data!.report.iterations} solver steps`}
              </span>
              <button
                type="button"
                class="button ghost"
                {...tip(
                  'Fit path',
                  undefined,
                  'Fit every recorded arrangement in one steady camera.',
                )}
                onClick={() => s.fitTimelinePath(deck.offsetHeight)}
              >
                Fit path
              </button>
              <label class="inline-label">
                Ghost
                <Select<GhostMode>
                  aria-label="Preview ghost"
                  value={t().ghost}
                  options={[
                    ['next', 'Next meaningful change'],
                    ['final', 'Computed finish'],
                    ['off', 'Off'],
                  ]}
                  onChange={s.setGhost}
                />
              </label>
              <IconButton
                icon="close"
                label="Cancel layout timeline"
                keys="Esc"
                onClick={s.closeTimeline}
              />
            </header>
            <Show when={!t().busy && t().data} fallback={<TimelineLoading />}>
              <TimelineTrack />
            </Show>
          </section>
        );
      }}
    </Show>
  );
}

function TimelineLoading() {
  const s = useDiagramSession();
  return (
    <div class="timeline-loading">
      <span class="spinner" />
      <p>Recording intermediate arrangements, not just the start and end.</p>
      <button type="button" class="button" onClick={s.closeTimeline}>
        Cancel
      </button>
    </div>
  );
}

function TimelineTrack() {
  const s = useDiagramSession();
  let slider!: HTMLInputElement;
  onMount(() => slider.focus({ preventScroll: true }));
  const t = () => s.timeline()!;
  const data = () => t().data!;
  const max = () => data().frames.length - 1;
  const shown = () => t().peek ?? t().index;
  const moved = createMemo(() => {
    const f = data().frames[shown()],
      first = data().frames[0];
    return Object.keys(f.nodes).filter(
      id => Math.hypot(f.nodes[id].x - first.nodes[id].x, f.nodes[id].y - first.nodes[id].y) > 0.05,
    ).length;
  });
  const go = (i: number) => {
    s.stopPlayback();
    s.scrub(i);
  };

  return (
    <>
      <div class="timeline-track-row">
        <button
          type="button"
          class="button"
          aria-pressed={s.playing()}
          disabled={!max()}
          onClick={s.togglePlayback}
        >
          {s.playing() ? 'Pause' : 'Play'}
        </button>
        <IconButton
          icon="chevron-left"
          label="Previous layout step"
          onClick={() => go(t().index - 1)}
        />
        <div class="timeline-track">
          <input
            ref={slider}
            id="timeline-slider"
            type="range"
            min={0}
            max={max()}
            step={1}
            value={t().index}
            disabled={!max()}
            aria-label="Recorded layout step"
            aria-valuetext={`Step ${t().index} of ${max()}. ${data().frames[t().index].phase}`}
            onInput={e => go(Number(e.currentTarget.value))}
            onPointerMove={e => {
              // Hovering the track previews a step without choosing it.
              if (e.buttons || s.playing()) return;
              const r = e.currentTarget.getBoundingClientRect(),
                ratio = clamp((e.clientX - r.left - 7) / (r.width - 14), 0, 1);
              s.scrub(Math.round(ratio * max()), { peek: true });
            }}
            onPointerOut={s.endPeek}
          />
          <div class="timeline-marks">
            <For each={data().bookmarks}>
              {b => (
                <button
                  type="button"
                  style={{ left: `${max() ? (b.index / max()) * 100 : 0}%` }}
                  {...tip(b.title)}
                  aria-label={`Jump to ${b.title}`}
                  onClick={() => go(b.index)}
                />
              )}
            </For>
          </div>
          <div class="timeline-track-labels">
            <button type="button" class="link-button" onClick={() => go(0)}>
              Your arrangement
            </button>
            <span>
              {t().peek !== null ? 'Peek · ' : ''}
              {shown()} / {max()}
            </span>
            <button type="button" class="link-button" onClick={() => go(max())}>
              Computed finish
            </button>
          </div>
        </div>
        <IconButton
          icon="chevron-right"
          label="Next layout step"
          onClick={() => go(t().index + 1)}
        />
        <span class="timeline-motion">
          <b>{moved()}</b> moved <span>{data().frames[shown()].metrics.overlaps} overlaps</span>
        </span>
      </div>
      <div class="timeline-foot">
        <button
          type="button"
          class="button"
          {...tip('Bookmark for restore', undefined, 'Use this step as a restore source later.')}
          onClick={s.bookmarkStep}
        >
          Bookmark for restore
        </button>
        <select
          aria-label="Jump to bookmark"
          onChange={e => {
            if (e.currentTarget.value !== '') go(Number(e.currentTarget.value));
            e.currentTarget.value = '';
          }}
        >
          <option value="">Jump to bookmark…</option>
          <For each={data().bookmarks}>
            {b => (
              <option value={b.index}>
                {b.title} · {b.index}
              </option>
            )}
          </For>
        </select>
        <span class="timeline-note">
          {t().peek !== null
            ? 'Hover preview only · leave the track to return to your chosen step.'
            : 'Recorded steps—not % optimal. Bookmark a good area, then restore it with the brush.'}
        </span>
        <span class="grow" />
        <button type="button" class="button" onClick={() => s.keepStep({ brush: true })}>
          Keep & brush
        </button>
        <button type="button" class="button primary" onClick={() => s.keepStep()}>
          Keep & edit
        </button>
      </div>
    </>
  );
}
