# Plain HTML and no bundler

`<draft-diagram>` and `<draft-editor>` are custom elements, so any page can use them: a page with
no build step, a CDN, a server-rendered template, Angular, or a Vite app.

## No bundler

Without a bundler, serve each package's `dist` folder from your own origin and load the element
with a module script. Keep every file in `dist` in place: the element imports its chunks, its
workers and its fonts from beside itself.

```html
<link rel="stylesheet" href="/draftably/runtime/dist/host.css" />
<script type="module" src="/draftably/runtime/dist/element.js"></script>
<script type="module" src="/draftably/editor/dist/element.js"></script>

<draft-diagram source='node web "Web"&#10;node api "API"&#10;edge e1 web -> api'></draft-diagram>
```

Copy the folders from `node_modules/@draftably/runtime/dist` and `node_modules/@draftably/editor/dist`
to the paths your server serves, here `/draftably/…/dist`. The editor is needed only for
`<draft-editor>`.

### From a CDN

A browser runs a module worker only from the page's own origin, so a diagram loaded from a CDN
cannot start its render worker. Draw on the main thread instead, and set that before the element
mounts:

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@draftably/runtime@0.4/dist/host.css" />

<draft-diagram source='node web "Web"&#10;node api "API"&#10;edge e1 web -> api'></draft-diagram>

<script type="module">
  import 'https://cdn.jsdelivr.net/npm/@draftably/runtime@0.4/dist/element.js';

  // In the same task as the import, so it lands before the first draw.
  document.querySelector('draft-diagram').options = { execution: { mode: 'main' } };
</script>
```

The main thread then compiles each diagram, which blocks the page for a large one: use it for
small diagrams, or serve `dist` from your origin as above. The editor's engine moves to the main
thread by itself when its worker cannot start, and says so in the console.

## Build the app

A complete Vite app with both elements, an event, a field on a node, a dark page, `host.css` and
server rendering. Start from `pnpm create vite` with the `vanilla-ts` template, then add the files
below. CI builds this app from this page: it type-checks it, builds it, renders it on the server,
loads it, and edits a diagram under the development server.

### Install

```sh
pnpm add @draftably/runtime @draftably/editor
```

### The page

```html
<!-- index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Checkout</title>
  </head>
  <body>
    <main class="app dark">
      <draft-diagram label="Checkout">
        <div data-draft-slot="body:api" class="card">
          <strong>API</strong>
          <input data-draft-input placeholder="Add a note" />
        </div>
      </draft-diagram>
      <p>Picked: <output id="picked">nothing</output></p>
      <draft-editor data-theme="dark"></draft-editor>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

### Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  // Vite 5–7 need this, so the workers load in development. Vite 8 works without it.
  optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] },
});
```

### The diagram and its theme

```ts
// src/diagram.ts
// `size api … min-height=120` gives the body on `api` room. Layout never measures host content.
export const initial = `diagram "Checkout" version=1
node web "Web"
node api "API"
node db "Orders" shape=pill
edge e1 web -> api "submit"
edge e2 api -> db "save"
size api width=220 height=auto min-height=120
`;
```

```css
/* src/theme.css */
/* Host CSS reaches slot content. `color-scheme: dark` darkens the drawings, the viewers' frames
   and the editor. */
.app {
  display: grid;
  gap: 16px;
  padding: 16px;
}
.app.dark {
  color-scheme: dark;
  background: #020617;
  color: #e2e8f0;
}
.app draft-diagram {
  height: 20rem;
}
.app draft-editor {
  height: 24rem;
}
.card {
  box-sizing: border-box;
  height: 100%;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: #1d4ed8;
  color: #fff;
  font:
    13px/1.3 system-ui,
    sans-serif;
}
```

The page's `color-scheme` sets the colors: `.app.dark` draws the diagrams, the viewers' frames and
the whole editor dark, with no `--draft-*` values. Without that line they stay light, because a page
that declares no `color-scheme` draws light. `data-theme="dark"` on the editor fixes its
panels and toolbar to the dark set whatever the page does. [Theming](#theming) has every property
and the opt-out.

### The client entry

```ts
// src/main.ts
import '@draftably/runtime/element';
import '@draftably/editor/element';
import '@draftably/runtime/host.css';
import './theme.css';
import { initial } from './diagram';

const diagram = document.querySelector('draft-diagram')!;
const editor = document.querySelector('draft-editor')!;
diagram.options = { detail: 'full' };
diagram.source = initial;
editor.source = initial;

// Every draft-<name> event is in HTMLElementEventMap, so `detail` is typed with no cast.
diagram.addEventListener('draft-itemactivate', event => {
  document.querySelector('#picked')!.textContent = event.detail.id;
});
diagram.addEventListener('draft-diagnostics', event => {
  for (const d of event.detail.diagnostics) console.warn(d.message);
});
editor.addEventListener('draft-change', event => {
  diagram.source = event.detail.source;
});
```

### Render on the server

```ts
// src/server.ts
import { renderSvg } from '@draftably/runtime';
import { initial } from './diagram';

const attr = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/** The diagram's markup with its static SVG, for a page your server sends. */
export async function render(): Promise<string> {
  const result = await renderSvg(initial, {
    target: 'inline',
    idPrefix: 'checkout',
    colorScheme: 'auto',
  });
  const svg = result.ok ? result.value.svg : '';
  return `<draft-diagram label="Checkout" source="${attr(initial)}">${svg}</draft-diagram>`;
}
```

## Angular

Angular uses the same elements. Add `CUSTOM_ELEMENTS_SCHEMA` to the component that uses them,
and bind the source as an attribute: `<draft-diagram [attr.source]="source">`. Import
`@draftably/runtime/element` and `@draftably/runtime/host.css` once.
