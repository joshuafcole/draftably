import { createEffect, For, Match, on, Show, Switch, type JSX } from 'solid-js';
import * as edits from '../model/edits';
import {
  ancestors,
  descendants,
  findEdge,
  findGroup,
  findNode,
  findObject,
  isCell,
  isGroup,
  styleOf,
} from '../model/graph';
import { nodeLabel } from '../model/labels';
import {
  groupShadeFor,
  NODE_SHADE,
  resolveAppearance,
  shadesOf,
  swatchFor,
  type Shade,
} from '../model/appearance';
import { headOf, MARKERS, tailOf } from '../model/markers';
import { DSL_SHAPES } from '../dsl/syntax';
import { NODE_ICONS, SHAPE_LABELS, SHAPES } from '../model/styles';
import type { ColorKey, Diagram, IntentRole, LabelMode, PortSide, ShapeKind } from '../model/types';
import { runCommand, type CommandId } from '../state/commands';
import {
  parseTextId,
  removeText,
  setTextValue,
  TEXT_NAMES,
  textValue,
} from '../state/session/canvas-text';
import { NOTE_SIDES, noteSide, type Note } from '../model/note';
import { labelFocus, setRightTab } from '../state/ui';
import { Checkbox, Field, IconButton, NumberField, SelectField, tip } from './controls';
import { CommandButton as IconCommand } from './CommandButton';
import { describeLink } from '../state/links';
import { openLink } from '../state/open-link';
import { useDiagramSession } from './session-context';

/** Properties of the selection, or diagram-wide preferences when nothing is selected. */
export function Inspector() {
  const s = useDiagramSession();
  const ids = () => s.selectedIds();
  return (
    <fieldset class="panel-scroll inspector" disabled={s.timelineOpen()}>
      <Switch fallback={<NothingSelected />}>
        <Match when={s.selectedText()}>{id => <TextInspector id={id()} />}</Match>
        <Match when={ids().length > 1}>
          <MultipleSelected count={ids().length} />
        </Match>
        <Match when={ids().length === 1 && findEdge(s.doc, ids()[0]) && ids()[0]}>
          {id => <EdgeInspector id={id()} />}
        </Match>
        <Match when={ids().length === 1 && findObject(s.doc, ids()[0]) && ids()[0]}>
          {id => <ObjectInspector id={id()} />}
        </Match>
      </Switch>
    </fieldset>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Section(props: { title?: string; children: JSX.Element }) {
  return (
    <section class="inspector-section">
      <Show when={props.title}>
        <h3>{props.title}</h3>
      </Show>
      {props.children}
    </section>
  );
}

function Heading(props: { title: string }) {
  return (
    <div class="inspector-heading">
      <strong>{props.title}</strong>
    </div>
  );
}

function CommandButton(props: { command: CommandId; children: JSX.Element; class?: string }) {
  return (
    <button
      type="button"
      class={`button ${props.class ?? ''}`}
      onClick={() => runCommand(props.command)}
    >
      {props.children}
    </button>
  );
}

/** Color families in the diagram's theme, plus `auto` for the theme's default surface. */
function Swatches(props: { selected?: ColorKey; shade?: Shade; group?: boolean }) {
  const s = useDiagramSession();
  const look = () => resolveAppearance(s.doc.appearance);
  const families = () =>
    ['auto', ...look().families.keys()].filter(f => f === 'auto' || shadesOf(look(), f).length);
  const preview = (family: string) =>
    family === 'auto'
      ? swatchFor(look(), 'auto', undefined, props.group ? 'group' : 'node')
      : swatchFor(
          look(),
          family,
          shadesOf(look(), family).includes(NODE_SHADE)
            ? NODE_SHADE
            : shadesOf(look(), family).at(-1),
        );
  return (
    <div class="color-picker">
      <div class="swatches" role="group" aria-label="Color family">
        <For each={families()}>
          {key => (
            <button
              type="button"
              classList={{ selected: props.selected === key, auto: key === 'auto' }}
              aria-label={key === 'auto' ? 'Theme default' : key}
              aria-pressed={props.selected === key}
              {...tip(key === 'auto' ? 'Theme default' : capitalize(key))}
              style={{ background: preview(key).fill, 'border-color': preview(key).stroke }}
              onClick={() => s.setColor(key)}
            />
          )}
        </For>
      </div>
      <Show when={props.selected && props.selected !== 'auto'}>
        <ShadePicker family={props.selected!} shade={props.shade} group={props.group} />
      </Show>
    </div>
  );
}

/** Numeric shades of a family, light to dark; the object's default shade is marked. */
function ShadePicker(props: { family: string; shade?: Shade; group?: boolean }) {
  const s = useDiagramSession();
  const look = () => resolveAppearance(s.doc.appearance);
  const fallback = () => (props.group ? groupShadeFor(look().theme) : NODE_SHADE);
  const current = () => props.shade ?? fallback();
  return (
    <div class="shades" role="radiogroup" aria-label={`${props.family} shade`}>
      <For each={shadesOf(look(), props.family)}>
        {shade => {
          const swatch = () => swatchFor(look(), props.family, shade);
          return (
            <button
              type="button"
              role="radio"
              aria-checked={current() === shade}
              classList={{ selected: current() === shade }}
              {...tip(
                `${capitalize(props.family)} ${shade}`,
                undefined,
                shade === fallback() ? 'Default shade' : undefined,
              )}
              style={{ background: swatch().fill, color: swatch().ink }}
              onClick={() => s.setShade(shade === fallback() ? undefined : shade)}
            >
              {shade}
            </button>
          );
        }}
      </For>
    </div>
  );
}

function TextField(props: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  ref?: (el: HTMLInputElement) => void;
  /** Runs after Enter saves the field, to hand the keys on. */
  onEnter?: () => void;
}) {
  return (
    <Field label={props.label}>
      <input
        ref={props.ref}
        value={props.value}
        onChange={e => props.onCommit(e.currentTarget.value)}
        onKeyDown={e => {
          if (e.key !== 'Enter' || !props.onEnter) return;
          // Leaving the field saves it, as Enter does; then the keys go on.
          e.currentTarget.blur();
          props.onEnter();
        }}
      />
    </Field>
  );
}

const NOTE_SIDE_OPTIONS = NOTE_SIDES.map(s => [s, capitalize(s)] as const);

/** A title, note, legend row or phase label: its words, and for a note where it sits. */
function TextInspector(props: { id: string }) {
  const s = useDiagramSession();
  const kind = () => parseTextId(props.id)!.kind;
  const value = () => textValue(s.doc, props.id);
  const note = () =>
    kind() === 'note' ? s.doc.appearance.notes?.[Number(parseTextId(props.id)!.key)] : undefined;
  const setNote = (label: string, fn: (n: Note) => void) =>
    s.transact(label, d => fn(d.appearance.notes![Number(parseTextId(props.id)!.key)]));
  return (
    <Show when={value() !== undefined} fallback={<NothingSelected />}>
      <Heading title={capitalize(TEXT_NAMES[kind()])} />
      <Section>
        <TextField
          label="Text"
          value={value()!}
          onCommit={v => {
            s.transact(`Edit ${TEXT_NAMES[kind()]}`, d => setTextValue(d, props.id, v.trim()));
            if (!v.trim()) s.clearSelection();
          }}
        />
        <Show when={note()?.near}>
          {near => (
            <SelectField
              label={`Beside ${findObject(s.doc, near())?.title ?? findEdge(s.doc, near())?.label ?? near()}`}
              value={noteSide(s.doc, note()!)}
              options={NOTE_SIDE_OPTIONS}
              onChange={v => setNote('Move note', n => void (n.side = v))}
            />
          )}
        </Show>
        <p class="hint">
          Double-click it on the canvas to edit in place.
          {kind() === 'note'
            ? ' Drag it beside another shape, container or message to move it.'
            : ''}
        </p>
      </Section>
      <Show when={kind() === 'note' || kind() === 'footnote' || kind() === 'legend'}>
        <Section>
          <button
            type="button"
            class="button"
            onClick={() => {
              s.transact(`Delete ${TEXT_NAMES[kind()]}`, d => removeText(d, props.id));
              s.clearSelection();
            }}
          >
            Delete {TEXT_NAMES[kind()]}
          </button>
        </Section>
      </Show>
    </Show>
  );
}

function NothingSelected() {
  const s = useDiagramSession();
  return (
    <>
      <p class="hint">Select a shape, connection or container to edit it.</p>
      <Show when={s.doc.layout.intent.start || s.doc.layout.intent.end}>
        <IntentSummary />
      </Show>
      {/* The file's layout line holds the switch, so only a file can change it. */}
      <Show when={s.doc.layout.sequence && s.fileMode()}>
        <Section title="Sequence">
          <Checkbox
            label="Activation bars"
            checked={!!s.doc.layout.sequence?.bars}
            onChange={v => s.transact('Edit activation bars', d => edits.setActivations(d, v))}
          />
          <p class="hint">A bar runs from each call to the reply that answers it.</p>
        </Section>
      </Show>
      <Section>
        {/* Editor preferences, which belong to the session and not to the drawing. */}
        <Checkbox
          label="Snap to nearby shapes"
          checked={s.doc.settings.snap}
          onChange={v => s.mutate(d => void (d.settings.snap = v))}
        />
        <Checkbox
          label="Show manual position badges"
          checked={s.doc.settings.showManual}
          onChange={v => s.mutate(d => void (d.settings.showManual = v))}
        />
      </Section>
    </>
  );
}

const ALIGN_COMMANDS: CommandId[] = [
  'align-left',
  'align-center',
  'align-top',
  'align-middle',
  'distribute-x',
  'distribute-y',
];

function MultipleSelected(props: { count: number }) {
  const s = useDiagramSession();
  return (
    <>
      <Heading title={`${props.count} selected`} />
      <Section>
        <Show when={!s.doc.layout.sequence}>
          <div class="align-row" role="group" aria-label="Align and distribute">
            <For each={ALIGN_COMMANDS}>{command => <IconCommand command={command} />}</For>
          </div>
        </Show>
        <div class="fields-2">
          <CommandButton command="group">Wrap container</CommandButton>
          <CommandButton command="duplicate">Duplicate</CommandButton>
          <Show when={!s.doc.layout.sequence}>
            <CommandButton command="pin">Pin</CommandButton>
          </Show>
          <CommandButton command="layout">Tidy</CommandButton>
        </div>
      </Section>
      <Section title="Color">
        <Swatches
          selected={styleOf(s.doc, s.selectedIds()[0]).color}
          shade={styleOf(s.doc, s.selectedIds()[0]).shade}
        />
      </Section>
      <CommandButton command="delete" class="danger ghost full">
        Delete selection
      </CommandButton>
    </>
  );
}

const SIDE_OPTIONS = (['auto', 'left', 'right', 'top', 'bottom'] as PortSide[]).map(
  side => [side, capitalize(side)] as const,
);

const MARKER_OPTIONS = MARKERS.map(m => [m, capitalize(m.replace('-', ' '))] as const);

/** What a sequence message can be. An action is work one participant does, so it has one end. */
const KIND_OPTIONS = [
  ['', 'Not set'],
  ['interaction', 'Message'],
  ['call', 'Call: the sender waits'],
  ['send', 'Send: the sender does not wait'],
  ['reply', 'Reply'],
  ['outcome', 'Result shown'],
] as const;
const SELF_KIND_OPTIONS = [...KIND_OPTIONS, ['action', 'Local action']] as const;

function EdgeInspector(props: { id: string }) {
  const s = useDiagramSession();
  const edge = () => findEdge(s.doc, props.id)!;
  const cfg = () => s.doc.layout.edges[props.id] || {};
  const route = () => s.routesById().get(props.id);
  // A message just added is named next: the caret goes to its label, with the label selected.
  // The file draws again a moment later and sets the field once more, so select it then too.
  let label: HTMLInputElement | undefined;
  createEffect(
    on(
      labelFocus,
      () => {
        const select = () => {
          if (!label) return;
          const untouched = label.value === edge()?.label;
          label.focus();
          if (untouched) label.select();
        };
        setTimeout(select, 0);
        setTimeout(() => document.activeElement === label && select(), 400);
      },
      { defer: true },
    ),
  );
  return (
    <>
      <Heading title="Connection" />
      <Section>
        <TextField
          ref={el => (label = el)}
          // In a sequence, Enter hands the keys back to the canvas, so Tab adds the next message.
          onEnter={cfg().row !== undefined ? () => s.focusCanvas() : undefined}
          label="Label"
          value={edge().label}
          onCommit={v => s.transact('Edit label', d => edits.setEdgeLabel(d, props.id, v))}
        />
        <Show when={cfg().row !== undefined}>
          <SelectField
            label="Kind"
            value={edge().message ?? ''}
            options={edge().from === edge().to ? SELF_KIND_OPTIONS : KIND_OPTIONS}
            onChange={v =>
              s.transact('Edit kind', d => edits.setMessage(d, props.id, v || undefined))
            }
          />
          <Show when={edge().message === 'reply'}>
            <SelectField
              label="Reply to"
              value={edge().replyTo ?? ''}
              options={[
                ['', 'Not set'] as const,
                ...edits
                  .replyTargets(s.doc, props.id)
                  .map(e => [e.id, e.label ? `${e.id}: ${e.label}` : e.id] as const),
              ]}
              onChange={v =>
                s.transact('Edit reply', d => edits.setReplyTo(d, props.id, v || undefined))
              }
            />
          </Show>
        </Show>
        <Show when={!edge().message}>
          <Checkbox
            label="Directed"
            checked={edge().directed}
            onChange={v =>
              s.transact('Edit directed', d => edits.setEdge(d, props.id, { directed: v }))
            }
          />
          <Checkbox
            label="Dashed"
            checked={edge().dashed}
            onChange={v =>
              s.transact('Edit dashed', d => edits.setEdge(d, props.id, { dashed: v }))
            }
          />
        </Show>
        <Show when={!s.fileMode()}>
          <Checkbox
            label="Emphasis"
            checked={edge().emphasis}
            onChange={v =>
              s.transact('Edit emphasis', d => edits.setEdge(d, props.id, { emphasis: v }))
            }
          />
        </Show>
      </Section>
      <Show when={!edge().message}>
        <Section title="Ends">
          <div class="fields-2">
            <SelectField
              label="Tail"
              value={tailOf(edge())}
              options={MARKER_OPTIONS}
              disabled={!edge().directed}
              onChange={v => s.transact('Edit tail', d => edits.setEdge(d, props.id, { tail: v }))}
            />
            <SelectField
              label="Head"
              value={headOf(edge())}
              options={MARKER_OPTIONS}
              disabled={!edge().directed}
              onChange={v => s.transact('Edit head', d => edits.setEdge(d, props.id, { head: v }))}
            />
          </div>
        </Section>
      </Show>
      <Section title="Ports">
        <div class="fields-2">
          <SelectField
            label="From"
            value={cfg().fromSide || 'auto'}
            options={SIDE_OPTIONS}
            onChange={v =>
              s.transact('Edit fromSide', d => edits.setEdgeLayout(d, props.id, { fromSide: v }))
            }
          />
          <SelectField
            label="To"
            value={cfg().toSide || 'auto'}
            options={SIDE_OPTIONS}
            onChange={v =>
              s.transact('Edit toSide', d => edits.setEdgeLayout(d, props.id, { toSide: v }))
            }
          />
        </div>
        <p class="hint">
          Drawn {route()?.fromSide ?? '—'} → {route()?.toSide ?? '—'}
        </p>
        <div class="fields-2">
          <CommandButton command="reverse-edge">Reverse</CommandButton>
          <CommandButton command="auto-ports">Use auto ports</CommandButton>
          <Show
            when={cfg().row !== undefined}
            fallback={<CommandButton command="insert-step">Insert step · Tab</CommandButton>}
          >
            <CommandButton command="insert-event-before">Insert before</CommandButton>
            <CommandButton command="insert-event-after">Insert after</CommandButton>
            <CommandButton command="move-event-up">Move up</CommandButton>
            <CommandButton command="move-event-down">Move down</CommandButton>
          </Show>
          <Show when={!s.fileMode()}>
            <CommandButton command="reset-route">Reset bends</CommandButton>
          </Show>
        </div>
        <Show when={cfg().row !== undefined}>
          <p class="hint">Tab and Shift Tab insert a message. Alt with ↑ or ↓ moves this one.</p>
        </Show>
        <Show when={!s.fileMode()}>
          <p class="hint">
            Double-click a line to add a bend. Double-click a bend to remove it. Alt-drag a label to
            move it.
          </p>
        </Show>
      </Section>
      <CommandButton command="delete" class="danger ghost full">
        Delete connection
      </CommandButton>
    </>
  );
}

function ObjectInspector(props: { id: string }) {
  const s = useDiagramSession();
  const container = () => isGroup(s.doc, props.id);
  const object = () => findNode(s.doc, props.id) ?? findGroup(s.doc, props.id)!;
  const style = () => styleOf(s.doc, props.id);
  const shapes = () =>
    s.fileMode() ? SHAPES.filter(s => DSL_SHAPES.includes(s as never)) : SHAPES;
  // A sequence places everything in lanes, so only a participant's size is the file's to set.
  const lanes = () => !!s.doc.layout.sequence;
  return (
    <>
      <Heading title={container() ? 'Container' : 'Shape'} />
      <Section>
        <TextField
          label="Label"
          value={object().title}
          onCommit={v => s.transact('Edit title', d => edits.setTitle(d, props.id, v))}
        />
        <Show when={object().href}>
          {href => (
            <div class="field link-field">
              <span class="field-label">Link</span>
              <div class="link-row">
                <span class="link-target" {...tip(href(), undefined, describeLink(s, href()))}>
                  {href()}
                </span>
                <button type="button" class="button small" onClick={() => openLink(s, href())}>
                  Open
                </button>
              </div>
            </div>
          )}
        </Show>
        <Field label="Color">
          <Swatches selected={style().color} shade={style().shade} group={container()} />
        </Field>
        <Show when={!container()}>
          <SelectField<ShapeKind>
            label="Shape"
            value={style().shape}
            options={shapes().map(s => [s, SHAPE_LABELS[s]] as const)}
            onChange={shape =>
              s.transact('Edit shape', d => edits.setStyle(d, props.id, { shape }))
            }
          />
        </Show>
        <Show
          when={isCell(s.doc, props.id) && style().shape !== 'marker' && findNode(s.doc, props.id)}
        >
          {node => (
            <Show
              when={node().span !== 'var'}
              fallback={<p class="hint">Variable length: fills the rest of its row.</p>}
            >
              <NumberField
                label="Span"
                value={typeof node().span === 'number' ? (node().span as number) : 1}
                min={1}
                max={4096}
                onChange={v =>
                  s.transact('Edit span', d => {
                    const n = findNode(d, props.id)!;
                    if (Math.round(v) > 1) n.span = Math.round(v);
                    else delete n.span;
                  })
                }
              />
            </Show>
          )}
        </Show>
      </Section>
      <Show
        when={!lanes()}
        fallback={
          <Show when={!container()}>
            <Section title="Size">
              <div class="fields-2">
                <GeometryField id={props.id} label="Width" field="w" />
                <GeometryField id={props.id} label="Height" field="h" />
              </div>
            </Section>
          </Show>
        }
      >
        <Section title="Position">
          <div class="fields-2">
            <GeometryField id={props.id} label="X" field="x" />
            <GeometryField id={props.id} label="Y" field="y" />
            <GeometryField id={props.id} label="Width" field="w" />
            <GeometryField id={props.id} label="Height" field="h" />
          </div>
          <PinControl id={props.id} />
        </Section>
      </Show>
      <Show when={container()} fallback={<ShapeSections id={props.id} />}>
        <ContainerSections id={props.id} />
      </Show>
      <div class="fields-2">
        <CommandButton command="duplicate">Duplicate</CommandButton>
        <CommandButton command="delete" class="danger ghost">
          Delete
        </CommandButton>
      </div>
    </>
  );
}

function GeometryField(props: { id: string; label: string; field: 'x' | 'y' | 'w' | 'h' }) {
  const s = useDiagramSession();
  return (
    <NumberField
      label={props.label}
      value={Math.round(s.geometry(props.id)[props.field])}
      onChange={v =>
        s.transact('Edit ' + props.field, d => edits.setGeometry(d, props.id, props.field, v))
      }
    />
  );
}

function PinControl(props: { id: string }) {
  const s = useDiagramSession();
  const r = () => s.geometry(props.id);
  const inherited = () => ancestors(s.doc, props.id).find(a => s.geometry(a).pinned);
  const note = () => {
    const parent = inherited();
    if (parent) return `Held by pinned container “${findGroup(s.doc, parent)?.title}”.`;
    if (r().manual && !r().pinned)
      return s.doc.settings.respectManual ? 'Moved by hand and protected.' : 'Moved by hand.';
    return null;
  };
  return (
    <>
      <Checkbox
        label="Pin"
        checked={!!r().pinned}
        onChange={v => s.transact('Edit pinned', d => void (d.layout.nodes[props.id].pinned = v))}
      />
      <Show when={note()}>
        <p class="hint">{note()}</p>
      </Show>
    </>
  );
}

function ParentSelect(props: { id: string }) {
  const s = useDiagramSession();
  const options = () => {
    const excluded = new Set([
      props.id,
      ...(isGroup(s.doc, props.id) ? descendants(s.doc, props.id) : []),
    ]);
    return [
      ['', 'No container'] as const,
      ...s.doc.graph.groups.filter(g => !excluded.has(g.id)).map(g => [g.id, g.title] as const),
    ];
  };
  const object = () => findNode(s.doc, props.id) ?? findGroup(s.doc, props.id);
  return (
    <SelectField
      label="Container"
      value={object()?.parentId || ''}
      options={options()}
      onChange={v => s.transact('Edit parentId', d => edits.setParent(d, props.id, v || null))}
    />
  );
}

const LABEL_MODES: LabelMode[] = ['center', 'top', 'bottom', 'left', 'right', 'detached'];

function ShapeSections(props: { id: string }) {
  const s = useDiagramSession();
  const style = () => styleOf(s.doc, props.id);
  const labelMode = () =>
    nodeLabel(s.doc, props.id, findNode(s.doc, props.id)!.title, s.geometry(props.id)).mode;
  return (
    <>
      {/* A file cannot store these yet. */}
      <Show when={!s.fileMode()}>
        <Show when={!s.doc.layout.sequence}>
          <IntentSection id={props.id} />
        </Show>
        <details class="inspector-section">
          <summary>Label & icon</summary>
          <SelectField
            label="Label position"
            value={labelMode()}
            options={LABEL_MODES.map(mode => [mode, capitalize(mode)] as const)}
            onChange={mode => s.transact('Edit mode', d => edits.setLabelMode(d, props.id, mode))}
          />
          <SelectField
            label="Icon"
            value={style().icon || ''}
            options={[['', 'None'], ...NODE_ICONS.map(i => [i, capitalize(i)] as const)]}
            onChange={icon => s.transact('Edit icon', d => edits.setStyle(d, props.id, { icon }))}
          />
          <Show when={style().shape === 'image'}>
            <CommandButton command="replace-image" class="full">
              Replace image
            </CommandButton>
          </Show>
        </details>
      </Show>
      <Section>
        <ParentSelect id={props.id} />
        <CommandButton command="add-connected" class="full">
          Add connected box <kbd>⇧ Enter</kbd>
        </CommandButton>
      </Section>
    </>
  );
}

const openArrange = () => setRightTab('arrange');

function ContainerSections(props: { id: string }) {
  const s = useDiagramSession();
  const cfg = () => s.doc.layout.containers[props.id];
  return (
    <>
      <Section title="Contents">
        <Show
          when={s.fileMode()}
          fallback={
            <>
              <SelectField
                label="Arrange contents"
                value={cfg()?.direction || 'inherit'}
                options={[
                  ['inherit', 'Follow diagram'],
                  ['RIGHT', 'Left to right'],
                  ['DOWN', 'Top to bottom'],
                ]}
                onChange={direction =>
                  s.transact('Edit direction', d => edits.setContainer(d, props.id, { direction }))
                }
              />
              <NumberField
                label="Inner padding"
                value={cfg()?.padding || 24}
                min={12}
                max={80}
                onChange={padding =>
                  s.transact('Edit padding', d => edits.setContainer(d, props.id, { padding }))
                }
              />
              <div class="fields-2">
                <CommandButton command="layout">Tidy inside</CommandButton>
                <CommandButton command="fit-container">Fit contents</CommandButton>
              </div>
            </>
          }
        >
          <button type="button" class="button" onClick={() => openArrange()}>
            Arrange this group
          </button>
          <CommandButton command="reflow-group">Reflow group</CommandButton>
        </Show>
      </Section>
      <Section>
        <ParentSelect id={props.id} />
        <div class="fields-2">
          <CommandButton command="collapse-selected">
            {s.doc.collapsed.includes(props.id) ? 'Expand' : 'Collapse'}
          </CommandButton>
          <CommandButton command="ungroup">Ungroup</CommandButton>
        </div>
      </Section>
    </>
  );
}

const roleOf = (doc: Diagram, id: string): IntentRole | null =>
  doc.layout.intent.start?.id === id ? 'start' : doc.layout.intent.end?.id === id ? 'end' : null;

function IntentSection(props: { id: string }) {
  const s = useDiagramSession();
  return (
    <details class="inspector-section">
      <summary>Layout intent</summary>
      <Show
        when={roleOf(s.doc, props.id)}
        fallback={
          <div class="fields-2">
            <CommandButton command="mark-start">Start here</CommandButton>
            <CommandButton command="mark-end">End here</CommandButton>
          </div>
        }
      >
        {role => (
          <>
            <div class="row between">
              <span class="intent-role">{role() === 'start' ? 'Start' : 'End'}</span>
              <button
                type="button"
                class="button ghost small"
                onClick={() => s.setLayoutIntent(role(), null)}
              >
                Clear
              </button>
            </div>
            <SelectField
              label="Preferred area"
              value={s.doc.layout.intent[role()]!.placement}
              options={edits
                .intentPlacements(role())
                .map(p => [p, edits.INTENT_LABELS[p]] as const)}
              onChange={placement => s.setLayoutIntent(role(), props.id, placement)}
            />
          </>
        )}
      </Show>
    </details>
  );
}

/** Start and end preferences for the whole diagram. Also shown in the Arrange panel. */
export function IntentSummary() {
  const s = useDiagramSession();
  const entries = () =>
    (['start', 'end'] as const).flatMap(role =>
      s.doc.layout.intent[role] ? [[role, s.doc.layout.intent[role]!] as const] : [],
    );
  return (
    <Section title="Drawing intent">
      <For
        each={entries()}
        fallback={
          <p class="hint">
            Select a shape to mark a start or end and choose its preferred area. This helps resolve
            feedback loops without pinning coordinates.
          </p>
        }
      >
        {([role, hint]) => (
          <div class="intent-entry">
            <div class="row">
              <span class="intent-role">{role}</span>
              <button
                type="button"
                class="button ghost grow truncate"
                onClick={() => s.selectItems([hint.id])}
              >
                {findNode(s.doc, hint.id)?.title || hint.id}
              </button>
              <IconButton
                icon="close"
                label={`Clear ${role}`}
                onClick={() => s.setLayoutIntent(role, null)}
              />
            </div>
            <p class="hint">{edits.INTENT_LABELS[hint.placement]}</p>
          </div>
        )}
      </For>
    </Section>
  );
}
