# Quick start

Put an interactive diagram in your app in four steps: install, import `host.css`, configure Vite
5–7 if you use it, and add a diagram that listens for one event.

## Install

Install the package for your framework and the runtime beside it:

```sh
pnpm add @draftably/react @draftably/runtime
```

Use `@draftably/solid`, `@draftably/vue` or `@draftably/svelte` in place of `@draftably/react`.
Without a framework, install `@draftably/runtime` alone, and add `@draftably/editor` for the
editor. Your app imports `@draftably/runtime/host.css` itself, and pnpm does not let an app
import a package it does not list, so the runtime is always a direct dependency.

## Import host.css once

```ts
import '@draftably/runtime/host.css';
```

Import it once per page, in your client entry. It holds the rules that must work in the page, not
inside an element:

- It reserves each element's height before the element loads, so the page does not shift.
- It hides slot content until its element loads, so nothing flashes.
- It lets content marked `data-draft-input` take the pointer. Without it, a button on a node takes
  no clicks.

## Configure Vite 5–7

With Vite 5, 6 or 7, exclude both packages from dependency optimization, so the viewer's and the
editor's workers load in development:

```ts
// vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  optimizeDeps: { exclude: ['@draftably/runtime', '@draftably/editor'] },
});
```

Vite 8 needs no setting. A production build works on every version. Without the setting, the
development server serves each worker from `.vite/deps/assets/` and returns 404: the viewer never
draws, and the editor computes on the main thread.

With React, also add `include: ['@draftably/react', '@draftably/react/editor']`, so adding the
editor while the development server runs does not load a second copy of React.

## Add a diagram and listen

```tsx
import { DraftDiagram } from '@draftably/react';

export function Checkout() {
  return (
    <DraftDiagram
      source={'node web "Web"\nnode api "API"\nedge e1 web -> api "submit"'}
      label="Checkout"
      onItemactivate={({ id }) => console.log('picked', id)}
    />
  );
}
```

Without a framework, the element is the same diagram:

```ts
import '@draftably/runtime/element';

const diagram = document.createElement('draft-diagram');
diagram.source = 'node web "Web"\nnode api "API"\nedge e1 web -> api "submit"';
diagram.addEventListener('draft-itemactivate', event => console.log('picked', event.detail.id));
document.body.append(diagram);
```

The diagram is 26rem tall. It zooms with the wheel, pans with a drag, and fits with **Fit
diagram**. A press on a node sends `itemactivate`.

## Next steps

- Your framework's page has a complete app with the editor, content on a node, a dark page and
  server rendering: [React](#react), [Solid](#solid), [Vue](#vue), [Svelte](#svelte) or
  [plain HTML](#plain-html).
- [How embedding works](#embed-concepts) explains the element, the mount and `status`.
- [Troubleshooting](#troubleshooting) lists each symptom and its fix.
