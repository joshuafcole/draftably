# CLI guide

`draftably` checks, formats, draws and edits `.draft` files, and serves the editor. Run any
command with `--help` for its own options, and `draftably --version` for the version.

Any file argument may also be a PNG, SVG or PDF that draftably exported. The command reads the
source embedded in it. A PDF can hold several diagrams, so name one as
`diagrams.pdf#architecture.draft`. `check` reads them all.

## open

Start on a page for this folder's diagrams:

```sh
draftably open
```

Edit one file:

```sh
draftably open architecture.draft
```

List the running editors:

```sh
draftably open --status
```

Serves the editor and opens the browser on macOS. Saves in the editor go back to the file, and
changes made to the file elsewhere show at once. Without a file, or with a folder, it starts on a
page that lists the folder's `.draft` files, makes a new one, or opens an example. An editor stops
after 2 hours with no open tab, or when its folder is deleted.

An image needs a file to save to. `draftably open a.svg` writes `a.draft` beside the image and
edits that file. If `a.draft` already holds other text, `open` stops and writes nothing. A PDF
writes its diagrams to a folder with the PDF's name and opens that folder.

| Option      | Effect                                                                      |
| ----------- | --------------------------------------------------------------------------- |
| `--port N`  | Serve on port N. The default is the first free port from 5180; 0 picks any. |
| `--no-open` | Don't open the browser. Use the URL on the `Viewer:` line.                  |
| `--replace` | Stop an editor already serving this folder and start this version.          |
| `--status`  | List the running editors: URL, folder, version and process ID.              |

Without `--port`, an editor already serving the folder is reused.

## check

```sh
draftably check architecture.draft
draftably check diagrams/ --quiet
```

Reports source errors, layout diagnostics and drawing conflicts, such as a line through a box or
overlapping labels. Exits 1 on errors. Several files or a folder check each `.draft` in turn.

| Option          | Effect                                                                                                                        |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `--hints`       | Add how far each refinement moved its target from where layout put it.                                                        |
| `--quiet`       | Leave out `info` notes.                                                                                                       |
| `--metrics`     | Measure size, aspect, crossings, bends and line length, and warn on crossings, detours, stranded nodes and an extreme aspect. |
| `--fit <shape>` | With `--metrics`, warn when the drawing is far from `wide`, `slide`, `square`, `page` or `tall`.                              |

## format

```sh
draftably format architecture.draft --write
```

Prints the formatted source. Comments and unrelated lines are kept.

| Option         | Effect                                                                |
| -------------- | --------------------------------------------------------------------- |
| `--write`      | Rewrite the file in place.                                            |
| `--drop-stale` | Also remove refinements that no longer hold, and list them on stderr. |

## inspect

```sh
draftably inspect architecture.draft                        # node and route geometry
draftably inspect architecture.draft --svg > architecture.svg
draftably inspect architecture.draft --png architecture.png --scale 2
```

Prints the canonical geometry of every node and route, or draws the diagram. SVG and PNG output
embed the source.

| Option             | Effect                                                                |
| ------------------ | --------------------------------------------------------------------- |
| `--json`           | Print the geometry on one line.                                       |
| `--hints`          | With `--json`, add the raw position of every node a refinement moved. |
| `--metrics`        | Add the measurements `vary` uses.                                     |
| `--svg`            | Print an SVG drawing.                                                 |
| `--png <out.png>`  | Save a PNG.                                                           |
| `--clipboard`      | Put a PNG and the SVG text on the clipboard. macOS only.              |
| `--scale N`        | PNG scale, 2 by default.                                              |
| `--max-width <px>` | Lower the scale so the PNG is at most this wide.                      |
| `--state <id>`     | Draw one [emphasis state](#emphasis-states).                          |
| `--states`         | Draw every state as its own aligned panel.                            |
| `--no-source`      | Don't embed the source.                                               |

## pdf

```sh
draftably pdf architecture.draft -o architecture.pdf
draftably pdf diagrams/ -o diagrams.pdf --title "System notes" --page letter
```

Saves diagrams as one vector PDF, with one diagram per page and its heading and key. A folder adds
each `.draft` in it, in name order. It stops on a file with errors.
Each file's source is attached, so `check`, `extract` and `open` can read the PDF.

| Option          | Effect                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `-o <out.pdf>`  | Where to save the PDF. You must give this. `--out` is the same.                                                                 |
| `--order <how>` | `given` by default, `name` or `title`.                                                                                          |
| `--page <size>` | `fit` by default, which makes each page the diagram's size, or `letter`, `a4`, `slide`. A fixed size scales the drawing to fit. |
| `--title "…"`   | Add a cover and contents.                                                                                                       |
| `--states`      | Add a page for each [emphasis state](#emphasis-states).                                                                         |
| `--no-source`   | Don't attach the source.                                                                                                        |

## compare

```sh
draftably compare before.draft after.draft --svg > diff.svg
```

Prints one file that holds two versions of a diagram, with `+`, `-` and `~`
[change marks](#change-marks) on the lines that differ. `--write <file>` saves it, `--svg` draws it,
and `--png <out.png>` saves an image at the `--scale` that `inspect` uses. Stderr prints the size of
the change, then any `Changes with no old version to draw`, which both panels show as they are now.
The file records the old shape, count and message order, so a Before panel draws them. An image
with panels carries the same list beside the Before label.

## vary

```sh
draftably vary architecture.draft
draftably vary architecture.draft --apply best
```

Tries other layouts for the file, measures each one, and ranks them against the file as it is.
It writes a contact sheet and one PNG per variant to `<name>.vary/`, and prints a table of
crossings, bends, size and warnings. `--apply <id>` writes a variant into the file.

| Option            | Effect                                                           |
| ----------------- | ---------------------------------------------------------------- |
| `--apply <id>`    | Write variant `id` (or `best`) from the last run, then check.    |
| `--limit N`       | Keep N variants, 4 by default, up to 12.                         |
| `--try key=a,b`   | Try exactly these values. A second `--try` makes a grid.         |
| `--grid`          | Try the main engines reading right and down.                     |
| `--fit <shape>`   | Aim for `wide`, `slide`, `square`, `page` or `tall`.             |
| `--prefer <goal>` | Break ties toward `fewer-crossings`, `compact` or `stable`.      |
| `--from <id>`     | Search around a variant of the last run.                         |
| `--scope <group>` | Vary that group's layout line instead of the root's.             |
| `--budget <time>` | Stop trying new variants after this long, such as `60s` or `2m`. |
| `--out <folder>`  | Write the images somewhere else.                                 |
| `--json`          | Print `variants.json` instead of the table.                      |

[Layout variants](#layout-variants) explains how variants are chosen and ranked.

## set, rm and mv

```sh
draftably set architecture.draft api label="Public API" color=teal
draftably rm architecture.draft query
draftably mv architecture.draft db orders_db
```

Edit a file by ID. These lines change the file from [Get started](#get-started): `query` is an
edge, so `rm` removes that line and keeps `db`. `set` changes a declaration: `label="…"` replaces its label and `color=`
with no value removes the attribute. Write `node.x`, `group.x` or `edge.x` when a bare ID is
ambiguous. `rm` removes nodes, groups or edges with their edges, refinements and state mentions;
a removed group's members move to its container. `mv` renames an ID everywhere. All three
rewrite the file through the formatter, then check it.

## migrate

```sh
draftably migrate docs/                 # print what would change
draftably migrate 'docs/**/*.md' --write
```

Rewrites `mermaid` code fences in Markdown files as `draft` fences. Only flowcharts (`flowchart`,
`graph`) and sequence diagrams (`sequenceDiagram`) convert. Pie, gantt, class and other Mermaid
charts stay as they are. A folder adds its `.md`, `.mdx` and `.markdown` files, and skips
`node_modules`. Quote a glob so the shell does not expand it.

Without `--write`, nothing changes. It prints each file's fences, what happens to each one, and
the importer's warnings. A fence with warnings, such as a Mermaid shape with no exact Draftably
match, stays Mermaid until you pass `--accept-lossy`. Exits 1 when a fence fails to import; that
fence stays Mermaid.

| Option           | Effect                                     |
| ---------------- | ------------------------------------------ |
| `--write`        | Rewrite the files.                         |
| `--accept-lossy` | Also convert the fences that had warnings. |

To convert one Mermaid, DOT or D2 file to a new `.draft` file, use
`draftably import chart.mmd --output chart.draft`.

## extract

```sh
draftably extract architecture.png --write architecture.draft
```

Prints the `.draft` source embedded in a PNG, SVG or PDF export, or saves it with `--write`. Exits 1
when the file has no source. For a PDF with several diagrams, name one:
`draftably extract diagrams.pdf#architecture.draft`.

## docs

```sh
draftably docs
draftably docs legend
draftably docs all
```

Prints the language guide for the version you have. With no topic it prints the contents. With a
topic it prints the sections whose heading matches. `all` prints the whole guide.

## skill

```sh
draftably skill install
draftably skill print
```

Installs the [agent skill](#agent-skill) into `./.claude/skills/draftably`. `--global` uses
`~/.claude/skills`, `--dir <folder>` picks another skills folder, and `--force` replaces an
existing copy. `skill print` prints its `SKILL.md`.

## Troubleshoot common problems

Use this list to troubleshoot a command that is not working.

### Node is too old

draftably needs Node 22.21 or later. npm shows an `EBADENGINE` warning on an older Node, and some
commands can still start. Run `node --version`, and update Node if it is older.

### `draftably: command not found`

The install did not finish, or its folder is not on your `PATH`.

- With pnpm, run `pnpm setup`, open a new terminal and install again.
- With npm, add `$(npm prefix --global)/bin` to your `PATH`.
- With neither, run `npx draftably` in its place.

### `No such file or folder`

`open`, `check` and `inspect` need an existing path. To create a new diagram, run
`draftably open` with no file, then select **New diagram**. Or save text as a `.draft` file before
running a command on it.

### The editor still shows an older version

`open` reuses the editor already serving the folder. To stop it and start the installed version,
run:

```sh
draftably open architecture.draft --replace
```

Use `draftably open --status` to see which folders and versions are running.

### PNG or PDF output fails

PNG and PDF output need no browser. PNG output uses resvg, and `pdf` uses PDFKit. Both use the
fonts that come with Draftably.

resvg loads a native package for your system, such as `@resvg/resvg-js-linux-x64-gnu`. The package
manager installs it as an optional dependency. If the install skipped optional dependencies,
`inspect --png`, `compare --png` and `vary` stop with `Cannot find module '@resvg/resvg-…'`.
Install again without `--no-optional` or `--omit=optional`. `inspect --svg` and `pdf` do not use
resvg.

`--clipboard works on macOS only.` means that you used `--clipboard` on another system. Use `--png`
or `--svg` to write a file.

### Port 5180 is busy

Without `--port`, `open` takes the next free port, so use the URL on the `Viewer:` line. With
`--port`, it stops with `Port 5180 is already in use.` Pick another port, or use `--port 0`.

### The editor is from an older version

`open` reuses an editor that already serves the folder. After an update it prints
`A viewer from draftably 0.7.0 serves …`. Stop that editor and start this version:

```sh
draftably open architecture.draft --replace
```

`draftably open --status` shows the version of each running editor.

### The browser does not open

`open` opens the browser on macOS only. On other systems, open the URL on the `Viewer:` line.

### An export has no source

`has no embedded draftably source` means that the file came from `--no-source` or another tool, or
that a host compressed it again. Use the `.draft` file, or export it again.
