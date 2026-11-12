/** `<DraftDiagram>` for Solid: the `<draft-diagram>` element with Solid props, a ref and event props. */
import '@draftably/runtime/element';
import type { DraftDiagramElement } from '@draftably/runtime/element';
import type { UpdateResult, ViewerOptions } from '@draftably/runtime/viewer';
import { Show, splitProps, type JSX } from 'solid-js';
import {
  elementAttributes,
  EVENT_PROPS,
  listenHostEvents,
  type ElementAttributes,
  type HostEventProps,
} from './events.js';

export { renderSvg } from '@draftably/runtime';
export { HOST_EVENTS } from '@draftably/runtime/host';
export type {
  ElementAttributes,
  HostEventDetail,
  HostEventName,
  HostEventProps,
  HostEvents,
} from './events.js';
export type { DraftDiagramElement, UpdateResult, ViewerOptions };

declare module 'solid-js' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'draft-diagram': JSX.HTMLAttributes<DraftDiagramElement> & {
        source?: string;
        state?: string;
        label?: string;
        outline?: 'visible' | 'hidden';
        'prop:options'?: ViewerOptions;
      };
    }
  }
}

/** The element's props, its event props, and any other attribute, such as `data-theme`. */
export interface DraftDiagramProps extends HostEventProps, ElementAttributes {
  /** `.draft` source. A change redraws the diagram and keeps the camera. */
  source: string;
  /** A declared emphasis state to show. */
  state?: string | null;
  /** The accessible name. */
  label?: string;
  /** `'visible'` shows the item list under the drawing; `'hidden'` (default) shows it on focus. */
  outline?: 'visible' | 'hidden';
  /**
   * Static SVG from `renderSvg(source, { target: 'inline', idPrefix })`, shown until the viewer
   * draws. Server rendering and readers without JavaScript see it.
   */
  svg?: string;
  /** Every `mountViewer` option. A new object with the same values does nothing. */
  options?: ViewerOptions;
  ref?: (element: DraftDiagramElement) => void;
  class?: string;
  style?: JSX.CSSProperties | string;
  /** Slot content: children marked `data-draft-slot="body:<id>"` or `"overlay:<id>"`. */
  children?: JSX.Element;
}

const OWN = [
  'source',
  'state',
  'label',
  'outline',
  'svg',
  'options',
  'ref',
  'class',
  'style',
  'children',
] as const;

export function DraftDiagram(props: DraftDiagramProps) {
  const [, , rest] = splitProps(props, OWN, EVENT_PROPS);
  return (
    <draft-diagram
      ref={(node: DraftDiagramElement) => {
        listenHostEvents(node, props);
        props.ref?.(node);
      }}
      source={props.source}
      state={props.state ?? undefined}
      label={props.label}
      outline={props.outline}
      class={props.class}
      // Only when set: Solid's server HTML writes `style=""` for undefined, which a strict CSP blocks.
      {...(props.style === undefined ? {} : { style: props.style })}
      // Only when set, so options a host set through the ref survive.
      {...(props.options === undefined ? {} : { 'prop:options': props.options })}
      {...elementAttributes(rest)}
    >
      <Show when={props.svg}>{svg => <div innerHTML={svg()} />}</Show>
      {props.children}
    </draft-diagram>
  );
}
