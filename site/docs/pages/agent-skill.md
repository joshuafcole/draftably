# Agent skill

draftably ships a skill that teaches coding agents such as Claude Code, Codex and Cursor to write
`.draft` files, check them, pick a layout and hand the result to you in the editor. The agent edits
text, so its diagrams diff and review like code.

The skill also teaches an agent to [embed diagrams](#embed) in a web app: the install line,
`host.css`, the Vite setting, event props and content on nodes, so the code it writes runs on the
first try.

## Install it

Each agent reads skills from its own folder. Run one command in your project.

Claude Code reads `.claude/skills`. This is the default:

```sh
npx draftably skill install
```

Add `--global` to install it in `~/.claude/skills`, for all your projects:

```sh
npx draftably skill install --global
```

Codex and Cursor read `.agents/skills`. For another agent, use the folder that it reads:

```sh
npx draftably skill install --dir .agents/skills
```

You can also install straight from the repository:

```sh
npx skills add byronwall/draftably
```

`npx draftably skill print` prints the skill so you can read it first.

## Update it

The agent reads its installed copy, so that copy does not change when you update draftably. Run
the same command with `--force` to replace it. `draftably check` prints a note when the two
differ.

```sh
npx draftably skill install --force
```

## What the agent does with it

The skill gives the agent one loop, and each step is a CLI command:

1. **Plan the model.** List the boxes, the groups they belong to and the connections, with short
   IDs and human labels.
2. **Write the file**: declarations, then edges, then `layout` lines.
3. **Check it** with `draftably check`. Every warning names the IDs, and a conflict that a
   refinement caused names its line and a fix.
4. **Let the tool choose the layout** with `draftably vary`, which ranks layout variants on a
   contact sheet, then `vary --apply best`.
5. **Look at it** with `inspect --svg` or `--png`, and review `check --metrics`.
6. **Hand it over** with `draftably open`, so you can see it and drag things into place. Your edits
   save to the same file the agent reads.

## Ask for a diagram

Once the skill is installed, ask in plain words:

```text
Draw the checkout flow in src/checkout as a .draft file next to it, and open it for me.
```

Ask the agent to write the file, resolve check errors, inspect the drawing and print the editor's URL.
Successful compilation proves the syntax works. It does not prove that the diagram describes your code correctly.

## Give the agent a useful brief

Name the audience, the question and the source of truth. A bounded request produces a more useful diagram than “draw this repository”.

```text
Use the Draftably skill to explain how an order reaches the background worker.
Read src/checkout and src/jobs. Trace the actual calls before drawing.
The reader is a developer joining this project.
Include the entry point, queue, worker and result store. Leave out helper functions.
Label each connection with the request, event or data it carries.
Write docs/order-flow.draft. Keep names from the code and report any uncertain connection.
Run check, inspect the rendered diagram, and open the file for me.
```

Replace the paths with folders that exist in your project. Review the agent's evidence for each connection.
Use a [flow recipe](#recipes) for dependencies, lanes for ownership, or a sequence for message order.

## Review a proposed change

Give the agent both versions and the question the review should answer:

```text
Use the Draftably skill to show how this branch changes order processing.
Compare the relevant code with main. Write before.draft and after.draft.
Keep the same IDs for services that exist in both versions.
Use draftably compare to create change.draft, then check and render it.
Explain which connections changed and which details the Before panel cannot reconstruct.
Open change.draft for review.
```

The CLI comparison matches diagram IDs, not code symbols. The agent must first identify the same objects in both versions.
[Change marks](#change-marks) explains the comparison output and its limits.

## Revise without losing your edits

After you adjust the diagram in the editor, point the agent at that same file:

```text
Read the current docs/order-flow.draft before editing it.
Add the failed-job queue and the worker's failure path.
Keep existing IDs, groups and placement refinements unless the new path requires a change.
Run check and inspect the drawing. Tell me which existing objects moved and why.
```

The file holds your layout refinements as well as the model. Replacing it from memory can discard those refinements.
Use a focused update when adding one path; ask for a fresh diagram when the question itself changes.

Read [Rules](#rules) for syntax, [Layout engines](#layout-engines) for placement,
[Cells](#cells) for grids, and [Refinements](#refinements) for precise adjustments.
Run `npx draftably skill print` to inspect the installed CLI's complete agent instructions.
