# Support

What each package does, where it is tested, and what is not supported yet. Every package needs
Node 22.21 or later and is ES modules only.

## Packages

Choose a package by where the diagram runs:

| Package                       | Use it to                                                   | Guide                                                |
| ----------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `draftably`                   | Check, draw and edit `.draft` files from the terminal       | [CLI](#cli)                                          |
| `@draftably/runtime`          | Render SVG; show the `<draft-diagram>` element or a viewer  | [Render SVG](#render-svg), [Plain HTML](#plain-html) |
| `@draftably/react` and others | Show or edit a diagram in a component                       | [Choose how to embed](#embed)                        |
| `@draftably/editor`           | Put the drag-and-drop editor in your page                   | [Editor component](#editor-component)                |
| `@draftably/markdown`         | Turn `draft` and `mermaid` fences into images at build time | [Markdown](#markdown)                                |
| `@draftably/mermaid`          | Draw your Mermaid flowcharts and sequences with Draftably   | [Switch from Mermaid](#from-mermaid)                 |

Every package draws with the same compiler and renderer, so a diagram looks the same in each.
For Markdown that a host renders without your JavaScript, use the CLI or the
[GitHub Action](#github-action) to commit SVGs. For a site build you control, use
`@draftably/markdown` to generate image assets. Use `@draftably/mermaid` when an app already calls
the Mermaid API and you want Draftably to draw supported flowcharts and sequences.

## Tested hosts

CI installs the packed packages into real projects and drives them in Chromium:

| Host                              | What passes                                                                               |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| Node and strict TypeScript        | `renderSvg` and `validate`, under a nested base path                                      |
| Vite                              | Element, viewer, worker loading, source updates, fallback and cleanup                     |
| React 19, Solid, Vue 3, Svelte 5  | Production build, server render, three diagrams and two editors per page                  |
| Unified, MDX, markdown-it         | Static images with alt text; cached assets restored                                       |
| Astro 7.4.5 with Starlight 0.42.9 | Production build and include edits in development                                         |
| Docusaurus 3.10.2                 | Production build, include edits, and `@docusaurus/theme-mermaid` with the Mermaid drop-in |
| VitePress 1.6.4                   | Production build and include edits through the prebuild step                              |
| Mermaid's CDN snippet             | Flowcharts and sequences, with only the import URL changed                                |

The viewer passes keyboard checks and a 390 px wide check. The [Documentation sites](#documentation-sites)
recipes list the caveats for each site.

## Not supported yet

- **Hosted Markdown.** GitHub, GitLab and npm draw diagrams on their own servers. Commit an SVG
  with `draftably inspect --svg`, or let the [GitHub Action](#github-action) do it.
- **Editor plugins.** There is no VS Code or Obsidian extension.
- **MkDocs and Pandoc.** There is no plugin. Use committed SVG or PNG images.

To build an integration for another host, read [Build an adapter](#build-an-adapter).

## Upgrade from draftably 0.10

The CLI, the editor, the `.draft` language and saved files do not change, and diagrams lay out the
same way. SVG exports change in two small ways:

- Bundled font family names carry a short hash, such as `'Draft Inter 269b2d3580f4'`. CSS that
  targets `'Draft Inter'` no longer matches. The fallback list (`Inter, Arial, sans-serif`) is the
  same.
- The root `<svg>` has `id="draft-svg"`, `role="img"` and `aria-labelledby`. To paste several
  exports into one HTML page, render them with [`target: 'inline'`](#inline-output) and a unique
  `idPrefix` each.

Exports from 0.10 open in the new version, and new exports open in 0.10.

## Move Mermaid diagrams

Use `@draftably/mermaid` to keep an app's Mermaid API calls, or use
`draftably migrate 'docs/**/*.md' --write` to convert supported Markdown flowchart and sequence
fences to Draftably source. Review warnings before adding `--accept-lossy`; unsupported Mermaid
families stay Mermaid. For built documentation, the Markdown plugin can render supported Mermaid
fences to static SVGs without changing their source.
