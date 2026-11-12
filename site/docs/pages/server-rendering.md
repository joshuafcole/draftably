# Server rendering and strict CSP

Draw the diagram on the server, so the page shows it before any script runs, and keep it working
under a strict Content Security Policy.

## Server rendering

Render the static SVG on the server and pass it as `svg`. The page then shows the diagram before
JavaScript loads. The viewer replaces it after its first successful draw; if that draw fails, the
SVG remains visible. The SVG is also available to search engines and link previews. Give each
inline diagram on a page its own `idPrefix`. Pass `colorScheme: 'auto'` so the server's SVG holds both schemes as `light-dark()` colors,
and a dark page shows it dark before the element upgrades (see [Dark pages](#dark-pages)):
`renderSvg(source, { target: 'inline', idPrefix, colorScheme: 'auto' })`. Slot content renders on the server too, and
`host.css` hides it until the element loads, so nothing shifts.

Each framework page shows the call in a Vite app and in its meta-framework:

| Framework  | Where `renderSvg` runs                                                   | Import from               | Code                                |
| ---------- | ------------------------------------------------------------------------ | ------------------------- | ----------------------------------- |
| Next.js    | a server component (`app/page.tsx`)                                      | `@draftably/react/server` | [React and Next.js](#nextjs)        |
| SolidStart | a `query` with `'use server'`, read with `createAsync`                   | `@draftably/solid`        | [Solid and SolidStart](#solidstart) |
| Nuxt       | `useAsyncData` in the page, so the payload carries the SVG to the client | `@draftably/vue`          | [Vue and Nuxt](#nuxt)               |
| SvelteKit  | `load` in `+page.server.ts`                                              | `@draftably/svelte`       | [Svelte and SvelteKit](#sveltekit)  |

The editor loads in the browser only, after the component mounts. Its element renders on the
server as an empty, sized box.

Each of these four setups is built and checked before every release.

## Keep an image as a fallback

Put an ordinary image inside the element. It stays visible until the first successful render,
including when JavaScript or the worker cannot load:

```html
<draft-diagram source='node api "API"' label="API diagram">
  <img src="/diagrams/api.svg" alt="The API service." style="max-width:100%;height:auto" />
</draft-diagram>
```

Generate the image with [`renderSvg`](#render-svg) during your build. The element restores its
fallback when disconnected, and adding it again creates a new viewer. Frameworks can render the
element and fallback normally; they do not own its shadow root.

Missing, empty or whitespace-only source keeps the fallback visible. Set `source` when your data
arrives. Clearing it cancels rendering and restores the fallback; `updateComplete` resolves to
`undefined` while no source is present.

With `mountViewer`, keep the image as a sibling of an empty host. Hide it only after an update
returns `committed`, so a failed worker or font still leaves a useful page.

## Strict CSP

Draftably works under a strict Content Security Policy with nonces and no `'unsafe-inline'`:

```text
default-src 'self'; script-src 'self' 'nonce-RANDOM'; style-src 'self' 'nonce-RANDOM';
font-src 'self' data:; img-src 'self' data:; worker-src 'self'; object-src 'none'; base-uri 'none'
```

- **Styles.** The elements' styles are constructable stylesheets, which need no nonce. The static
  SVG from `renderSvg` holds a `<style>`: pass your nonce as `styleNonce`. The viewer adds one to
  its drawing: pass it as `options={{ render: { styleNonce } }}`.
- **Fonts.** The viewer embeds its fonts as `data:` URLs, so `font-src` needs `data:`. To serve
  fonts from your origin instead, import `@draftably/runtime/fonts.css` and set
  `render: { fonts: 'host' }`; then `font-src 'self'` is enough.
- **Workers.** The viewer's render worker and the editor's engine worker are module files beside
  each package, so `worker-src 'self'` is enough.
- **Your framework.** Its own inline scripts need the nonce. Each framework page has the code:
  [Next.js](#nextjs) reads it from the request's CSP header, [SolidStart](#solidstart) from
  `createHandler`'s `nonce`, and [Nuxt](#nuxt) and [SvelteKit](#sveltekit) from a server hook
  that adds it to each tag.
