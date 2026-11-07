import { For, Show } from 'solid-js';
import { sequenceBackdrop } from '../../runtime/svg-renderer';
import { resolveAppearance } from '../../model/appearance';
import type { Diagram, NodeLayout } from '../../model/types';
import { LIFELINE } from '../../dsl/frame';

/** Sequence participants' dashed lifelines, drawn under the message lines. */
export function Lifelines(props: {
  doc: Diagram;
  ids: string[];
  rect: (id: string) => NodeLayout | undefined;
}) {
  const look = () => resolveAppearance(props.doc.appearance);
  const length = (id: string) => props.doc.graph.nodes.find(n => n.id === id)?.lifeline;
  return (
    <g class="lifelines" pointer-events="none">
      <For each={props.ids}>
        {id => (
          <Show when={length(id) ? props.rect(id) : undefined}>
            {r => (
              <line
                x1={r().x + r().w / 2}
                x2={r().x + r().w / 2}
                y1={r().y + r().h}
                y2={r().y + r().h + length(id)!}
                stroke={look().muted}
                stroke-width={LIFELINE.width}
                stroke-dasharray={LIFELINE.dash}
              />
            )}
          </Show>
        )}
      </For>
    </g>
  );
}

/**
 * A sequence diagram's panel (`part="panel"`, under the groups) or its phase bands
 * (`part="phases"`, over the groups' column bands), as the SVG export draws them.
 */
export function SequenceBackdrop(props: { doc: Diagram; part: 'panel' | 'phases' }) {
  const markup = () =>
    props.doc.layout.sequence
      ? sequenceBackdrop(props.doc, resolveAppearance(props.doc.appearance))[props.part].join('')
      : '';
  return (
    <Show when={markup()}>
      {/* Drawn from the file by the same code as the SVG export, which escapes every label. */}
      {/* eslint-disable-next-line solid/no-innerhtml */}
      <g class="sequence-backdrop" pointer-events="none" innerHTML={markup()} />
    </Show>
  );
}
