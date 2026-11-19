import { For, Index, Show } from 'solid-js';
import {
  ExplorerLab,
  type ComparisonConfig,
  type ComparisonRun,
} from '../../engines/explorer-engine';
import { LayoutLab } from '../../engines/layout-engine';
import type { LayoutScope } from '../../engines/layout-engine';
import { ENGINE_PARAMS, paramAttr } from '../../dsl/syntax';
import { INTENT_LABELS, intentPlacements } from '../../model/edits';
import type { IntentRole, LayoutAlgorithmId } from '../../model/types';
import {
  actualSize,
  comparison,
  emphasizeLayer,
  fitAll,
  generate,
  LAYER_COLORS,
  setAllLabels,
  setCameraMode,
  setComparisonIntent,
  setIntentPlacement,
  setLayerOpacity,
  setLayerVisible,
  shownCells,
  updateConfig,
  applyCandidate,
  type CameraMode,
} from '../../state/comparison';
import { exportComparisonSvg, exportExperiment } from '../../state/comparison-export';
import { Checkbox, Field, IconButton, Select, SelectField, tip } from '../controls';
import { activeSession } from '../../state/active-session';

/** Rebuild candidates in a file are source variants: they read only what a `layout` line says. */
const sourceRun = () => activeSession().fileMode() && comparison.config!.run === 'rebuild';

/** The parameters a comparison can vary: in a source run, those a `layout` line can store. */
function savedAxes<T>(params: Record<string, T>) {
  if (!sourceRun()) return params;
  return Object.fromEntries(
    Object.entries(params).filter(
      ([key]) => key === 'direction' || (key !== 'ordering' && paramAttr(ENGINE_PARAMS, key)),
    ),
  );
}

export function ComparisonSidebar() {
  const config = () => comparison.config!;
  const routing = () => config().mode === 'routing';
  const anchorTitle = () =>
    [
      ...(comparison.baseline?.graph.nodes ?? []),
      ...(comparison.baseline?.graph.groups ?? []),
    ].find(n => n.id === comparison.focusId)?.title ?? 'the first shape';
  return (
    <aside class="comparison-sidebar" aria-label="Comparison settings">
      <div class="panel-scroll stack">
        <Show when={comparison.presentation === 'overlay'}>
          <LayerControls />
        </Show>
        <Settings />
        {/* A file's rebuild candidates compile the source, which has no drawing intent to read. */}
        <Show when={!routing() && !sourceRun()}>
          <IntentControls />
        </Show>
        <section class="sidebar-section">
          <h3>Inspect</h3>
          <Show when={comparison.presentation === 'grid'}>
            <SelectField<CameraMode>
              label="Panning"
              value={comparison.cameraMode}
              options={[
                ['independent', 'Each drawing alone'],
                ['sync', 'All drawings together'],
                ['focus', 'Follow the clicked shape'],
              ]}
              onChange={setCameraMode}
            />
          </Show>
          <div class="fields-2">
            <button type="button" class="button" onClick={fitAll}>
              Fit all
            </button>
            <button type="button" class="button" onClick={actualSize}>
              100%
            </button>
          </div>
          <p class="hint">
            {comparison.presentation === 'overlay'
              ? `Layers align on ${anchorTitle()}. Click a shape to align on it instead.`
              : 'Drag or scroll to pan. Pinch to zoom.'}
          </p>
        </section>
        <details class="sidebar-section">
          <summary>Export comparison</summary>
          <div class="stack">
            <button type="button" class="button" onClick={exportComparisonSvg}>
              Save visible format as SVG
            </button>
            <button type="button" class="button" onClick={exportExperiment}>
              Save experiment JSON
            </button>
          </div>
          <p class="hint">The experiment includes the baseline and full candidate documents.</p>
        </details>
      </div>
    </aside>
  );
}

function Settings() {
  const config = () => comparison.config!;
  const routing = () => config().mode === 'routing';
  const params = () =>
    routing()
      ? ExplorerLab.routeParams
      : savedAxes(ExplorerLab.effectiveParams(config().algorithm, config().run));
  const axisOptions = (none: boolean) => [
    ...(none ? [['', 'No second parameter'] as const] : []),
    ...Object.entries(params()).map(([key, p]) => [key, p.name] as const),
  ];
  const defaults = (key: string) =>
    key
      ? ((routing() ? ExplorerLab.routeParams : ExplorerLab.layoutParams)[key]?.values.join(',') ??
        '')
      : '';
  // Keep chosen axes valid for the current approach.
  const ensureAxes = (patch: Partial<ComparisonConfig>) => {
    const next = { ...config(), ...patch },
      defs =
        next.mode === 'routing'
          ? ExplorerLab.routeParams
          : ExplorerLab.effectiveParams(next.algorithm, next.run);
    if (!defs[next.axisA]) {
      patch.axisA = Object.keys(defs)[0];
      patch.valuesA = defs[patch.axisA].values.join(',');
    }
    if (next.axisB && !defs[next.axisB]) {
      patch.axisB = '';
      patch.valuesB = '';
    }
    updateConfig(patch);
  };

  return (
    <section class="sidebar-section">
      <Show
        when={!routing()}
        fallback={
          <>
            <SelectField
              label="Compare"
              value={config().kind}
              options={[
                ['routes', 'Suggested alternatives'],
                ['parameters', 'Parameter grid'],
              ]}
              onChange={kind => ensureAxes({ kind })}
            />
            <Show when={!activeSession().fileMode()}>
              <Checkbox
                label="Release fixed port sides"
                checked={config().autoPorts}
                onChange={autoPorts => updateConfig({ autoPorts })}
              />
            </Show>
          </>
        }
      >
        <SelectField
          label="Compare"
          value={config().kind}
          options={[
            ['algorithms', 'Different approaches'],
            ['parameters', 'Parameter grid'],
          ]}
          onChange={kind => ensureAxes({ kind })}
        />
        <Show when={config().kind === 'parameters'}>
          <SelectField<LayoutAlgorithmId>
            label="Approach"
            value={config().algorithm}
            options={LayoutLab.algorithms.map(a => [a.id, a.name] as const)}
            onChange={algorithm => ensureAxes({ algorithm })}
          />
        </Show>
        <SelectField<ComparisonRun>
          label="Starting point"
          value={config().run}
          options={[
            ['rebuild', 'Start fresh'],
            ['warm', 'From the current drawing'],
            ['pass', 'One small pass'],
          ]}
          onChange={run => ensureAxes({ run })}
        />
      </Show>

      <Show
        when={config().kind !== 'parameters'}
        fallback={
          <div class="fields-2">
            <SelectField
              label="Columns · parameter"
              value={config().axisA}
              options={axisOptions(false)}
              onChange={axisA => updateConfig({ axisA, valuesA: defaults(axisA) })}
            />
            <Field label="Column values">
              <input
                value={config().valuesA}
                onChange={e => updateConfig({ valuesA: e.currentTarget.value })}
              />
            </Field>
            <SelectField
              label="Rows · parameter"
              value={config().axisB}
              options={axisOptions(true)}
              onChange={axisB => updateConfig({ axisB, valuesB: defaults(axisB) })}
            />
            <Field label="Row values">
              <input
                value={config().valuesB}
                disabled={!config().axisB}
                onChange={e => updateConfig({ valuesB: e.currentTarget.value })}
              />
            </Field>
          </div>
        }
      >
        <Show when={!routing()}>
          <details>
            <summary>Approaches · {config().algorithms.length} selected</summary>
            <div class="checkbox-grid" role="group" aria-label="Approaches to compare">
              <For each={LayoutLab.algorithms}>
                {a => (
                  <label class="checkbox" {...tip(a.name, undefined, a.short)}>
                    <input
                      type="checkbox"
                      checked={config().algorithms.includes(a.id)}
                      onChange={e =>
                        updateConfig({
                          algorithms: e.currentTarget.checked
                            ? [...config().algorithms, a.id]
                            : config().algorithms.filter(id => id !== a.id),
                        })
                      }
                    />
                    <span>{a.name}</span>
                  </label>
                )}
              </For>
            </div>
          </details>
        </Show>
      </Show>

      <Show when={!routing()}>
        <details>
          <summary>Scope & effort</summary>
          <SelectField<LayoutScope>
            label="Scope"
            value={config().scope}
            options={[
              ['all', 'Whole diagram'],
              ...(sourceRun() ? [] : [['selection', 'Selected siblings'] as const]),
              ['container', 'Selected group'],
            ]}
            onChange={scope => updateConfig({ scope })}
          />
          <Show when={config().run !== 'pass' && !sourceRun()}>
            <SelectField
              label="Solver effort"
              value={config().maxIterations}
              options={[320, 640, 1200].map(n => [n, `Up to ${n} steps`] as const)}
              onChange={maxIterations => updateConfig({ maxIterations })}
            />
          </Show>
          <p class="hint">Stops once the drawing settles, or at this limit.</p>
        </details>
      </Show>

      <div class="button-row">
        <button
          type="button"
          class="button grow"
          disabled={comparison.busy}
          {...tip('Regenerate', '⌘↵')}
          onClick={() => generate()}
        >
          Regenerate {routing() ? 'routes' : 'layouts'}
        </button>
      </div>
    </section>
  );
}

function IntentControls() {
  const intent = () => comparison.config!.intent;
  const focusedShape = () =>
    comparison.baseline?.graph.nodes.find(n => n.id === comparison.focusId);
  const row = (role: IntentRole) => {
    const hint = () => intent()[role];
    const shape = () => comparison.baseline?.graph.nodes.find(n => n.id === hint()?.id);
    return (
      <div class="intent-entry">
        <div class="row">
          <span class="intent-role">{role === 'start' ? 'Start' : 'End'}</span>
          <strong class="grow truncate">{shape()?.title || 'Not specified'}</strong>
          <Show when={shape()}>
            <IconButton
              icon="close"
              label={`Clear ${role}`}
              onClick={() => setComparisonIntent(role, true)}
            />
          </Show>
        </div>
        <Show when={shape() && hint()}>
          {h => (
            <Select
              aria-label={`${role} placement`}
              value={h().placement}
              options={intentPlacements(role).map(p => [p, INTENT_LABELS[p]] as const)}
              onChange={placement => setIntentPlacement(role, placement)}
            />
          )}
        </Show>
        <button
          type="button"
          class="button small"
          disabled={!focusedShape()}
          onClick={() => setComparisonIntent(role)}
        >
          Use clicked shape as {role}
        </button>
      </div>
    );
  };
  return (
    <details class="sidebar-section" open={!!(intent().start || intent().end)}>
      <summary>Drawing intent {intent().start || intent().end ? '· set' : ''}</summary>
      <p class="hint">
        Optional placement preferences, not pins. Applied only with the chosen candidate.
      </p>
      {row('start')}
      {row('end')}
    </details>
  );
}

function LayerControls() {
  return (
    <section class="sidebar-section">
      <h3>Overlay layers</h3>
      <p class="hint">
        Click a name to emphasize that layer. Its labels are shown; other layers show geometry.
      </p>
      <Index each={comparison.cells}>
        {(c, i) => (
          <Show when={c().status === 'ready' && shownCells().includes(i)}>
            <div
              class="layer-row"
              classList={{ active: i === comparison.overlay.active }}
              style={{ '--layer-color': LAYER_COLORS[i % LAYER_COLORS.length] }}
            >
              <input
                type="checkbox"
                checked={c().layer.visible}
                aria-label={`Show ${c().title}`}
                onChange={e => setLayerVisible(i, e.currentTarget.checked)}
              />
              <button
                type="button"
                class="layer-name"
                aria-pressed={i === comparison.overlay.active}
                {...tip(`Emphasize ${c().title}`)}
                onClick={() => emphasizeLayer(i)}
              >
                <span class="color-dot" />
                <span class="truncate">
                  {shownCells().indexOf(i) + 1}. {c().title}
                </span>
              </button>
              <output>{Math.round(c().layer.opacity * 100)}%</output>
              <input
                type="range"
                min={5}
                max={100}
                step={5}
                value={Math.round(c().layer.opacity * 100)}
                aria-label={`${c().title} opacity`}
                onInput={e => setLayerOpacity(i, Number(e.currentTarget.value) / 100)}
              />
            </div>
          </Show>
        )}
      </Index>
      <Checkbox
        label="Show labels in every layer"
        checked={comparison.overlay.allLabels}
        onChange={setAllLabels}
      />
      <Show
        when={!comparison.cells[comparison.overlay.active]?.current}
        fallback={<p class="hint">Emphasize another layer to apply it.</p>}
      >
        <button
          type="button"
          class="button primary full"
          disabled={comparison.cells[comparison.overlay.active]?.status !== 'ready'}
          onClick={() => applyCandidate(comparison.overlay.active)}
        >
          Apply emphasized candidate
        </button>
        <p class="hint">
          Overlay alignment is visual only. Apply keeps the candidate’s original coordinates.
        </p>
      </Show>
    </section>
  );
}
