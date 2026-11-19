# Capability bets and next steps

> **Snapshot as of 2026-10-28.** Attached notes and PDF export shipped after this research, and
> foreign-format import shipped against REC-19. [The closure record](../../initiative-history.json)
> holds the outcome and what stays open.

These are planning recommendations, not approval to implement. The [summary](summary.md) explains
the decision; [coverage](coverage.md) and its CSVs retain the comparison evidence.
Pro's full examples and proposed syntax remain in [the archived report](https://github.com/byronwall/draftably/blob/1ae738518c60e44e06f7f483ffa0e61e28a784c2/docs/intent/diagram-library-coverage/assets/pro-results/diagram-library-gaps-2026-10-27/capability-bets.md).

## Ranked bets

| Rank / ID  | Disposition | Job and first useful slice                                                                               | Main risk                                                        |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1 / BET-01 | Build       | Make comparison claims accurate. Detect omitted fields and disclose incomplete old-value rendering.      | Detection can improve while the before panel remains misleading. |
| 2 / BET-02 | Build       | Explain relationship ends and schema rows. Start with a small endpoint vocabulary and labels.            | Marker congestion and confusion between decoration and meaning.  |
| 3 / BET-03 | Build       | Explain alternate sequence outcomes. Add one flat alternative after shared notes.                        | Crossing intervals, ambiguous branches, and vertical growth.     |
| 4 / BET-04 | Build       | Keep explanations attached and portable. Start with plain notes, then measured text and bundled symbols. | CLI/browser measurement and missing exported assets.             |
| 5 / BET-05 | Explore     | Show different parts of one model. Prototype explicit inclusion and shared versus compact geometry.      | Hidden relationships can mislead readers.                        |

Pro scored job value, breadth, product fit, dependency value, and smallest-slice clarity from 1 to 5.
Its totals were 25, 24, 20, 22, and 18 respectively. These are judgments, not measurements.
Sequence depth ranks before annotations because it serves a clearer current job. Notes can still
ship first as its dependency. Reassess order if Byron prioritizes schemas or audience views.

## Stage A: trustworthy comparisons

Start with a field policy in existing comparison code. Classify each retained field and statement
as meaning, presentation, layout intent, or outside the initial comparison contract.

Relevant seams: `src/dsl/compare.ts`, `src/model/panels.ts`, `src/model/status.ts`,
`src/dsl/syntax.ts`, and CLI diagnostics in `src/cli/main.ts`.
Later old-value rendering also reaches `src/cli/svg.ts` and source projection.

Use four small proof cases: count 2→3, changed link with the same label, changed cell span,
and a moved group with a child and external edge. Add one already-detected shape change to
separate detection from old-value rendering. The before panel must show old content or disclose
the limit. Keep unchanged IDs aligned where the defined contract permits it.

Stop after a useful detection/diagnostic slice if faithful historical geometry needs a larger design.
Do not create a generic comparison framework before these cases require it.

Design question: which old values must the first release preserve, and which limits must it disclose?

## Stage B: shared expressive primitives

Add a small set of endpoint markers and measured endpoint labels through parser, model, routing,
browser drawing, SVG drawing, source translation, and comparison. Keep plain directed edges valid.
Then add plain attached notes. A note leader must not rank the causal graph as an ordinary edge.

Relevant seams: `src/dsl/syntax.ts`, `src/model/types.ts`, `src/model/routes.ts`,
`src/model/labels.ts`, `src/components/scene/EdgeView.tsx`, `src/cli/svg.ts`, and
`src/dsl/translate.ts`. Inspect actual shared measurement before choosing richer text syntax.

Prove an ER relationship and an interface relationship with the same endpoint representation.
Prove that a note follows a moved subject, survives source edit/undo/reopen, and exports correctly.
Define new fields' comparison behavior when adding them.

Design questions: when does endpoint decoration carry semantic meaning, and how does an attached
note affect layout and container size?

## Stage C: notation depth

Typed field rows should reuse cell IDs. Add name/type/key content without changing edge identity
when rows move. Cardinality and key markers describe notation; they do not validate a live database.
Use `src/dsl/cells.ts`, shared text measurement, the parser, and both render paths.

For sequences, add one flat alternative with explicit branch ranges. Require contiguous,
non-overlapping branches before adding nesting or activation intervals. Current phase membership
does not require contiguity, so it cannot silently become a fragment model.
Use the `sequenced` path in `src/dsl/compile.ts` and extend sequence/source-reference checks.

Prove reordered fields retain endpoints. Prove long types remain legible. Prove a success/failure
sequence, a self-call, a long attached note, and deletion of an interval boundary.

Design questions: should fields be generic cells with retained metadata, and should fragments
extend phases or use a separate declaration? Decide message meaning before changing `kind=async`.

## Stage D: views and assets, each as an exploration

Use a read-only projection before public view syntax. For A→B→C, hiding B must never invent A→C.
Define ancestor inclusion, hidden endpoints, note ownership, pins, and comparison membership.
Compare preserved geometry with a compact view. Those are different modes with different promises.

Coordinate external images with [rich-node PR #28](https://github.com/byronwall/draftably/pull/28).
Prove sizing, export embedding, extraction into a clean folder, and missing-asset diagnostics.
A source file recovered without its image is not a complete portable diagram.

Design questions: when can a view move shared objects, and what must an export embed to recover assets?

## All recommendation dispositions

Build means inclusion in a plan. It does not mean implementation has started.

| ID     | Decision                | Reason                                                                                           |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------ |
| BET-01 | Build                   | Protect comparison accuracy before adding more authored fields.                                  |
| BET-02 | Build                   | Improve several existing families with shared relationship and row primitives.                   |
| BET-03 | Build                   | Deepen an already useful interaction diagram.                                                    |
| BET-04 | Build                   | Keep explanations attached and reproducible in source.                                           |
| BET-05 | Explore                 | Settle model projection and geometry before committing to view syntax.                           |
| REC-06 | Explore                 | Try initial/final state markers and guards after endpoint work; avoid a full statechart promise. |
| REC-07 | Explore                 | External images need a complete asset/export contract.                                           |
| REC-08 | Explore                 | Add definitions/includes when duplication justifies their ID and editing rules.                  |
| REC-09 | Explore                 | PDF can be a narrow convenience after higher-value semantics.                                    |
| REC-10 | Build with each feature | Check keyboard access, descriptive output, and non-color meaning.                                |
| REC-11 | Defer                   | Full BPMN brings a large metamodel and interchange commitment.                                   |
| REC-12 | Defer                   | Broad UML/statechart conformance exceeds the current focused jobs.                               |
| REC-13 | Defer                   | Gantt and timing require new calendar or time semantics.                                         |
| REC-14 | Defer                   | Journey scoring, requirements traceability, and Kanban models lack a current priority job.       |
| REC-15 | Defer                   | Sankey, mathematical typesetting, and statistical charts need specialized rendering.             |
| REC-16 | Avoid                   | A framework rewrite does not close the source-language gaps.                                     |
| REC-17 | Avoid                   | Embedded scripting or arbitrary HTML would weaken deterministic measurement and round trips.     |
| REC-18 | Avoid                   | Collaboration and repository-analysis backends are outside this local diagramming task.          |
| REC-19 | Avoid as a prerequisite | Foreign-format import adds a large promise before expression improves.                           |
| REC-20 | Defer                   | Start with a small bundled symbol set before maintaining provider catalogs.                      |
| REC-21 | Defer                   | Fix concrete layout defects before adding more engines.                                          |

## Delivery evidence

Every eventual language change must update the DSL guide, agent skill, example, and changeset.
Run repository checks and relevant browser/export proofs. Check meaningful rename, reorder, delete,
undo, external edit, and reopen behavior for new constructs. Keep those checks focused on real risks.
This research PR changes documentation only.
