# Save, share and reopen

Where draftably keeps your work depends on where you edit it. This page tells you what you keep
when you close the tab, and how to export a diagram and open it again.

## Where your work is kept

| Where you edit              | Where the source is kept                                       | Close the tab, then come back                         | Open the bare URL                             | Use another device        | Share it                                                  |
| --------------------------- | -------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- | ------------------------- | --------------------------------------------------------- |
| The landing page demo       | Browser storage on this device: one draft for each example tab | Kept: the tab you had open comes back with your edits | Your edits come back                          | Not kept                  | Select **Open in the editor**, then download the `.draft` |
| The [Playground](/play)     | Browser storage on this device: one draft                      | Kept: your last draft opens again                     | Your last draft opens again                   | Not kept                  | Copy link, or download a file                             |
| A Copy link URL (`#s=…`)    | In the URL itself                                              | Kept in the link, as it was when you copied it        | Not kept: the source is in the link           | Kept: open the link there | Send the link                                             |
| The Editor's scratch copy   | Browser storage on this device, until you save it as a file    | Kept: your edits come back as unsaved edits           | Not kept: open the same example or link again | Not kept                  | Download the `.draft`, then send the file                 |
| `draftably open file.draft` | The `.draft` file on your disk                                 | Kept: every edit saves to the file                    | Run `draftably open` again                    | Copy or commit the file   | Send the file, or commit it to a repository               |

Some more facts about each case:

- **Landing page demo.** Each example tab keeps its own edits. When you come back, the tab you had
  open shows again. **Reset** sets a tab back to its example.
- **Playground.** The browser keeps one draft: the last diagram you changed. A new draft replaces
  it, and the landing demo does not change it. A link that you open is kept only after you type.
- **Both.** If you clear your browser data, the drafts are lost.
- **Copy link.** The link holds the full source, so no server keeps a copy. Edits after you copy
  the link are not in it. Copy the link again to include them.
- **Editor scratch copy.** "Open in the editor", an example, or a shared link in the Editor opens a
  scratch copy. **New diagram** from an example opens one too, called a draft, and leaves the
  diagram kept in this browser as it is. The bar at the top says so. When you reload or come back, the bar shows your
  unsaved edits again. The browser keeps the 10 newest scratch copies. Use **Download .draft** in
  that bar to keep your edits as a file.
- **`draftably open`.** The editor saves to disk as you work. Changes that other programs make to
  the file show in the editor at once. See [Get started](#get-started) to install the CLI.

## Export a PNG, SVG or .draft file

Each PNG and SVG file that draftably exports holds the diagram's source. Thus you can open it again
and continue to edit. A code node that reads its lines from a file with `src=` is saved with those
lines inline, so the image opens without the file.

In the Playground:

1. Select **Download**.
2. Select **SVG**, **PNG** or **.draft**.

In the Editor, select **Save and export**, the arrow at the right of the toolbar. Then select
**Export PNG…** or **Export SVG…** in the menu. With `draftably open`, **Export PDF…** is also in
the menu.

From the command line:

```sh
draftably inspect plan.draft --svg > plan.svg
draftably inspect plan.draft --png plan.png --scale 2
```

## Reopen a diagram from an image or file

1. Find a PNG, SVG or `.draft` file that draftably made.
2. Drop it on any page of this site, or paste it. On a phone, use **choose a file** on the
   [home page](/).
3. The diagram opens in the Playground. Edit it there.

A PNG or SVG from another program has no source in it. The site tells you so and opens nothing.

From the command line, `draftably open plan.svg` also opens the diagram that the image holds.
