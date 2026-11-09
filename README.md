# draftably

draftably turns plain-text `.draft` files into diagrams. Describe the boxes, groups and connections;
draftably places the boxes and routes the lines. Open the diagram in the browser to refine it.
Your source stays readable, so you can keep it beside your code, review changes in Git,
and give the same file to a coding agent.

Use it for architecture diagrams, process flows, sequences, state machines and database schemas.
Start in the browser with no install, or use the CLI to edit files on disk.

[Try the live demo](https://draftably.dev/) · [Playground](https://draftably.dev/play) ·
[Editor](https://draftably.dev/app/) · [Documentation](https://draftably.dev/docs/get-started) ·
[npm package](https://www.npmjs.com/package/draftably)

## What a diagram looks like

Save this as `architecture.draft`:

```text
diagram "Architecture" version=1
group backend "Backend" color=teal
node app "Web app" color=blue
node api "API" in=backend
node db "Database" in=backend shape=pill
edge request app -> api "HTTPS"
edge query api -> db "query"
```

A `node` is a box, a `group` is a container, and an `edge` connects them by ID.
Here, the API and database sit inside Backend. The connections put Web app before API before
Database, with no coordinates to maintain. Labels can change without changing the IDs.

Automatic layout gives you a starting arrangement. Use layout rules to choose a direction or
engine, drag a node to save a relative placement preference, or pin it at an exact position.
Editor changes save to the same `.draft` source. Changes from a text editor or agent update
the drawing while the local editor is open.

See the [language reference](docs/DSL.md) for layout rules, nested groups, swim lanes, sequences,
cells and placement controls. The [examples](examples/) show complete diagrams.

## Get started

### In your browser

Open the [Playground](https://draftably.dev/play), pick an example, and edit its source.
The diagram redraws as you type. Select **Copy link** to share the current source in a URL,
or **Download** to keep a `.draft`, PNG or SVG file.

The Playground keeps your last draft in this browser. Download a file to keep a separate copy;
browser storage does not move to another device. Open the [Editor](https://draftably.dev/app/)
for direct canvas editing and layout tools.

### On your files

Requires **Node 22.21 or later**. Create a starter file, then run the published CLI without
cloning this repository:

```sh
cat <<'DRAFT' > architecture.draft
diagram "Architecture" version=1
node app "Web app"
node api "API"
node db "Database" shape=pill
edge request app -> api "HTTPS"
edge query api -> db "query"
DRAFT
pnpm dlx draftably open architecture.draft
```

The CLI serves the bundled editor locally. Open the URL on its `Viewer:` line if your browser
does not open automatically. Edits save back to the file. Press **Ctrl+C** to stop the server.
Run `pnpm dlx draftably open` without a file to browse the folder, create a diagram, or try an
example.

For regular use, install it once. Then open, check, format or export diagrams from the terminal:

```sh
pnpm add --global draftably
draftably open architecture.draft
```

```sh
draftably check architecture.draft
draftably format architecture.draft --write
draftably inspect architecture.draft --svg > architecture.svg
draftably inspect architecture.draft --png architecture.png
```

`check` reports source errors and drawing conflicts, and exits 1 on errors for CI.
The CLI draws PNG and PDF files itself, so export needs no browser. The package includes the CLI,
editor and computation workers.

## Review, refine and share

- **Review a change as a diagram.** Prefix declarations with `+`, `-` or `~` to show additions,
  removals and changes. `draftably compare before.draft after.draft --svg > diff.svg` creates
  a marked drawing from two files. A `compare "Before" "After"` line shows aligned panels.
- **Try other layouts.** `draftably vary architecture.draft` renders and ranks layout variants
  on a contact sheet. Use `draftably vary architecture.draft --apply best` to keep one.
  In the editor, compare candidates, inspect recorded layout steps, or adjust a local area
  with the layout brush. Layout edits are undoable.
- **Change the look.** A `theme` line selects drafting, fieldnotes, signal, ink or blueprint.
  Themes change the appearance while preserving placement. Color families and type settings
  can also be set in source.
- **Explain one path.** Named emphasis states keep selected nodes and connections in focus
  while the rest fades. Export a state with `draftably inspect plan.draft --svg --state <id>`.
- **Keep the source with the picture.** PNG and SVG exports embed their `.draft` source by default.
  Drop or paste an export on the site, or run `draftably open architecture.svg`, to edit it again.
  `draftably extract architecture.png` prints the source. Use `--no-source` when an image should
  omit it. Image services that re-encode an upload can strip the embedded source.

Read the [CLI guide](https://draftably.dev/docs/cli) for commands and options, and
[Save, share and reopen](https://draftably.dev/docs/saving) for storage and export behavior.

## Use with a coding agent

The package bundles a skill that teaches agents to write, check, render and refine `.draft` files.
Install it in your project:

```sh
pnpm dlx draftably skill install                       # ./.claude/skills/draftably
pnpm dlx draftably skill install --dir .agents/skills  # Codex or another skills folder
```

Then ask for a concrete result, for example:

> Draw the checkout flow in src/checkout as a .draft file next to it, and open it for me.

The agent edits text and checks the result with the CLI. You can refine the drawing in the editor
and return the same file to the agent. Read the [skill](skills/draftably/SKILL.md) or the
[agent guide](https://draftably.dev/docs/agent-skill) for the full workflow.

Import DOT, Mermaid flowcharts and D2 graphs as editable native diagrams. See [Import diagrams](https://draftably.dev/docs/import).

## Integrate

Show diagrams in your own pages, scripts and documentation sites:

````sh
pnpm add @draftably/runtime    # <draft-diagram> element, viewer, renderSvg()
pnpm add @draftably/markdown   # remark and markdown-it plugins for ```draft fences
````

```ts
import '@draftably/runtime/element';
// <draft-diagram source='node api "API"' label="API diagram"></draft-diagram>
```

[Embed diagrams](https://draftably.dev/docs/embed) compares every route, from a committed image to a
documentation-site plugin, with a complete start for each. Using Mermaid today?
[Switch from Mermaid](https://draftably.dev/docs/from-mermaid) with one alias. [Support](https://draftably.dev/docs/support) lists tested
hosts, and [Build an adapter](https://draftably.dev/docs/build-an-adapter) shows how to add another.

## Develop

Built with SolidJS, TypeScript and Vite. Use Node 22.21 or later and pnpm 11.

```sh
pnpm install
pnpm dev
```

| Command               | Purpose                                                 |
| --------------------- | ------------------------------------------------------- |
| `pnpm dev`            | Run the editor dev server.                              |
| `pnpm site:dev`       | Run the public site dev server.                         |
| `pnpm build`          | Typecheck and build the editor into `dist/`.            |
| `pnpm site:build`     | Build the public site and editor into `dist-site/`.     |
| `pnpm check:fast`     | Run typecheck, lint, formatting and unit tests.         |
| `pnpm check`          | Also run engine regression suites and the editor build. |
| `pnpm cli:build`      | Build the published CLI and bundled viewer.             |
| `pnpm cli:pack-check` | Test a clean package install.                           |

Run repository CLI commands as `pnpm draftably …`. Build the editor with `pnpm build` before
using `pnpm draftably open`.

- [Architecture](docs/ARCHITECTURE.md): source map and how the pieces fit together.
- [Checks](docs/CHECKS.md): test suites, browser proofs, screenshots and performance budgets.
- [Releasing](docs/RELEASING.md): Changesets and package publishing.
- [Source record](docs/IMPORT.md): the original release and Meld language prototype.

## License

[MIT](LICENSE) © Byron Wall
