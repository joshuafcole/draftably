# Agent notes

Pointers only. Read the linked doc when the task touches it.

- **Checks:** `pnpm check:fast` (about 10s) while iterating; `pnpm check` before pushing. The engine
  suites take about 20s (`pnpm test:engines` runs them side by side). Suites, browser proofs and
  failure output: [docs/CHECKS.md](docs/CHECKS.md).
- **Diagram quality audit:** rubric, corpus and round loop in
  [docs/intent/diagram-quality/RUBRIC.md](docs/intent/diagram-quality/RUBRIC.md); run it as
  [docs/CHECKS.md](docs/CHECKS.md) describes.
- **How diagrams should feel:** [docs/intent/diagram-quality/FEEL.md](docs/intent/diagram-quality/FEEL.md).
  Read it before changing layout, routing, color or viewer interaction.
- **Themes and colors:** colors and shades must never move a box; only padding and type may.
  `tests/themes.test.ts` holds every shade to its contrast target, so run it after a palette
  change. Rules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#components--the-interface); language:
  [docs/DSL.md](docs/DSL.md#themes-and-colors); browser proofs `pnpm prove:themes` and
  `pnpm prove:color-scheme` ([docs/CHECKS.md](docs/CHECKS.md)).
- **Performance:** `pnpm bench` times the CLI and viewer against the 200 ms / 1 s budgets ([docs/CHECKS.md](docs/CHECKS.md#performance)).
- **Screenshots:** `pnpm shoot <url|file.draft|file.svg> tmp/out.png`, `--sheet` for a contact
  sheet, or `--crop x,y,w,h` to zoom in. Don't write one-off Playwright or image scripts.
- **Releases:** a PR that changes `src/`, `examples/`, `docs/DSL.md` or `packages/cli/` needs a
  changeset ([docs/RELEASING.md](docs/RELEASING.md)).
- **File language:** [docs/DSL.md](docs/DSL.md). Code map: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
  Plans for in-flight work: `docs/intent/<initiative>/`.
- **Agent skill:** [skills/draftably/SKILL.md](skills/draftably/SKILL.md) teaches agents the
  language. Any change to the DSL (`src/dsl/syntax.ts` or `docs/DSL.md`) must update it in the same
  PR. `tests/skill.test.ts` fails on parser words the skill omits or examples that don't compile;
  CI's `pnpm skill:check` fails a language change without a skill edit unless a commit carries
  `Skill-unchanged: <reason>`.
- **Viewer:** `pnpm draftably open <file>` serves a file at `?file=<path>` and prints the real URL on
  its `Viewer:` line; use that URL. In the page, `window.diagramStudio`
  ([src/state/debug-api.ts](src/state/debug-api.ts)) reads file state and geometry.
  Await its `ready()` before you read or export.
- **Branches:** build stacked branches in separate worktrees. Run `pnpm install` after switching
  branches in one checkout; it can drop packages another branch needs.
