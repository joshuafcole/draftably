# Choose how to embed

Show `.draft` diagrams in your own pages, apps and documentation. Every route draws with the same
compiler and router as the CLI, so a diagram looks the same everywhere. First decide who draws.

| Who draws          | Draftably gives                                                  | Your app draws                    | Start with                                   |
| ------------------ | ---------------------------------------------------------------- | --------------------------------- | -------------------------------------------- |
| Draftably          | The drawing, pan and zoom, a keyboard outline, editing           | Content on nodes, if you want any | [Quick start](#embed-quick-start)            |
| Your app           | Layout and routed lines, as data                                 | Everything: boxes, lines, labels  | [Your app draws](#your-app-draws)            |
| A flow library     | Layout for React Flow, Svelte Flow, elkjs, dagre or Cytoscape.js | Nodes, and lines from each `path` | [Drop in your graph layout](#layout-drop-in) |
| Nobody, at runtime | A static SVG or PNG from a build step or the CLI                 | Nothing                           | [Render SVG](#render-svg)                    |

## Draftably draws

Pick your framework. Each page has a complete app, server rendering for its meta-framework, and a
strict Content Security Policy.

| You build with             | Read                                     | Install                                         |
| -------------------------- | ---------------------------------------- | ----------------------------------------------- |
| React or Next.js           | [React and Next.js](#react)              | `pnpm add @draftably/react @draftably/runtime`  |
| Solid or SolidStart        | [Solid and SolidStart](#solid)           | `pnpm add @draftably/solid @draftably/runtime`  |
| Vue or Nuxt                | [Vue and Nuxt](#vue)                     | `pnpm add @draftably/vue @draftably/runtime`    |
| Svelte or SvelteKit        | [Svelte and SvelteKit](#svelte)          | `pnpm add @draftably/svelte @draftably/runtime` |
| Plain HTML, Angular, a CDN | [Plain HTML and no bundler](#plain-html) | `pnpm add @draftably/runtime @draftably/editor` |

Add the [editor](#editor-component) to let users change a diagram. [How embedding
works](#embed-concepts) explains the model that every framework shares.

## Other routes

| You want to                                      | Read                                            | Install                                   |
| ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------- |
| Replace Mermaid on a site you run                | [Switch from Mermaid](#from-mermaid)            | `pnpm add mermaid@npm:@draftably/mermaid` |
| Turn `draft` fences into images                  | [Markdown](#markdown)                           | `@draftably/markdown`                     |
| Add diagrams to Starlight, Docusaurus, VitePress | [Documentation sites](#documentation-sites)     | `@draftably/markdown`                     |
| Draw diagrams in a GitHub README                 | [GitHub Action](#github-action)                 | A workflow step                           |
| Put an image in a wiki, chat or slide            | [An image for any host](#an-image-for-any-host) | `draftably`                               |

The packages need Node 22.21 or later and are ES modules only. [Support](#support) lists each
package and the hosts it is tested on.

## An image for any host

When you do not control the page, such as a wiki, a chat or a slide, export an image and keep it
beside its source:

```sh
draftably inspect architecture.draft --svg > architecture.svg
draftably inspect architecture.draft --png architecture.png
```

The image holds its source, so `draftably open architecture.svg` opens it again for editing. Use
PNG where a host blocks SVG.
