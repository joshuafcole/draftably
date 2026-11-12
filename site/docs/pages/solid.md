# Solid and SolidStart

`DraftDiagram` shows a diagram and `DraftEditor` edits one, in Solid. Both wrap the
[elements](#embed-concepts), so they take any attribute, a ref and `on…` event props.

## Build the app

A complete Vite app with both components, an event, a field on a node, a dark page, `host.css`
and server rendering. Start from `pnpm create vite` with the `solid-ts` template, then add the
files below. CI builds this app from this page: it type-checks it, builds it, renders it on the
server, loads it, and edits a diagram under the development server.

### Install

```sh
pnpm add @draftably/solid @draftably/runtime
```

### Configure Vite

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  // `ssr: true` compiles for both the browser and src/server.tsx.
  plugins: [solid({ ssr: true })],
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

### The app

```tsx
// src/App.tsx
import { createSignal } from 'solid-js';
import { DraftDiagram } from '@draftably/solid';
import { DraftEditor } from '@draftably/solid/editor';
import { initial } from './diagram';

export function App(props: { svg?: string }) {
  const [source, setSource] = createSignal(initial);
  const [note, setNote] = createSignal('');
  const [picked, setPicked] = createSignal('nothing');
  return (
    <main class="app dark">
      <DraftDiagram
        source={source()}
        svg={props.svg}
        label="Checkout"
        options={{ detail: 'full' }}
        onItemactivate={({ id }) => setPicked(id)}
        onDiagnostics={({ diagnostics }) => diagnostics.forEach(d => console.warn(d.message))}
      >
        <div data-draft-slot="body:api" class="card">
          <strong>API</strong>
          <input
            data-draft-input
            value={note()}
            placeholder="Add a note"
            onInput={event => setNote(event.currentTarget.value)}
          />
        </div>
      </DraftDiagram>
      <p>Picked: {picked()}</p>
      <DraftEditor
        data-theme="dark"
        source={source()}
        onChange={({ source: next }) => setSource(next)}
      />
    </main>
  );
}
```

### The client entry

```tsx
// src/main.tsx
import '@draftably/runtime/host.css';
import './theme.css';
import { render } from 'solid-js/web';
import { App } from './App';

// With HTML from src/server.tsx, call hydrate with the same `svg` instead.
render(() => <App />, document.getElementById('root')!);
```

### Render on the server

```tsx
// src/server.tsx
import { renderToString } from 'solid-js/web';
import { renderSvg } from '@draftably/solid';
import { App } from './App';
import { initial } from './diagram';

/** The page's HTML, with the diagram drawn before any script runs. */
export async function render(): Promise<string> {
  const result = await renderSvg(initial, {
    target: 'inline',
    idPrefix: 'checkout',
    colorScheme: 'auto',
  });
  return renderToString(() => <App svg={result.ok ? result.value.svg : undefined} />);
}
```

Key a list of bodies by ID (`<For each={ids()}>`), so a changed label keeps its element and the
focus in it. The package ships its JSX source under the `solid` export condition, so
`vite-plugin-solid` compiles it for the browser and for SolidStart's server.

## SolidStart

SolidStart runs `renderSvg` in a server function and sends the SVG to the client with the page.
Read it with `createAsync`, so the server and the client render the same props:

```tsx
// src/routes/index.tsx
import '@draftably/runtime/host.css';
import '~/theme.css';
import { createAsync, query } from '@solidjs/router';
import { getRequestEvent } from 'solid-js/web';
import { Show } from 'solid-js';
import { renderSvg } from '@draftably/solid';
import { App } from '~/App';
import { initial } from '~/diagram';

const getDiagram = query(async () => {
  'use server';
  // From src/middleware.ts below. Without a CSP, drop the nonce.
  const nonce = getRequestEvent()!.locals.nonce;
  const result = await renderSvg(initial, {
    target: 'inline',
    idPrefix: 'checkout',
    colorScheme: 'auto',
    styleNonce: nonce,
  });
  return { svg: result.ok ? result.value.svg : undefined, nonce };
}, 'diagram');

export const route = { preload: () => getDiagram() };

export default function Home() {
  const props = createAsync(() => getDiagram());
  return <Show when={props()}>{p => <App svg={p().svg} nonce={p().nonce} />}</Show>;
}
```

Add `nonce?: string` to `App`'s props and pass it on to the viewer, which adds a `<style>` to its
drawing: `options={{ detail: 'full', render: { styleNonce: props.nonce } }}`.

### Strict CSP in SolidStart

A middleware makes a nonce for each request and sends the policy:

```ts
// src/middleware.ts
import { randomBytes } from 'node:crypto';
import { createMiddleware } from '@solidjs/start/middleware';

/** A nonce per request, and the strict CSP that allows only it. */
export default createMiddleware({
  onRequest: event => {
    const nonce = randomBytes(16).toString('base64');
    event.locals.nonce = nonce;
    event.response.headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        `style-src 'self' 'nonce-${nonce}'`,
        "font-src 'self' data:",
        "img-src 'self' data:",
        "worker-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
      ].join('; '),
    );
  },
});
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { nitro } from 'nitro/vite';
import { solidStart } from '@solidjs/start/config';

export default defineConfig({
  plugins: [solidStart({ middleware: 'src/middleware.ts' }), nitro()],
});
```

Then give `createHandler` the nonce, so SolidStart puts it on its own scripts. `mode: 'async'`
renders the whole page before it sends it:

```tsx
// src/entry-server.tsx (the last argument of createHandler)
event => ({ mode: 'async', nonce: event.locals.nonce }),
```

Declare `nonce: string` on `App.RequestEventLocals` in a `.d.ts` file to type `locals.nonce`.
