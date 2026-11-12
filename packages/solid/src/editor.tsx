/** `<DraftEditor>` for Solid: drag boxes and lines, and get the `.draft` source back. */
import type { DraftEditorElement, EditorOptions } from '@draftably/editor/element';
import { onMount, splitProps, type JSX } from 'solid-js';
import {
  elementAttributes,
  EVENT_PROPS,
  listenHostEvents,
  type ElementAttributes,
  type HostEventProps,
} from './events.js';

export type { DraftEditorElement, EditorOptions };

declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'draft-editor': JSX.HTMLAttributes<DraftEditorElement> & {
        source?: string;
        'prop:options'?: EditorOptions;
      };
    }
  }
}

/** The element's props, its event props, and any other attribute, such as `data-theme`. */
export interface DraftEditorProps extends HostEventProps, ElementAttributes {
  /** `.draft` source. Passing back the source from `onChange` does not redraw. */
  source: string;
  /** Every `mountEditor` option but `source` and `onChange`. Callbacks apply live. */
  options?: EditorOptions;
  ref?: (element: DraftEditorElement) => void;
  class?: string;
  style?: JSX.CSSProperties | string;
  /** Slot content: children marked `data-draft-slot="body:<id>"` or `"overlay:<id>"`. */
  children?: JSX.Element;
}

const OWN = ['source', 'options', 'ref', 'class', 'style', 'children'] as const;

export function DraftEditor(props: DraftEditorProps) {
  const [, , rest] = splitProps(props, OWN, EVENT_PROPS);
  let el: DraftEditorElement | undefined;
  // The editor loads in the browser only, so server rendering and viewer-only pages skip it.
  onMount(() =>
    import('@draftably/editor/element').catch((error: unknown) => {
      el?.setAttribute('status', 'error');
      el?.setAttribute('data-error', String(error));
    }),
  );
  return (
    <draft-editor
      ref={(node: DraftEditorElement) => {
        el = node;
        listenHostEvents(node, props);
        props.ref?.(node);
      }}
      source={props.source}
      class={props.class}
      // Only when set: Solid's server HTML writes `style=""` for undefined, which a strict CSP blocks.
      {...(props.style === undefined ? {} : { style: props.style })}
      // Only when set, so options a host set through the ref survive.
      {...(props.options === undefined ? {} : { 'prop:options': props.options })}
      {...elementAttributes(rest)}
    >
      {props.children}
    </draft-editor>
  );
}
