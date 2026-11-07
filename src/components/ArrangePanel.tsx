import { createEffect, createMemo, createSignal, For, Show, type JSX } from 'solid-js';
import { LayoutLab as Engine, type LayoutSettingKey } from '../engines/layout-engine.js';
import { layoutShape, type LayoutShape } from '../dsl/layout-edits';
import { ENGINES, FITS, type Fit } from '../dsl/syntax';
import { count } from '../model/candidates';
import { selectionRoots } from '../model/graph';
import type { AspectSetting, Diagram, LayoutAlgorithmId, RoutingSettings } from '../model/types';
import {
  commandEnabled,
  commands,
  runCommand,
  type Command,
  type CommandId,
} from '../state/commands';
import { ROUTE_PRESETS, type RoutePreset } from '../state/session/routing';
import { Checkbox, RangeField, SelectField, tip } from './controls';
import { IntentSummary } from './Inspector';
import { useDiagramSession } from './session-context';
import type { DiagramSession } from '../state/session';

type NumericKey = {
  [K in keyof Diagram['settings']]: Diagram['settings'][K] extends number ? K : never;
}[keyof Diagram['settings']];

function Slider(props: {
  label: string;
  key: NumericKey;
  min: number;
  max: number;
  step?: number;
  hint?: string;
}) {
  const s = useDiagramSession();
  return (
    <RangeField
      label={props.label}
      min={props.min}
      max={props.max}
      step={props.step}
      hint={props.hint}
      value={s.doc.settings[props.key]}
      onChange={value => s.updateLayoutSettings({ [props.key]: value })}
    />
  );
}

/**
 * Settings a rebuild reads, by layout approach. `ordering` is left out: a rebuild always orders
 * ranks to reduce crossings, so the choice only matters to a small pass.
 */
const ENGINE_CONTROLS: Partial<Record<LayoutSettingKey, () => JSX.Element>> = {
  boundaryPull: () => (
    <Slider label="Cross-boundary pull" key="boundaryPull" min={0} max={100} step={5} />
  ),
  hierarchySweeps: () => <Slider label="Hierarchy sweeps" key="hierarchySweeps" min={1} max={4} />,
  groupGap: () => <Slider label="Between groups" key="groupGap" min={12} max={160} step={4} />,
  rankGap: () => <Slider label="Between stages" key="rankGap" min={16} max={180} step={4} />,
  edgeLength: () => <Slider label="Line length" key="edgeLength" min={20} max={220} step={4} />,
  repulsion: () => <Slider label="Repulsion" key="repulsion" min={0} max={100} step={5} />,
  flowStrength: () => (
    <Slider label="Forward pressure" key="flowStrength" min={0} max={100} step={5} />
  ),
  alignment: () => <Slider label="Alignment" key="alignment" min={0} max={100} step={5} />,
  compactness: () => <Slider label="Compactness" key="compactness" min={0} max={100} step={5} />,
  gridStrength: () => (
    <Slider label="Grid attraction" key="gridStrength" min={0} max={100} step={5} />
  ),
  fold: () => <FoldField />,
  rootId: () => <RootField />,
};

function FoldField() {
  const s = useDiagramSession();
  return (
    <SelectField
      label="Long runs"
      value={s.doc.settings.fold}
      options={[
        ['auto', 'Fold to fit'],
        ['never', 'Keep straight'],
      ]}
      onChange={fold => s.updateLayoutSettings({ fold })}
    />
  );
}

function RootField() {
  const s = useDiagramSession();
  return (
    <SelectField
      label="Root"
      value={s.doc.settings.rootId}
      options={[['', 'Automatic'], ...s.doc.graph.nodes.map(n => [n.id, n.title] as const)]}
      onChange={rootId => s.updateLayoutSettings({ rootId })}
    />
  );
}

/** A browser diagram has no `layout` line. Its format is the engine's target aspect instead. */
const ASPECTS: Partial<Record<Fit, AspectSetting>> = {
  wide: '2',
  slide: '1.6',
  square: '1',
  page: '0.75',
};

type Direction = LayoutShape['direction'];

/** How the diagram is arranged: direction, format and connections, with the exact values below. */
export function ArrangePanel() {
  const s = useDiagramSession();
  const scope = () => (s.fileMode() ? s.arrangeScope() : 'root');
  const loose = () => s.currentScope().scope === 'selection' && s.labScope() === 'auto';
  // The scene changes with every saved revision; read it so the panel follows the file.
  const shape = createMemo(() => {
    s.fileScene();
    const id = scope();
    return id && s.fileMode()
      ? layoutShape(s.layoutPreview()?.file?.source ?? s.currentSource(), id)
      : null;
  });
  const direction = (): Direction =>
    shape()?.direction ?? (s.doc.settings.direction === 'DOWN' ? 'down' : 'right');
  const fit = (): Fit | null =>
    s.fileMode()
      ? (shape()?.fit ?? null)
      : ((Object.keys(ASPECTS) as Fit[]).find(f => ASPECTS[f] === s.doc.settings.aspect) ?? null);

  const setDirection = (next: Direction) => {
    if (s.fileMode()) return void s.previewShape({ direction: next });
    void s.previewSettings({ direction: next === 'down' ? 'DOWN' : 'RIGHT' });
  };
  const setFit = (next: Fit | null) => {
    if (s.fileMode()) return void s.previewShape({ fit: next });
    void s.previewSettings({ aspect: next ? ASPECTS[next] : 'canvas' });
  };

  const canReshape = () => !!scope() && !loose();
  const axisOnly = () => ['row', 'column'].includes(shape()?.recipe ?? '');
  const hasFormat = () => (!s.fileMode() || scope() === 'root') && !s.rebuildBlocked();

  return (
    <div class="panel-scroll arrange">
      <Subject line={s.fileMode() ? recipeLine(s, scope(), shape()) : null} />

      <Show when={canReshape() && !s.rebuildBlocked()}>
        <ActionButton command="layout-rebuild" label="Lay out again" primary />
      </Show>

      <Show when={!s.movesBlocked()} fallback={<p class="hint">{s.movesBlocked()}</p>}>
        <Show
          when={canReshape()}
          fallback={
            <p class="hint">
              Direction and format apply to the whole diagram or to one group. Select a group, or
              clear the selection.
            </p>
          }
        >
          <section class="arrange-field">
            <h3>Direction</h3>
            <Choices<Direction>
              label="Direction"
              value={direction()}
              options={[
                ...(s.fileMode() && !axisOnly() ? [['auto', 'Auto'] as const] : []),
                ['right', 'Right'],
                ['down', 'Down'],
              ]}
              onChange={setDirection}
              hints={{ auto: 'Reads whichever way fits best.' }}
            />
          </section>
          <Show when={hasFormat()}>
            <section class="arrange-field">
              <h3>Format</h3>
              <FormatPicker value={fit()} onChange={setFit} />
            </section>
          </Show>
          <Show when={!s.rebuildBlocked()}>
            <ActionButton command="compare-layouts" label="Compare alternatives" />
          </Show>
        </Show>
      </Show>

      <Show when={!s.routesBlocked()}>
        <Connections />
      </Show>

      <Show when={!s.movesBlocked()}>
        <details class="arrange-more">
          <summary>Exact layout</summary>
          <ExactLayout />
        </details>
      </Show>
      <Show when={!s.routesBlocked()}>
        <details class="arrange-more">
          <summary>Exact routing</summary>
          <ExactRouting />
        </details>
      </Show>
      <Show when={!s.movesBlocked()}>
        <details class="arrange-more">
          <summary>Local tools</summary>
          <LocalTools />
        </details>
      </Show>
    </div>
  );
}

/** The scope's line as the file says it now, or as a preview would save it. */
function recipeLine(s: DiagramSession, scope: string | null, shape: LayoutShape | null) {
  if (!scope || !shape) return null;
  const line = (s.layoutPreview()?.file?.source ?? s.currentSource())
    .split('\n')
    .find(l => new RegExp(`^layout ${scope}\\b`).test(l));
  return line?.split(' #')[0].trim() ?? `Built-in ${shape.recipe} recipe`;
}

/** What the panel acts on: it follows the selection, so there is no scope to set. */
function Subject(props: { line: string | null }) {
  const s = useDiagramSession();
  const name = () => {
    const roots = selectionRoots(s.doc, s.selection());
    const id = s.currentScope().containerId;
    if (id) return s.doc.graph.groups.find(g => g.id === id)?.title ?? id;
    if (roots.length) return `${roots.length} ${roots.length === 1 ? 'shape' : 'shapes'}`;
    return 'Whole diagram';
  };
  return (
    <header class="arrange-subject">
      <strong>{name()}</strong>
      <Show when={props.line}>
        {line => <code classList={{ unsaved: !!s.layoutPreview() }}>{line()}</code>}
      </Show>
    </header>
  );
}

function ActionButton(props: { command: CommandId; label: string; primary?: boolean }) {
  const command = (): Command => commands[props.command];
  return (
    <button
      type="button"
      class="button"
      classList={{ primary: props.primary }}
      disabled={!commandEnabled(props.command)}
      {...tip(command().label, command().keys, command().hint)}
      onClick={() => runCommand(props.command)}
    >
      {props.label}
    </button>
  );
}

/**
 * The choice being compiled, so a click answers at once on a drawing that takes a while. It ends
 * when the drawing catches up.
 */
function useAsked<T>(value: () => T) {
  const s = useDiagramSession();
  const [asked, setAsked] = createSignal<T>();
  createEffect(() => {
    value();
    if (!s.layoutBusy()) setAsked(undefined);
  });
  const shown = (option: T) => (asked() === undefined ? value() : asked()) === option;
  return { asked, setAsked, shown };
}

/** A segmented choice whose active button is what the drawing is now. */
function Choices<T extends string>(props: {
  label: string;
  value: T | null;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (value: T) => void;
  hints?: Partial<Record<T, string>>;
}) {
  const { asked, setAsked, shown } = useAsked(() => props.value);
  return (
    <div class="segmented full" role="group" aria-label={props.label}>
      <For each={props.options}>
        {([value, text]) => (
          <button
            type="button"
            aria-pressed={shown(value)}
            classList={{ pending: asked() === value }}
            {...(props.hints?.[value] ? tip(text, undefined, props.hints[value]) : {})}
            onClick={() => {
              if (shown(value)) return;
              setAsked(() => value);
              props.onChange(value);
            }}
          >
            {text}
          </button>
        )}
      </For>
    </div>
  );
}

/** Each format drawn to its own proportions, so the shape is the label. */
function FormatPicker(props: { value: Fit | null; onChange: (fit: Fit | null) => void }) {
  const s = useDiagramSession();
  const { asked, setAsked, shown } = useAsked(() => props.value ?? 'auto');
  const choose = (next: Fit | 'auto') => {
    if (shown(next)) return;
    setAsked(() => next);
    props.onChange(next === 'auto' ? null : next);
  };
  const options = () =>
    (Object.keys(FITS) as Fit[]).filter(f => s.fileMode() || ASPECTS[f] !== undefined);
  const glyph = (ratio: number) => ({
    width: `${ratio >= 1 ? 18 : 18 * ratio}px`,
    height: `${ratio >= 1 ? 18 / ratio : 18}px`,
  });
  return (
    <div class="format-picker" role="group" aria-label="Format">
      <button
        type="button"
        aria-pressed={shown('auto')}
        classList={{ pending: asked() === 'auto' }}
        {...tip('Auto', undefined, 'No target shape. The drawing takes the size it needs.')}
        onClick={() => choose('auto')}
      >
        <span class="format-shape">
          <span class="format-glyph auto" />
        </span>
        Auto
      </button>
      <For each={options()}>
        {fit => (
          <button
            type="button"
            aria-pressed={shown(fit)}
            classList={{ pending: asked() === fit }}
            onClick={() => choose(fit)}
          >
            <span class="format-shape">
              <span class="format-glyph" style={glyph(FITS[fit])} />
            </span>
            {fit[0].toUpperCase() + fit.slice(1)}
          </button>
        )}
      </For>
    </div>
  );
}

function Connections() {
  const s = useDiagramSession();
  const report = () => s.routingReport();
  return (
    <section class="arrange-field">
      <h3>Connections</h3>
      <Choices<RoutePreset>
        label="Connection routing"
        value={s.activeRoutePreset()}
        options={(Object.keys(ROUTE_PRESETS) as RoutePreset[]).map(p => [p, p] as const)}
        onChange={s.applyRoutePreset}
      />
      <Show when={!s.activeRoutePreset()}>
        <p class="hint">Custom values are set. A preset replaces them.</p>
      </Show>
      <div class="arrange-actions">
        <ActionButton command="reroute" label="Reroute" />
        <ActionButton command="compare-routes" label="Compare" />
      </div>
      <p class="hint">
        {count(report().crossings, 'crossing')} · {count(report().bends, 'bend')}
        <Show when={report().lanePairs}> · {count(report().lanePairs, 'close line')}</Show>
      </p>
    </section>
  );
}

/** Every setting by what it changes: the rebuild, then the small moves of Tidy. */
function ExactLayout() {
  const s = useDiagramSession();
  const rebuildEngine = () =>
    s.fileMode()
      ? (s.labEngine() ?? (engineOf() as LayoutAlgorithmId | null))
      : s.doc.settings.algorithm;
  const engineOf = () => {
    const id = s.arrangeScope();
    if (!id) return null;
    s.fileScene();
    const shape = layoutShape(s.layoutPreview()?.file?.source ?? s.currentSource(), id);
    return shape.engine ? shape.recipe : null;
  };
  const algorithm = () => Engine.algorithms.find(a => a.id === rebuildEngine());
  const engines = () =>
    Engine.algorithms.filter(a => !s.fileMode() || ENGINES.includes(a.id)).map(a => [a.id, a.name]);
  const writes = () => {
    const id = s.arrangeScope(),
      engine = rebuildEngine();
    if (!id || !engine || !s.labEngine()) return null;
    return s.changedLine(s.sourceWithRecipe(id, { ...s.doc.settings, algorithm: engine }).source);
  };
  const improver = () => Engine.algorithms.find(a => a.id === s.doc.settings.algorithm)!;
  return (
    <div class="stack">
      <Show when={!s.rebuildBlocked()}>
        <section class="arrange-field">
          <h3>Rebuild</h3>
          <SelectField<string>
            label="Rebuild with"
            value={rebuildEngine() ?? ''}
            options={[
              ...(s.fileMode() ? [['', 'Built-in recipe'] as const] : []),
              ...(engines() as Array<[string, string]>),
            ]}
            onChange={value => {
              if (!s.fileMode())
                return s.updateLayoutSettings({ algorithm: value as LayoutAlgorithmId });
              const leavesEngine = !value && engineOf();
              s.setLabEngine((value || null) as LayoutAlgorithmId | null);
              if (leavesEngine) void s.previewShape({ builtin: true });
            }}
          />
          <Show when={algorithm()}>
            {a => (
              <>
                <p class="hint">{a().short}</p>
                <For each={a().controls}>{key => ENGINE_CONTROLS[key]?.()}</For>
                <Slider label="Between shapes" key="nodeGap" min={8} max={96} step={4} />
              </>
            )}
          </Show>
          <Show when={s.fileMode() && !algorithm() && s.arrangeScope()}>
            <RecipeControls />
          </Show>
          <Show when={writes()}>{line => <code class="recipe-line next">{line()}</code>}</Show>
          <Show when={s.labEngine()}>
            <button type="button" class="button" onClick={() => runCommand('layout-rebuild')}>
              Preview rebuild <kbd>⇧L</kbd>
            </button>
          </Show>
        </section>
      </Show>
      <section class="arrange-field">
        <h3>Tidy</h3>
        <Show when={s.fileMode()}>
          <SelectField<LayoutAlgorithmId>
            label="Tidy with"
            value={s.doc.settings.algorithm}
            options={Engine.algorithms.map(a => [a.id, a.name] as const)}
            onChange={value => s.updateLayoutSettings({ algorithm: value })}
          />
          <p class="hint">{improver().short}</p>
        </Show>
        <Slider label="Largest move" key="maxMove" min={8} max={192} step={8} />
        <Slider label="Stay near the drawing" key="stability" min={0} max={100} step={5} />
        <Slider label="Solver effort" key="iterations" min={8} max={96} step={8} />
        <SelectField
          label="Order within a stage"
          value={s.doc.settings.ordering}
          options={[
            ['stable', 'Keep current order'],
            ['crossings', 'Reduce crossings'],
          ]}
          onChange={ordering => s.updateLayoutSettings({ ordering })}
        />
        <Show when={s.currentScope().scope !== 'all'}>
          <Checkbox
            label="Include one-hop neighbours"
            checked={s.labScope() === 'neighbourhood'}
            onChange={on => s.setLabScope(on ? 'neighbourhood' : 'auto')}
          />
        </Show>
        <Checkbox
          label="Respect arrow direction"
          checked={s.doc.settings.respectDirection}
          onChange={respectDirection => s.updateLayoutSettings({ respectDirection })}
        />
        <Checkbox
          label="Protect shapes moved by hand"
          checked={s.doc.settings.respectManual}
          onChange={respectManual => s.updateLayoutSettings({ respectManual })}
        />
        <Checkbox
          label="Let groups grow"
          checked={s.doc.settings.growContainers}
          onChange={growContainers => s.updateLayoutSettings({ growContainers })}
        />
      </section>
      <Show when={!s.fileMode()}>
        <IntentSummary />
      </Show>
    </div>
  );
}

/** The recipe's own settings. Each change previews, like Direction and Format. */
function RecipeControls() {
  const s = useDiagramSession();
  const shape = () => {
    s.fileScene();
    const id = s.arrangeScope();
    return id ? layoutShape(s.layoutPreview()?.file?.source ?? s.currentSource(), id) : null;
  };
  return (
    <Show when={!s.rebuildBlocked() && shape()}>
      {current => (
        <>
          <RangeField
            label="Gap"
            min={8}
            max={120}
            step={4}
            value={current().gap ?? 28}
            onChange={gap => void s.previewShape({ gap })}
          />
          <Show when={current().recipe === 'flow'}>
            <SelectField
              label="Long runs"
              value={current().fold}
              options={[
                ['auto', 'Fold to fit'],
                ['never', 'Keep straight'],
              ]}
              onChange={fold => void s.previewShape({ fold })}
            />
          </Show>
        </>
      )}
    </Show>
  );
}

type RouteField = [Exclude<keyof RoutingSettings, 'bundle'>, string, number, number, string?];

const ROUTE_SPACING: RouteField[] = [
  ['clearance', 'Around shapes', 4, 30],
  ['standoff', 'Before the first bend', 0, 40],
  ['portGap', 'At endpoints', 6, 28],
  ['edgeGap', 'Between lines', 4, 48],
];
const ROUTE_COSTS: RouteField[] = [
  ['crossingPenalty', 'Crossing', 0, 1200, 'Higher values prefer detours over crossings.'],
  ['bendPenalty', 'Bend', 0, 100],
  ['parallelPenalty', 'Close lines', 0, 60],
  ['sharedPenalty', 'Shared path', 0, 20],
  ['fanoutPenalty', 'Fan-out', 0, 160, 'Prefer different sides for separate branches.'],
  ['portStability', 'Changing sides', 0, 150],
];

function ExactRouting() {
  const s = useDiagramSession();
  const field = ([key, label, min, max, hint]: RouteField) => (
    <RangeField
      label={label}
      min={min}
      max={max}
      hint={hint}
      value={s.doc.settings.routing[key]}
      onChange={value => s.setRouting({ [key]: value }, 'Change routing settings')}
    />
  );
  return (
    <div class="stack">
      <section class="arrange-field">
        <h3>Spacing</h3>
        <For each={ROUTE_SPACING}>{field}</For>
      </section>
      <section class="arrange-field">
        <h3>Costs</h3>
        <For each={ROUTE_COSTS}>{field}</For>
        {field(['passes', 'Passes', 1, 5])}
      </section>
    </div>
  );
}

function LocalTools() {
  const s = useDiagramSession();
  return (
    <div class="arrange-actions wrap">
      <ActionButton command="timeline-toggle" label="Timeline" />
      <ActionButton command="brush-toggle" label="Brush" />
      <Show when={!s.fileMode()}>
        <ActionButton command="layout-checkpoint" label="Checkpoint" />
        <Show when={s.layoutCheckpoint()}>
          <ActionButton command="layout-restore" label="Restore" />
        </Show>
      </Show>
    </div>
  );
}
