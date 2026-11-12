# Switch from Mermaid

Keep your Mermaid diagrams and your page code. Draftably draws the diagrams that read better as
Draftably diagrams: flowcharts, sequences, and Draftably's own source. Every other Mermaid chart
still goes to Mermaid, so nothing on your site goes blank.

| Where your diagrams show                        | What to change                                          |
| ----------------------------------------------- | ------------------------------------------------------- |
| A site you build with npm (Vite, Docusaurus, …) | [One alias in `package.json`](#a-site-you-build)        |
| A page that loads Mermaid from a CDN            | [One import URL](#a-page-that-loads-mermaid-from-a-cdn) |
| A Markdown build you control (remark, MDX, …)   | [`draft` fences](#markdown-you-build)                   |
| GitHub, GitLab, npm or another host's renderer  | [A committed SVG](#github-and-other-hosted-markdown)    |

## A site you build

Point the `mermaid` package name at the drop-in:

```sh
pnpm add mermaid@npm:@draftably/mermaid
```

`package.json` now reads `"mermaid": "npm:@draftably/mermaid@^0.1.0"`, and your own
`import mermaid from 'mermaid'` gets Draftably. Calls to `initialize`, `run`, `render` and `parse`
behave as before. With Vite 5–7, see [Configure Vite 5–7](#configure-vite-57) so the
viewer's worker loads in development.

A plugin that depends on Mermaid itself, such as a Docusaurus or VitePress Mermaid theme, keeps
its own copy. Add an override so it gets the drop-in too:

| Package manager | Add                                                                                  |
| --------------- | ------------------------------------------------------------------------------------ |
| pnpm            | `mermaid: npm:@draftably/mermaid@^0.1.0` under `overrides:` in `pnpm-workspace.yaml` |
| npm             | `"overrides": { "mermaid": "npm:@draftably/mermaid@^0.1.0" }` in `package.json`      |
| Yarn            | `"resolutions": { "mermaid": "npm:@draftably/mermaid@^0.1.0" }` in `package.json`    |

### Mermaid theme in Docusaurus

Keep `markdown: { mermaid: true }` and `themes: ['@docusaurus/theme-mermaid']`. Add the override
above, then reinstall. Your `mermaid` code fences now draw with Draftably. With pnpm,
Docusaurus 3.10 also needs its optional peer installed: `pnpm add @mermaid-js/layout-elk`.

## A page that loads Mermaid from a CDN

The drop-in ships the same file name as Mermaid. Change the package in the import URL:

```diff
- import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
+ import mermaid from 'https://cdn.jsdelivr.net/npm/@draftably/mermaid@0/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true });
```

The file includes the Draftably renderer. It loads Mermaid from jsDelivr only for a chart that
Draftably leaves to Mermaid.

## What Draftably draws

| Source in a `.mermaid` block                 | Drawn by  |
| -------------------------------------------- | --------- |
| `flowchart` or `graph`                       | Draftably |
| `sequenceDiagram`                            | Draftably |
| Draftably source (`node`, `edge`, `diagram`) | Draftably |
| Any other Mermaid chart                      | Mermaid   |

Draftably does not imitate Mermaid's other charts. To keep Mermaid for its own syntax and use
Draftably only for Draftably source, set `mermaid.initialize({ draftably: { mermaid: 'off' } })`.
Each rendered block gets `data-renderer="draftably"` or `data-renderer="mermaid"`, so you can
check a page in the browser console:

```js
document.querySelectorAll('[data-renderer="mermaid"]');
```

The conversion keeps nodes, groups, labels and connections, and recomputes the layout. It drops
`classDef` styling, click callbacks and sequence activation bars.

## Markdown you build

For a static site with no diagram JavaScript, add the
[Markdown plugin](#mermaid-fences) with `mermaid: 'convert'`.
Your existing `mermaid` flowcharts and sequences become ordinary SVG images at build time, and
`draft` fences work beside them. Other Mermaid families stay code blocks, so keep your Mermaid
setup for those. [Documentation sites](#documentation-sites) has recipes for Astro Starlight,
Docusaurus and VitePress.

## GitHub and other hosted Markdown

GitHub, GitLab and npm draw Mermaid on their own servers and do not load your scripts. Commit an
image instead. The SVG keeps its source, so it stays editable:

```sh
draftably inspect architecture.draft --svg > architecture.svg
```

```markdown
![Architecture](architecture.svg)
```

`draftably open architecture.svg` opens the image for editing. Use `--png` where a host blocks SVG.

### Keep the images current with a GitHub Action

To skip the manual export, write `draft` fences in your README and docs and let CI draw them. The
[render-markdown action](#github-action)
renders each fence to an SVG beside the Markdown file and adds an image link under the fence. A
rerun updates the link in place. Add a commit step after it:

```yaml
- uses: byronwall/draftably/actions/render-markdown@main
  with:
    files: README.md docs/**/*.md
- uses: stefanzweifel/git-auto-commit-action@v5
```

[GitHub Action](#github-action) has the full workflow and the fence options.

## Convert the source

You don't have to rewrite anything for the drop-in. To move the Mermaid fences in your docs to
Draftably source for good, run `migrate` on the folder:

```sh
draftably migrate docs/
```

It changes nothing yet. It lists each `mermaid` fence and what would happen to it, with the
importer's warnings. Flowcharts and sequence diagrams become `draft` fences. Pie, gantt and other
charts stay Mermaid. When the list looks right, apply it:

```sh
draftably migrate docs/ --write
```

A fence with warnings stays Mermaid until you add `--accept-lossy`. Commit before you run
`--write`, so `git diff` shows each change. For a standalone `.mmd` file, use `import`:

```sh
draftably import checkout.mmd --output checkout.draft
```

| Mermaid                         | Draftably                                                 |
| ------------------------------- | --------------------------------------------------------- |
| `flowchart LR`                  | `layout root flow direction=right`                        |
| `A[Web app]`                    | `node A "Web app"`                                        |
| `B(API)`                        | `node B "API" shape=pill`                                 |
| `D{Cache hit?}`                 | `node D "Cache hit?" shape=diamond`                       |
| `subgraph backend [Backend]`    | `group backend "Backend"`, then `in=backend` on each node |
| `A -->\|HTTPS\| B`              | `edge e1 A -> B "HTTPS"`                                  |
| `D -.-> C`                      | `edge e2 D -> C kind=async`                               |
| `sequenceDiagram`               | `layout root sequence`                                    |
| `U->>A: POST /orders`           | `edge m1 U -> A "POST /orders"`                           |
| `Note over A: Writes the order` | `note "Writes the order" near=m2 side=right`              |

Every edge has an ID, so a label can change without breaking a reference. The
[language reference](#overview) covers layout rules, emphasis states and themes, which Mermaid
does not have. [Import diagrams](#import) lists every conversion warning.
