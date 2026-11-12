// Event props from the runtime's one list of events: a new event adds no lines here.
import { HOST_EVENTS, hostDetail } from '@draftably/runtime/host';

/**
 * Listen for every host event on `node`; each call reads the latest `oncamera`, `onselect`, …
 * prop from `props`.
 * @param {HTMLElement} node
 * @param {Record<string, unknown>} props
 */
export function listenHostEvents(node, props) {
  const off = HOST_EVENTS.map(name => {
    /** @param {Event} event */
    const listen = event => {
      const handler = props[`on${name}`];
      if (typeof handler === 'function') handler(hostDetail(event));
    };
    node.addEventListener(`draft-${name}`, listen);
    return () => node.removeEventListener(`draft-${name}`, listen);
  });
  return () => off.forEach(f => f());
}

const EVENT_PROPS = new Set(HOST_EVENTS.map(name => `on${name}`));

/**
 * Every prop but the event props: the attributes a component passes to its element, such as
 * `data-theme`, `id` or `aria-*`.
 * @param {Record<string, unknown>} rest
 */
export function elementAttributes(rest) {
  return Object.fromEntries(Object.entries(rest).filter(([key]) => !EVENT_PROPS.has(key)));
}

/**
 * Sets `attributes` on `node` and returns the undo. For `<draft-editor>`, which registers after
 * the first render: a Svelte spread on an element that is not yet defined writes `options` as the
 * text "[object Object]". These attributes are set in the browser only, so the editor's server
 * HTML has none; the editor itself renders in the browser only.
 * @param {HTMLElement} node
 * @param {Record<string, unknown>} attributes
 */
export function applyAttributes(node, attributes) {
  const off = Object.entries(attributes).map(([key, value]) => {
    if (key.startsWith('on') && typeof value === 'function') {
      const listener = /** @type {EventListener} */ (value);
      node.addEventListener(key.slice(2), listener);
      return () => node.removeEventListener(key.slice(2), listener);
    }
    // As the spread on `<draft-diagram>` does: `false` is the text "false", as for `aria-*`.
    if (value == null) return () => {};
    node.setAttribute(key, value === true ? '' : String(value));
    return () => node.removeAttribute(key);
  });
  return () => off.forEach(f => f());
}
