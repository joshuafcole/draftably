# Get started

draftably turns short text into a laid-out diagram. Start in your browser: you need no install to
make a diagram and keep it.

## Make a diagram in your browser

You write the boxes and lines. draftably places the boxes and routes every line. The example below
is live: it has two boxes and no line.

```draft
diagram "First diagram" version=1
node idea "Idea" color=blue
node sketch "Sketch" color=teal
```

1. Add this line at the end of the source:

   ```text
   edge e1 idea -> sketch "becomes"
   ```

2. Look at the drawing. It redraws with a line from Idea to Sketch.
3. Select **Playground**. The Playground opens with your diagram. After you edit it there,
   the browser keeps your last draft.
4. Keep a copy: select **Copy link** to get a URL that holds the source, or select **Download**
   and pick PNG, SVG or `.draft`.

Edits on this page are not kept. [Save, share and reopen](#saving) tells you where each copy of
your work is kept.

## Pick your next step

- **Continue in the browser.** Use the [Playground](/play) for short diagrams and shared links. Read
  [Rules](#rules) for every statement.
- **Build a specific diagram.** Start with a copyable [recipe](#recipes) for a flow, sequence or
  architecture diagram.
- **Install the CLI to save files on disk.** Your diagrams become `.draft` files that you can
  commit, check in CI and give to a coding agent. The editor saves each edit to the file. The
  steps are below.
- **Show diagrams in your app.** The [embedding quick start](#embed-quick-start) puts a live
  diagram on a page. Each framework has a complete app: [React](#react) · [Solid](#solid) · [Vue](#vue) · [Svelte](#svelte) · [Plain HTML](#plain-html).

## Install

draftably is one npm package with the CLI and the editor in it. It needs Node 22.21 or later. Pick
one of these three ways.

Run it without an install:

```sh
npx draftably --help
```

Install it once with npm:

```sh
npm install --global draftably
```

Install it once with pnpm. First run `pnpm setup` one time, then open a new terminal, because
`pnpm add --global` stops with `not in PATH` until you do:

```sh
pnpm setup
```

```sh
pnpm add --global draftably
```

Every command below works as `npx draftably …` or, once installed, `draftably …`.

## Write your first file

Save this source as `architecture.draft`. The live example below shows a small architecture
diagram with a group, three boxes and two connections:

```draft
diagram "Architecture" version=1
group backend "Backend" color=teal
node app "Web app" color=blue
node api "API" in=backend
node db "Database" in=backend shape=pill
edge request app -> api "HTTPS"
edge query api -> db "query"
```

Each line is one statement. A `node` is a box, a `group` is a container, and an `edge` connects
objects by ID. The file has no coordinates: Draftably uses the connections to place the boxes.

## Open it in the editor

```sh
npx draftably open architecture.draft
```

`open` serves the editor on the first free port from 5180, such as `http://127.0.0.1:5180/`. Open
the URL on the `Viewer:` line if your browser does not open. Edits in the editor save to the file;
edits in another program appear in the editor too. Press **Ctrl+C** in the terminal to stop it.
Run `open` with no file to browse `.draft` files in the current folder or create a new one.

## Check it and export it

```sh
npx draftably check architecture.draft                            # errors, warnings, drawing conflicts
npx draftably inspect architecture.draft --svg > architecture.svg # SVG with the source inside
npx draftably vary architecture.draft                             # try other layouts and rank them
```

`check` exits 1 when the file has errors, so it fits in CI.
The SVG is a shareable static image. Its embedded source lets you reopen it in Draftably.

To continue from the exported image, run `draftably open architecture.svg`. It writes
`architecture.draft` beside the image if that file is missing, then opens it; the SVG does not
change. If the file already has the embedded source, Draftably reuses it. If it has different
content, `open` stops without overwriting it.

## Update or upgrade draftably

Each way of running draftably has its own update. Use the step for your way to upgrade to the
latest version.

With npx, name the latest version in each command. A plain `npx draftably` can keep a copy from an
earlier run:

```sh
npx draftably@latest --version
```

With npm:

```sh
npm install --global draftably@latest
```

With pnpm:

```sh
pnpm add --global draftably@latest
```

Then do these two steps if they apply to you:

- **An editor is running.** It stays on the old version. Restart it with
  `draftably open architecture.draft --replace`.
- **You installed the [agent skill](#agent-skill).** Install it again, so your agent reads the new
  version. Use the same `--global` or `--dir` option as the first time.

  ```sh
  draftably skill install --force
  ```

Once a day the CLI checks npm and prints a note when there is a newer version. Set
`DRAFTABLY_NO_UPDATE_CHECK=1` to skip that check.

## Next

- [Rules](#rules): every statement and attribute on one page.
- [CLI](#cli): what each command does and its options. [Troubleshoot common problems](#troubleshoot-common-problems) helps
  when a command fails.
- [Themes](#themes): the five looks, drawn from one file.
- [Agent skill](#agent-skill): let a coding agent write and check diagrams for you.
- [Choose how to embed](#embed): show or edit diagrams in your own app.
