/**
 * The host proof page, shared by every framework's `Proof` component and every app that renders
 * it (the Vite apps here and the meta-framework apps in `integration-examples/meta/`).
 * `scripts/lib/host-proof.ts` drives the page; this file and that one are the page's contract.
 *
 * - `#p-viewer`: a `DraftDiagram` with a body on `api`. The body is a component that reads
 *   `PROOF_OWNER` from the framework's context, and holds a marked button and a marked input.
 *   It passes `data-proof="viewer"` through, and cancels its `contextmenu` and `link` with
 *   `cancelMenu` and `cancelLink`.
 * - `#p-editors`: two `DraftEditor`s with `data-proof="editor"`. Each reports its changes to
 *   `__proof.changes[i]`.
 * - `#p-cycle`: a `DraftDiagram` and a `DraftEditor` that `__proofToggle()` mounts and removes.
 * - `__proofUpdate()` and `__proofFail()` set the viewer's source; `__proofHydrated` is set
 *   once the framework has hydrated the server HTML.
 */
export const PROOF_OWNER = 'Proof host';

export const proofSource =
  'diagram "Proof" version=1\nnode web "Web" href="https://example.com/web"\nnode api "API"\nedge e1 web -> api "calls"\nsize api width=220 height=auto min-height=110\n';
/** Adds a node, so every target must keep its identity while the drawing moves. */
export const proofUpdated = `${proofSource}node cache "Cache"\nedge e2 api -> cache "reads"\n`;
/** An unterminated label: the viewer keeps its last drawing and reports the error. */
export const proofBroken = 'diagram "Proof" version=1\nnode api "API\n';

export const editorSources = [
  'diagram "Left" version=1\nnode a "Left A"\nnode b "Left B"\nedge e1 a -> b\n',
  'diagram "Right" version=1\nnode c "Right C"\nnode d "Right D"\nedge e1 c -> d\n',
];
export const cycleSource =
  'diagram "Cycle" version=1\nnode one "One"\nnode two "Two"\nedge e1 one -> two\n';

/** Test hooks: editor changes, marked-button clicks and the viewer's cancelled menus. */
export const proofHooks = () =>
  (globalThis.__proof ??= { changes: [[], []], clicks: 0, menus: [], links: [] });

/**
 * The viewer's `contextmenu` event prop: it cancels the browser's menu through the prop alone,
 * with no listener on the element.
 * @param {{ id: string | null; preventDefault(): void }} event
 */
export const cancelMenu = event => {
  event.preventDefault();
  proofHooks().menus.push(event.id);
};

/**
 * The viewer's `link` event prop: it keeps the page where it is through the prop alone.
 * @param {{ href: string; preventDefault(): void }} event
 */
export const cancelLink = event => {
  event.preventDefault();
  proofHooks().links.push(event.href);
};

/**
 * The viewer's options. `detail: 'full'` keeps the body at any zoom.
 * @param {string | undefined} nonce
 * @returns {import('@draftably/runtime/viewer').ViewerOptions}
 */
export const viewerOptions = nonce => ({
  detail: 'full',
  render: { links: { mode: 'safe' }, ...(nonce ? { styleNonce: nonce } : {}) },
});

/** Exposes the page's actions to the driver. */
export const exposeProof = actions =>
  Object.assign(globalThis, {
    __proofUpdate: actions.update,
    __proofFail: actions.fail,
    __proofToggle: actions.toggle,
    __proofHydrated: true,
  });
