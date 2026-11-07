/**
 * `<draft-editor>`: the editor as a custom element, for any framework or plain HTML. Its `source`
 * attribute or property sets the text; every kept edit fires `draft-change` with the new text, and
 * every camera move fires `draft-camera` with `{ camera, reason }`.
 * It mounts when added to the page and stops its session when removed.
 */
import { mountEditor, type MountedEditor } from './mount';

export interface DraftEditorElement extends HTMLElement {
  source: string;
  readonly editor?: MountedEditor;
}

declare global {
  interface HTMLElementTagNameMap {
    'draft-editor': DraftEditorElement;
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('draft-editor')) {
  customElements.define(
    'draft-editor',
    class extends HTMLElement implements DraftEditorElement {
      static observedAttributes = ['source'];
      editor?: MountedEditor;
      /** The text last sent to or received from the editor, so an echo is not redrawn. */
      private last = '';

      get source() {
        return this.editor?.source() ?? this.getAttribute('source') ?? '';
      }

      set source(value: string) {
        this.setAttribute('source', String(value ?? ''));
      }

      constructor() {
        super();
        // A framework may set `source` before this class is defined. That own property hides
        // the setter, so take its value and remove it.
        if (Object.hasOwn(this, 'source')) {
          const early = (this as { source?: string }).source;
          delete (this as Partial<DraftEditorElement>).source;
          if (early !== undefined) this.setAttribute('source', String(early));
        }
      }

      connectedCallback() {
        this.last = this.getAttribute('source') ?? '';
        this.editor = mountEditor(this, {
          source: this.last,
          onChange: source => {
            this.last = source;
            this.dispatchEvent(new CustomEvent('draft-change', { detail: source, bubbles: true }));
          },
          onCamera: detail => this.dispatchEvent(new CustomEvent('draft-camera', { detail })),
        });
      }

      attributeChangedCallback(_name: string, _old: string | null, value: string | null) {
        if (!this.editor || value === null || value === this.last) return;
        this.last = value;
        void this.editor.update(value);
      }

      disconnectedCallback() {
        this.editor?.destroy();
        this.editor = undefined;
      }
    },
  );
}
