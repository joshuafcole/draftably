---
'draftably': patch
'@draftably/runtime': minor
'@draftably/editor': minor
'@draftably/react': minor
'@draftably/solid': minor
'@draftably/vue': minor
'@draftably/svelte': minor
---

The framework components pass every other attribute, such as `data-theme`, `id` or `aria-*`, to
their element. Before, React, Solid and Svelte dropped them with no warning, so
`<DraftEditor data-theme="dark" />` stayed light.

The Svelte components no longer write `options="[object Object]"` on their elements in server
HTML. `DraftEditor` sets its other attributes in the browser, so its server HTML has none.

Event props can cancel. `onLink` and `onContextmenu` (`@link`, `onlink`, …) receive the event's
`detail` with a `preventDefault()` that cancels the DOM event, so
`onContextmenu={e => e.preventDefault()}` stops the browser's menu with no listener on the
element. `@draftably/runtime/host` exports `hostDetail(event)` and the `HostEventDetail` type for
the same purpose.
