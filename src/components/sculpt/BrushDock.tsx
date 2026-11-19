import { Show } from 'solid-js';
import type { BrushMode } from '../../engines/sculpt-engine';
import { Checkbox, IconButton, RangeField, Select } from '../controls';
import { useDiagramSession } from '../session-context';

const MODES: [BrushMode, string][] = [
  ['tidy', 'Tidy nearby'],
  ['flow', 'Nudge into flow'],
  ['space', 'Make space'],
  ['restore', 'Restore from bookmark'],
  ['protect', 'Hold this area'],
];

/** Settings for the local layout brush. */
export function BrushDock() {
  const s = useDiagramSession();
  const hint = () => {
    const h = s.brushHover();
    if (!h) return 'Hover previews. Hold or drag to paint. [ / ] size · Alt restores · Space pans.';
    const n = Object.keys(h.weights).length;
    if (!n)
      return `No movable shapes here${h.locked.length ? ' · ' + h.locked.length + ' protected' : ''} · [ / ] changes the radius`;
    const detail = h.blocked
      ? 'movement blocked by nearby shapes'
      : h.mode === 'restore'
        ? 'restore locally; the rest stays put'
        : 'hover is preview only; drag to paint';
    return `${n} eligible · ${h.locked.length} protected · ${detail}`;
  };
  return (
    <Show when={s.brushActive()}>
      <section class="brush-dock floating-panel" aria-label="Layout brush controls">
        <header class="panel-header compact">
          <span class="eyebrow">Local layout</span>
          <IconButton
            icon="close"
            label="Exit layout brush"
            keys="Esc"
            onClick={() => {
              s.deactivateBrush();
              s.setTool('select');
            }}
          />
        </header>
        <label class="field">
          <span class="field-label">Brush</span>
          <Select
            value={s.brushSettings().mode}
            options={MODES}
            onChange={mode => s.updateBrushSettings({ mode })}
          />
        </label>
        <RangeField
          label="Radius"
          unit=" px"
          min={40}
          max={600}
          step={10}
          value={s.brushSettings().radius}
          onInput={radius => s.updateBrushSettings({ radius })}
          onChange={radius => s.updateBrushSettings({ radius })}
        />
        <RangeField
          label="Strength"
          unit="%"
          min={1}
          max={100}
          value={s.brushSettings().strength}
          onInput={strength => s.updateBrushSettings({ strength })}
          onChange={strength => s.updateBrushSettings({ strength })}
        />
        <RangeField
          label="Soft edge"
          unit="%"
          min={0}
          max={100}
          value={s.brushSettings().softness}
          onInput={softness => s.updateBrushSettings({ softness })}
          onChange={softness => s.updateBrushSettings({ softness })}
        />
        <Checkbox
          label="Hold restored nodes for the next layout"
          checked={s.brushSettings().holdRestored}
          onChange={holdRestored => s.updateBrushSettings({ holdRestored })}
        />
        <div class="brush-row">
          <span>
            Restore: <strong>{s.referenceLabel()}</strong>
          </span>
          <button type="button" class="button ghost small" onClick={s.useCurrentAsReference}>
            Use current
          </button>
        </div>
        <div class="brush-row">
          <span>{s.heldIds().length} local holds</span>
          <button type="button" class="button ghost small" onClick={s.clearHolds}>
            Clear holds
          </button>
        </div>
        <div class="button-row">
          <button
            type="button"
            class="button"
            onClick={() => {
              s.deactivateBrush();
              void s.openTimeline();
            }}
          >
            Preview from here
          </button>
          <button type="button" class="button ghost" onClick={s.reopenTimeline}>
            Last path
          </button>
        </div>
        <p class="hint" aria-live="polite">
          {hint()}
        </p>
      </section>
    </Show>
  );
}
