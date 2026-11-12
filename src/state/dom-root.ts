/**
 * Lookups that work when the editor renders inside a shadow root. A page-level listener sees an
 * event retargeted to the shadow host, and `document` lookups cannot see inside a shadow root.
 */

/** The document or shadow root that holds `node`. */
export const rootOf = (node: Node) => node.getRootNode() as Document | ShadowRoot;

/** The element the event started on, inside any shadow root. */
export const eventTarget = (e: Event) => (e.composedPath()[0] ?? e.target) as EventTarget | null;
