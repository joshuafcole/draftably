import { createContext, untrack, useContext, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { NodeLayout } from '../../model/types';

/** What a host's node body is drawn with: the node, its laid-out size and whether it is selected. */
export interface NodeContentProps {
  id: string;
  /** The node's laid-out width and height. Its body is drawn from 0,0 in the node's own frame. */
  width: number;
  height: number;
  selected: boolean;
}

/**
 * A host's own drawing of node bodies. Where `draws(id)` is true, the node's title is not drawn;
 * `Body` is drawn instead, inside a `foreignObject` the size of the node, over its shape and under
 * its badges, ports and handles. The shape, the selection ring and the ports stay the scene's.
 *
 * Layout never reads the body. A host that draws more than the title declares the room it needs
 * in the source (`size id width= height=auto min-height=`), so a compile without the host, the
 * CLI and exports lay the node out the same, and draw the title in its place.
 *
 * The body takes no pointer events: a click, hover or drag on it is the node's, as on the title.
 */
export interface NodeContent {
  draws: (id: string) => boolean;
  Body: Component<NodeContentProps>;
}

const NodeContentContext = createContext<NodeContent>();

/** Draw node bodies with `content` in every scene inside. `content` is read once. */
export function NodeContentProvider(props: { content: NodeContent; children: JSX.Element }) {
  const content = untrack(() => props.content);
  return (
    <NodeContentContext.Provider value={content}>{props.children}</NodeContentContext.Provider>
  );
}

/** The host's node bodies, when a scene is drawn inside a `NodeContentProvider`. */
export const useNodeContent = () => useContext(NodeContentContext);

/** The body for one node, or nothing when no host draws it. */
export function NodeBody(props: {
  content: NodeContent;
  id: string;
  rect: NodeLayout;
  selected?: boolean;
}) {
  return (
    <foreignObject
      class="node-content"
      x={0}
      y={0}
      width={props.rect.w}
      height={props.rect.h}
      pointer-events="none"
    >
      <Dynamic
        component={props.content.Body}
        id={props.id}
        width={props.rect.w}
        height={props.rect.h}
        selected={!!props.selected}
      />
    </foreignObject>
  );
}
