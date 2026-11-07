import { For } from 'solid-js';
import type { StaticScene as Scene } from '../../model/static-scene';
import { CrossingView, EdgeView } from './EdgeView';
import { GroupView } from './GroupView';
import { NodeView } from './NodeView';
import { Lifelines, SequenceBackdrop } from './Lifelines';
import { PositionMarks } from './PositionMarks';

/** A read-only drawing, used for comparison candidates. */
export function StaticScene(props: {
  scene: Scene;
  idPrefix: string;
  focusId?: string;
  focusable?: boolean;
}) {
  return (
    <>
      <SequenceBackdrop doc={props.scene.doc} part="panel" />
      <For each={props.scene.vg.groups}>
        {g => (
          <GroupView
            doc={props.scene.doc}
            id={g.id}
            rect={props.scene.rects.get(g.id)!}
            focused={g.id === props.focusId}
          />
        )}
      </For>
      <SequenceBackdrop doc={props.scene.doc} part="phases" />
      <Lifelines
        doc={props.scene.doc}
        ids={props.scene.vg.nodes.map(n => n.id)}
        rect={id => props.scene.rects.get(id)}
      />
      <For each={props.scene.routes}>
        {route => <EdgeView doc={props.scene.doc} route={route} idPrefix={props.idPrefix} />}
      </For>
      <For each={props.scene.vg.nodes}>
        {n => (
          <NodeView
            doc={props.scene.doc}
            id={n.id}
            rect={props.scene.rects.get(n.id)!}
            focused={n.id === props.focusId}
            idPrefix={props.idPrefix}
            focusable={props.focusable}
          />
        )}
      </For>
      <PositionMarks doc={props.scene.doc} rects={props.scene.rects} bounds={props.scene.bounds} />
      <For each={props.scene.routes.filter(r => r.cross)}>
        {route => <CrossingView doc={props.scene.doc} route={route} />}
      </For>
    </>
  );
}
