import viewerCss from './viewer.css?inline';
import {
  createSlotting,
  mountFailure,
  redispatch,
  relay,
  sameValue,
  sharedSheet,
  takeEarly,
  warnOtherCopy,
} from './element-base';
import type { DraftStatus } from './host';
import { runtimeVersion } from './version';
import { mountViewer } from './viewer';
import type { DraftSlot, UpdateResult, ViewerEvents, ViewerHandle, ViewerOptions } from './viewer';

export type { DraftEventMap, DraftStatus, HostEventName, HostEvents } from './host';
export { HOST_EVENTS } from './host';

export interface DraftDiagramElement extends HTMLElement {
  source: string;
  /** Reflects the `outline` attribute. */
  outline: 'visible' | 'hidden' | undefined;
  /**
   * Every `mountViewer` option. `label`, `outline`, `toolbar` and `render` (except `fonts`) apply
   * live; `execution` and `render.fonts` mount a new viewer. A new object with the same values
   * does nothing.
   */
  options: ViewerOptions;
  readonly viewer?: ViewerHandle;
  readonly updateComplete: Promise<UpdateResult | undefined>;
}

declare global {
  interface HTMLElementTagNameMap {
    'draft-diagram': DraftDiagramElement;
  }
}

const tag = 'draft-diagram';
const ELEMENT_CSS = `${viewerCss}\n:host{display:block;height:26rem;min-height:16rem;box-sizing:border-box}.draft-diagram__viewer{height:100%;min-height:0}.draft-diagram__viewer[hidden]{display:none}.draft-diagram__fallback{display:block}.draft-diagram__fallback[hidden]{display:none}.draft-diagram__status{margin:.35rem 0;color:var(--draft-warning-ink,#9a3412);font:14px/1.45 system-ui,sans-serif}.draft-diagram__status:empty{display:none}`;
const VIEWER_EVENTS = [
  'anchors',
  'render',
  'diagnostics',
  'camera',
  'itemactivate',
  'link',
  'contextmenu',
] as const;

if (
  typeof globalThis.document !== 'undefined' &&
  typeof globalThis.customElements !== 'undefined'
) {
  if (customElements.get(tag)) warnOtherCopy(tag);
  else {
    class DraftDiagram extends HTMLElement implements DraftDiagramElement {
      static runtimeVersion = runtimeVersion;
      static get observedAttributes() {
        return ['source', 'state', 'label', 'outline'];
      }

      private _options: ViewerOptions = {};
      /** The options object the viewer reads; changed in place for live fields. */
      private _live: ViewerOptions = {};
      private _viewer?: ViewerHandle;
      private _updateComplete: Promise<UpdateResult | undefined> = Promise.resolve(undefined);
      private _host!: HTMLDivElement;
      private _fallback!: HTMLSlotElement;
      private _status!: HTMLParagraphElement;
      /** Only where the browser cannot adopt a shared sheet. */
      private _style?: HTMLStyleElement;
      private _generation = 0;
      private _revision = 0;
      private _scheduled = false;
      private _hasCommitted = false;
      private _slotting!: ReturnType<typeof createSlotting>;

      constructor() {
        super();
        const source = takeEarly<string>(this, 'source');
        const options = takeEarly<ViewerOptions>(this, 'options');
        const outline = takeEarly<'visible' | 'hidden'>(this, 'outline');
        // Manual assignment: the element puts marked children in slot targets, and never writes
        // to the host's DOM.
        this.attachShadow({ mode: 'open', slotAssignment: 'manual' });
        this._host = this.ownerDocument.createElement('div');
        this._host.className = 'draft-diagram__viewer';
        this._host.hidden = true;
        this._fallback = this.ownerDocument.createElement('slot');
        this._fallback.className = 'draft-diagram__fallback';
        this._status = this.ownerDocument.createElement('p');
        this._status.className = 'draft-diagram__status';
        this._status.setAttribute('role', 'status');
        this._status.setAttribute('aria-live', 'polite');
        const sheet = sharedSheet(this.ownerDocument, tag, ELEMENT_CSS);
        if (sheet) this.shadowRoot!.adoptedStyleSheets = [sheet];
        else {
          this._style = this.ownerDocument.createElement('style');
          this._style.textContent = ELEMENT_CSS;
          this.shadowRoot!.append(this._style);
        }
        this.shadowRoot!.append(this._host, this._fallback, this._status);
        this._slotting = createSlotting(this, this._fallback, names =>
          this._viewer?.anchor(names as DraftSlot[]),
        );
        if (options) this._options = options;
        if (outline) this.outline = outline;
        if (source !== undefined) this.source = source;
      }

      get source() {
        return this.getAttribute('source') ?? '';
      }

      set source(value: string) {
        const source = String(value ?? '');
        if (this.getAttribute('source') !== source) this.setAttribute('source', source);
      }

      get outline() {
        const value = this.getAttribute('outline');
        return value === null ? undefined : value === 'visible' ? 'visible' : 'hidden';
      }

      set outline(value: 'visible' | 'hidden' | undefined) {
        if (value == null) this.removeAttribute('outline');
        else if (this.getAttribute('outline') !== value) this.setAttribute('outline', value);
      }

      get options() {
        return this._options;
      }

      set options(value: ViewerOptions) {
        const prev = this._options,
          next = value ?? {};
        this._options = next;
        if (!this._viewer) return;
        if (
          !sameValue(prev.execution, next.execution) ||
          (prev.render?.fonts ?? 'embed') !== (next.render?.fonts ?? 'embed')
        ) {
          this._reset();
          this._schedule();
          return;
        }
        const rerender = !sameValue(prev.render, next.render);
        this._applyLive();
        if (rerender) this._update();
      }

      get viewer() {
        return this._viewer;
      }

      get updateComplete() {
        return this._updateComplete;
      }

      connectedCallback() {
        this._slotting.start();
        this._schedule();
      }

      disconnectedCallback() {
        this._slotting.stop();
        this._reset();
        this.removeAttribute('status');
      }

      attributeChangedCallback(name: string) {
        if (!this.isConnected) return;
        if (name === 'source') {
          if (this._viewer && this.source.trim()) this._update();
          else {
            this._reset();
            this._schedule();
          }
        } else if (name === 'state') this._update();
        else this._applyLive();
      }

      /** Mount once, in a microtask, so every property a framework sets in this tick lands first. */
      private _schedule() {
        if (this._scheduled) return;
        this._scheduled = true;
        // `updateComplete` follows the mount that is still queued.
        const scheduled: Promise<UpdateResult | undefined> = new Promise(resolve =>
          queueMicrotask(() => {
            this._scheduled = false;
            this._mount();
            // A mount that did not start (removed in the same tick) settles with no result.
            resolve(this._updateComplete === scheduled ? undefined : this._updateComplete);
          }),
        );
        this._updateComplete = scheduled;
      }

      private _setStatus(status: DraftStatus | null) {
        if (status) this.setAttribute('status', status);
        else this.removeAttribute('status');
      }

      private _reset() {
        this._generation++;
        this._viewer?.destroy();
        this._viewer = undefined;
        this._host.replaceChildren();
        this._host.hidden = true;
        this._fallback.hidden = false;
        this._status.textContent = '';
        this._hasCommitted = false;
      }

      /** The options with the element's own attributes on top. */
      private _merged(): ViewerOptions {
        return {
          ...this._options,
          ...(this.hasAttribute('label') ? { label: this.getAttribute('label')! } : {}),
          ...(this.outline ? { outline: this.outline } : {}),
        };
      }

      /** Apply label, outline, toolbar and render settings without a new viewer. */
      private _applyLive() {
        if (!this._viewer) return;
        const merged = this._merged();
        for (const key of Object.keys(this._live) as (keyof ViewerOptions)[])
          delete this._live[key];
        Object.assign(this._live, merged);
        const root = this._host.querySelector<HTMLElement>('.draft-viewer');
        if (!root) return;
        root.setAttribute('aria-label', merged.label ?? 'Diagram viewer');
        root
          .querySelector('.draft-viewer__viewport')
          ?.setAttribute('aria-label', merged.label ?? 'Diagram');
        root.classList.toggle('draft-viewer--outline-hidden', merged.outline !== 'visible');
        const toolbar = root.querySelector<HTMLElement>('.draft-viewer__toolbar');
        if (toolbar) toolbar.hidden = merged.toolbar === false;
        this._setNonce();
      }

      private _setNonce() {
        const nonce = this._options.render?.styleNonce;
        if (nonce) this._style?.setAttribute('nonce', nonce);
        else this._style?.removeAttribute('nonce');
      }

      private _mount() {
        if (!this.isConnected || this._viewer) return;
        this._setNonce();
        if (!this.source.trim()) {
          this._setStatus(null);
          this._updateComplete = Promise.resolve(undefined);
          return;
        }
        this._setStatus('loading');
        this._live = this._merged();
        try {
          this._viewer = mountViewer(this._host, this._live);
        } catch (error) {
          this._mountFailure(error);
          return;
        }
        const viewer = this._viewer;
        for (const type of VIEWER_EVENTS)
          viewer.on(type, (event: ViewerEvents[typeof type]) => {
            if (viewer === this._viewer) relay(this, type, event);
          });
        viewer.on('anchors', ({ anchors }) => this._slotting.setAnchors(anchors));
        viewer.anchor(this._slotting.names() as DraftSlot[]);
        this._update();
      }

      private _mountFailure(error: unknown) {
        const result = mountFailure(++this._revision, error, 'Diagram viewer could not start.');
        this._status.textContent = result.error.diagnostics[0].message;
        this._setStatus('error');
        this._updateComplete = Promise.resolve(result);
        redispatch(this, 'update', result);
      }

      private _update() {
        const viewer = this._viewer;
        if (!viewer || !this.isConnected) return;
        const generation = ++this._generation;
        this._revision++;
        const complete = viewer.update(this.source, { state: this.getAttribute('state') });
        this._updateComplete = complete.then(result => {
          if (generation !== this._generation || !this.isConnected || viewer !== this._viewer)
            return result;
          if (result?.status === 'committed') {
            this._hasCommitted = true;
            this._host.hidden = false;
            this._fallback.hidden = true;
            this._status.textContent = '';
            this._setStatus('ready');
          } else if (result?.status === 'error') {
            this._status.textContent = this._hasCommitted
              ? ''
              : result.error.diagnostics.map(diagnostic => diagnostic.message).join(' ');
            if (!this._hasCommitted) this._setStatus('error');
          } else {
            return result;
          }
          redispatch(this, 'update', result);
          return result;
        });
      }
    }

    customElements.define(tag, DraftDiagram);
  }
}
