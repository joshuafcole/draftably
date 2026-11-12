import type { Component, Snippet } from 'svelte';
import type { DraftDiagramElement } from '@draftably/runtime/element';
import type { UpdateResult, ViewerOptions } from '@draftably/runtime/viewer';
import type { ElementAttributes, HostEventProps } from './events';

export { renderSvg } from '@draftably/runtime';
export { HOST_EVENTS } from '@draftably/runtime/host';
export type {
  ElementAttributes,
  HostEventDetail,
  HostEventName,
  HostEventProps,
  HostEvents,
} from './events';
export type { DraftDiagramElement, UpdateResult, ViewerOptions };

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
  /** Static SVG from `renderSvg(source, { target: 'inline', idPrefix })`, shown until the viewer draws. */
  svg?: string;
  /** Every `mountViewer` option. A new object with the same values does nothing. */
  options?: ViewerOptions;
  /** `bind:element` gives the `<draft-diagram>` element. */
  element?: DraftDiagramElement;
  class?: string;
  style?: string;
  /** Slot content: children marked `data-draft-slot="body:<id>"` or `"overlay:<id>"`. */
  children?: Snippet;
}

export const DraftDiagram: Component<DraftDiagramProps, Record<string, never>, 'element'>;
