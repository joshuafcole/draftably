/**
 * `<draft-editor>`: the editor as a custom element, for any framework or plain HTML. Its `source`
 * attribute or property sets the text; every kept edit fires `draft-change` with `{ source }`.
 * It mounts in a microtask after it is added to the page, and stops its session when removed.
 */
import {
  createSlotting,
  mountFailure,
  redispatch,
  relay,
  sameValue,
  takeEarly,
  warnOtherCopy,
} from '../runtime/element-base';
import type { DraftStatus } from '../runtime/host';
import { runtimeVersion } from '../runtime/version';
import { mountEditor, type DraftSlot, type EditorOptions, type MountedEditor } from './mount';

export type { DraftEventMap, HostEventName, HostEvents } from '../runtime/host';
export type { EditorOptions };

export interface DraftEditorElement extends HTMLElement {
  source: string;
  /**
   * Every `mountEditor` option except `source` and `onChange`. Callbacks apply live; a new
   * `storageKey` mounts a new editor. A new object with the same values does nothing.
   */
  options: EditorOptions;
  readonly editor?: MountedEditor;
}

declare global {
  interface HTMLElementTagNameMap {
    'draft-editor': DraftEditorElement;
  }
}

const tag = 'draft-editor';

if (typeof customElements !== 'undefined') {
  if (customElements.get(tag)) warnOtherCopy(tag);
  else
    customElements.define(
      tag,
      class extends HTMLElement implements DraftEditorElement {
        static runtimeVersion = runtimeVersion;
        static observedAttributes = ['source'];
        editor?: MountedEditor;
        private _options: EditorOptions = {};
        private _scheduled = false;
        /** The text last sent to or received from the editor, so an echo is not redrawn. */
        private last = '';

        get source() {
          return this.editor?.source() ?? this.getAttribute('source') ?? '';
        }

        set source(value: string) {
          this.setAttribute('source', String(value ?? ''));
        }

        get options() {
          return this._options;
        }

        set options(value: EditorOptions) {
          const prev = this._options;
          this._options = value ?? {};
          if (this.editor && !sameValue(prev.storageKey, this._options.storageKey)) {
            this._destroy();
            this._schedule();
          }
        }

        constructor() {
          super();
          // A framework may set properties before this class is defined. Such an own property
          // hides the setter, so take its value and remove it.
          const source = takeEarly<string>(this, 'source');
          const options = takeEarly<EditorOptions>(this, 'options');
          if (options) this._options = options;
          if (source !== undefined) this.setAttribute('source', String(source));
          // The editor renders in a shadow root with its own styles; marked children go into slot
          // targets by manual assignment, and the element never writes to the host's DOM.
          const shadow = this.attachShadow({ mode: 'open', slotAssignment: 'manual' });
          this._root = this.ownerDocument.createElement('div');
          this._root.style.cssText = 'display:flex;flex-direction:column;height:100%;min-height:0';
          shadow.append(this._root);
          this._slotting = createSlotting(this, null, names =>
            this.editor?.anchor(names as DraftSlot[]),
          );
        }

        private _root: HTMLDivElement;
        private _slotting: ReturnType<typeof createSlotting>;

        connectedCallback() {
          this._slotting.start();
          this._schedule();
        }

        /** Mount once, in a microtask, so every property a framework sets in this tick lands first. */
        private _schedule() {
          if (this._scheduled) return;
          this._scheduled = true;
          queueMicrotask(() => {
            this._scheduled = false;
            if (this.isConnected && !this.editor) this._mount();
          });
        }

        private _setStatus(status: DraftStatus) {
          this.setAttribute('status', status);
        }

        private _mount() {
          this.last = this.getAttribute('source') ?? '';
          this._setStatus('loading');
          // Getters read the latest options, so a new callback applies without a new editor.
          const opts = () => this._options;
          let editor: MountedEditor;
          try {
            editor = mountEditor(this._root, {
              source: this.last,
              onChange: source => {
                this.last = source;
                redispatch(this, 'change', { source });
              },
              get storageKey() {
                return opts().storageKey;
              },
              get openLink() {
                return opts().openLink;
              },
              get confirm() {
                return opts().confirm;
              },
              get onInteract() {
                return opts().onInteract;
              },
              get detail() {
                return opts().detail;
              },
            });
          } catch (error) {
            // Fail as <draft-diagram> does: status, a visible message, and an update event.
            const result = mountFailure(1, error, 'The diagram editor could not start.');
            const message = result.error.diagnostics[0].message;
            this._setStatus('error');
            this.setAttribute('data-error', message);
            redispatch(this, 'update', result);
            return;
          }
          this.editor = editor;
          // Every event the editor has. It sends no `render` (it draws no standalone SVG) and no
          // `itemactivate` (a press selects: listen for `select`).
          for (const type of [
            'update',
            'anchors',
            'diagnostics',
            'camera',
            'select',
            'link',
            'contextmenu',
          ] as const)
            editor.on(type, event => relay(this, type, event));
          editor.on('anchors', ({ anchors }) => this._slotting.setAnchors(anchors));
          editor.anchor(this._slotting.names() as DraftSlot[]);
          editor.ready.then(
            r =>
              this.editor === editor && this._setStatus(r.status === 'error' ? 'error' : 'ready'),
            () => this.editor === editor && this._setStatus('error'),
          );
        }

        attributeChangedCallback(_name: string, _old: string | null, value: string | null) {
          if (!this.editor || value === null || value === this.last) return;
          this.last = value;
          void this.editor.update(value);
        }

        private _destroy() {
          this.editor?.destroy();
          this.editor = undefined;
        }

        disconnectedCallback() {
          this._slotting.stop();
          this._destroy();
          this.removeAttribute('status');
          this.removeAttribute('data-error');
        }
      },
    );
}
