import type { Component, Snippet } from 'svelte';
import type { DraftEditorElement, EditorOptions } from '@draftably/editor/element';
import type { ElementAttributes, HostEventProps } from './events';

export type { DraftEditorElement, EditorOptions };

/** The element's props, its event props, and any other attribute, such as `data-theme`. */
export interface DraftEditorProps extends HostEventProps, ElementAttributes {
  /** `.draft` source. Passing back the source from `onchange` does not redraw. */
  source: string;
  /** Every `mountEditor` option but `source` and `onChange`. Callbacks apply live. */
  options?: EditorOptions;
  /** `bind:element` gives the `<draft-editor>` element. */
  element?: DraftEditorElement;
  class?: string;
  style?: string;
  /** Slot content: children marked `data-draft-slot="body:<id>"` or `"overlay:<id>"`. */
  children?: Snippet;
}

export const DraftEditor: Component<DraftEditorProps, Record<string, never>, 'element'>;
