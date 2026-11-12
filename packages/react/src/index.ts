'use client';
/** `<DraftDiagram>` for React 19: the `<draft-diagram>` element with React props, a ref and event props. */
import '@draftably/runtime/element';
import type { DraftDiagramElement } from '@draftably/runtime/element';
import type { UpdateResult, ViewerOptions } from '@draftably/runtime/viewer';
import { createElement, forwardRef, useImperativeHandle, useRef, type ReactNode } from 'react';
import {
  elementProps,
  useBeforeMount,
  useHostEvents,
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
  /** Slot content: children marked `data-draft-slot="body:<id>"` or `"overlay:<id>"`. */
  children?: ReactNode;
}

export const DraftDiagram = forwardRef<DraftDiagramElement | null, DraftDiagramProps>(
  function DraftDiagram(props, ref) {
    const { state, svg, options, children } = props;
    const el = useRef<DraftDiagramElement>(null);
    useImperativeHandle(ref, () => el.current!, []);
    useBeforeMount(() => {
      // Skip an unset prop, so options a host set through the ref survive.
      if (el.current && options !== undefined) el.current.options = options;
    }, [options]);
    useHostEvents(el, props);
    return createElement(
      'draft-diagram',
      {
        ...elementProps(props, ['state', 'svg', 'options', 'children']),
        ref: el,
        state: state ?? undefined,
      },
      svg ? createElement('div', { dangerouslySetInnerHTML: { __html: svg } }) : null,
      children,
    );
  },
);
