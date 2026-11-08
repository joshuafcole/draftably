import { createContext, untrack, useContext, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { NodeLayout } from '../../model/types';

export interface NodeContentProps {
  id: string;
  width: number;
  height: number;
  selected: boolean;
}

/** Host-drawn node bodies, in place of titles. Layout never reads them; see `size … min-height=`. */
export interface NodeContent {
  draws: (id: string) => boolean;
  Body: Component<NodeContentProps>;
}

const NodeContentContext = createContext<NodeContent>();

export function NodeContentProvider(props: { content: NodeContent; children: JSX.Element }) {
  const content = untrack(() => props.content);
  return (
    <NodeContentContext.Provider value={content}>{props.children}</NodeContentContext.Provider>
  );
}

export const useNodeContent = () => useContext(NodeContentContext);

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
