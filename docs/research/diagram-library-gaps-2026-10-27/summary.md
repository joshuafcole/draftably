# Draftably: gaps worth closing

> **Snapshot as of 2026-10-28.** Attached notes and PDF export shipped after this research, and
> foreign-format import shipped against REC-19. [The closure record](../../initiative-history.json)
> holds the outcome and what stays open.

Improve the depth of current diagrams before adding many new diagram families. Start with truthful
before/after comparisons. Then add relationship ends, typed field rows, attached notes, and sequence
branches. Explore structural views after their inclusion and layout rules are clear.

This recommendation comes from a comparison with 15 alternatives across 28 diagram families and
37 features. [Coverage tables](coverage.md) show all 1,040 judgments.
[Diagram evidence](diagram-types.csv) and [feature evidence](features.csv) give each reason and source.
[Next steps](next-steps.md) contain the recommended order and all dispositions.

The research used commit `2995a98eef31803fa8669a7ada5c8f8892486bb7` and primary sources checked
October 28, 2026. Codex reviewed the findings against this checkout. The baseline source files
remain unchanged. The full Pro report and detailed syntax proposals are available in
[the archived report](https://github.com/byronwall/draftably/blob/1ae738518c60e44e06f7f483ffa0e61e28a784c2/docs/intent/diagram-library-coverage/assets/pro-results/diagram-library-gaps-2026-10-27/gap-analysis.md).

## What Draftably already covers

Draftably has flow and dependency graphs, basic sequence diagrams, swim lanes, cell tables, and
byte/bit layouts. It also has change marks, aligned comparison panels, emphasis states, layout
constraints, multiple engines, and source-bearing exports. Older plans describe several of these
as future work. The parser, compiler, examples, and tests show that they have shipped.

Some useful pictures are approximations. Cell rows can show a schema, but do not model keys or
cardinality. Generic shapes can show a lifecycle, but do not provide statechart semantics.
An emphasis state changes attention; it does not remove structure from a view.
The [DSL guide](../../DSL.md) describes these boundaries.

The source/editor loop is the strongest combination to preserve. Visual edits return to readable
source, while shared measurement supports consistent CLI and browser geometry. Source embedded
in images is useful, but is also documented by PlantUML and nomnoml. It is not an exclusive feature.

## The comparison set

The set balances text languages, graph libraries, and editor toolkits. It is not a claim that these
are the world's top 15 in a single popularity ranking. Pro recorded approximate public repository
stars and official ecosystem evidence. Those observations are selection aids, not active-user counts.
Edition scope and direct evidence remain in the CSVs.

| Alternative                                                   | Reach evidence reported by Pro                                | What Draftably should learn                                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Mermaid](https://mermaid.js.org/intro/)                      | About 90.9k repository stars                                  | Broad documentation notation; concise ER and sequence semantics.                                       |
| [PlantUML](https://plantuml.com/)                             | About 13.4k stars; mature integrations                        | Deep UML, sequence, activity, deployment, and reusable libraries.                                      |
| [Graphviz](https://graphviz.org/)                             | Established engine; default in PlantUML                       | Record/table ports, endpoint markers, and explicit layout constraints.                                 |
| [D2](https://d2lang.com/tour/intro/)                          | About 25.7k stars; editor integrations                        | Closest architecture DSL reference: field rows, rich content, and composition.                         |
| [Structurizr DSL](https://docs.structurizr.com/dsl/language)  | C4 reference implementation; recently consolidated repository | One model with named views. Its visual editor saves layout JSON rather than rewriting semantic DSL.    |
| [mingrammer/diagrams](https://github.com/mingrammer/diagrams) | About 42.8k stars; cloud and generator ecosystem              | Recognizable infrastructure symbols and host-language generation.                                      |
| [nomnoml](https://nomnoml.com/)                               | About 2.8k stars; compact established DSL                     | Compartments and UML relationship vocabulary without a large language.                                 |
| [React Flow](https://reactflow.dev/)                          | About 38.8k xyflow monorepo stars, shared with Svelte Flow    | Handles, accessible interaction, and custom nodes. Layout requires integration.                        |
| [JointJS](https://docs.jointjs.com/)                          | About 5.4k stars; large demo catalog                          | Ports, routing, and diagram editor primitives. Check core versus Plus boundaries.                      |
| [GoJS](https://gojs.net/latest/learn/features)                | About 8.5k distribution-repository stars; extensive samples   | Integrated tables, ports, transactions, and editor behavior. Domain demos still need application code. |
| [bpmn-js](https://bpmn.io/toolkit/bpmn-js/walkthrough/)       | About 9.7k stars; Camunda modeler use                         | Genuine BPMN models, rules, annotations, and XML round trips.                                          |
| [Cytoscape.js](https://js.cytoscape.org/)                     | About 11.3k stars; research and product ecosystem             | Graph queries, compound graphs, and filtering. Extensions have separate maintenance and licenses.      |
| [AntV X6](https://x6.antv.antgroup.com/)                      | About 6.7k stars; active versioned docs                       | Named ports, routing, and editor modules. Domain notation remains application work.                    |
| [AntV G6](https://g6.antv.antgroup.com/)                      | About 12.4k stars; AntV ecosystem                             | Tree/mind-map layout, graph exploration, and collapse behavior.                                        |
| [yFiles](https://www.yworks.com/products/yfiles-for-html)     | Commercial SDK; named customers and extensive demos           | Strong ports, tables, folding, filtered graphs, and incremental layout APIs.                           |

These popularity observations were not independently recounted by Codex. Features were assessed
within each stated edition. A commercial base can have native support. A custom demo is not native
notation. ELK and Dagre are supporting engines, rather than two additional alternatives.

## Common features and meaningful gaps

All counts below exclude Draftably and use the selected 15 alternatives as the denominator.
Native support can be limited to one family. For example, SQL-field endpoints are not universal ports.

| Capability                        | Native among alternatives | Draftably's current limit                                                           | Value of closing it                                                |
| --------------------------------- | ------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Endpoint and arrowhead vocabulary | 13/15                     | One directed head; no general source/target marker vocabulary.                      | High: clearer associations, inheritance, composition, and schemas. |
| Images                            | 12/15                     | Browser model supports images; `.draft` excludes them.                              | Useful, but requires portable assets and shared sizing.            |
| Reuse/includes/definitions        | 12/15                     | No include or definition syntax. Host-language reuse inflates this mixed-set count. | Explore after a concrete duplication problem.                      |
| Automatic layout                  | 11/15                     | Already native, with ten source engine choices.                                     | Improve failures before adding engines.                            |
| Named or field-specific ports     | 9/15                      | Side hints and cell endpoints, without declared semantic ports.                     | High for interfaces; cell IDs already solve some schema jobs.      |
| Attached notes                    | 5/15, plus one extension  | Text nodes approximate notes but have no attachment contract.                       | High across architecture, flow, and sequence diagrams.             |
| Advanced ER notation              | 3/15                      | Names/types are text; keys and multiplicity are prose.                              | High for an existing schema drawing job.                           |
| Advanced sequence notation        | 2/15                      | Phase bands are not alternatives, loops, or activation intervals.                   | High for an existing interaction drawing job.                      |

Generic directed graphs are native in most alternatives. Class diagrams are native in four, ER
diagrams in three, and basic sequences in three. Many editor toolkits can implement these families,
but need custom domain code. The smaller native counts do not make ER or sequence depth unimportant.
They show where dedicated text languages supply meaning that a canvas alone does not provide.

Draftably lacks dedicated timelines, Gantt schedules, timing waveforms, and weighted Sankey layouts.
Those gaps add new time or quantitative semantics. They have less direct value for the current
software explanation and review job than stronger relationships and annotations.

Full BPMN is native in one selected specialist, with another extension offering. Swim lanes and
decision diamonds do not imply BPMN XML, modeling rules, or execution. Do not treat full BPMN as a
small parity feature.

No selected base established native aligned semantic before/after panels under this research's
definition: 14 needed custom work, and one remained unknown. This supports investment in Draftably's
review workflow. It does not prove that no other application offers comparable views.

## The most important verified defect

`objectKey` in [compare.ts](../../../src/dsl/compare.ts) compares labels, parents, colors, shades,
and shapes. It omits `count`, `href`, `span`, `frame`, and other fields. `edgeKey` also covers only
part of the model. Codex reproduced a count-only change from 2 to 3 with the real CLI:

```text
No changes.
...
node worker "Worker" count=3
```

The merged file retains the new count without marking the change. The old count is also lost.
Adding equality fields would improve detection, but would not restore the old values in a before panel.
[panelDoc](../../../src/model/panels.ts) restores old labels through `was`; it does not restore
arbitrary old fields. Moved groups are explicitly warned about because both panels use the new parent.

This is why comparison fidelity ranks first. It protects an existing strength and prevents every
new metadata field from adding another comparison blind spot. The first useful release can detect
unsupported differences and explain them, before complete historical rendering is designed.

## Recommended direction and limits

Build comparison fidelity, relationship ends and typed field rows, bounded sequence depth, and
portable notes/symbols. Prototype named structural views. Ranking and delivery order differ:
a shared note primitive can ship before sequence fragments.

Codex accepts these as planning directions. It does not accept every proposed syntax sketch as a
finished design. Use direct retained fields and existing modules first. A new comparison layer or
versioned payload needs proof; it is not an automatic prerequisite. Do not add compatibility machinery
for multiple deployed versions. If `kind=async` changes meaning, make that a separate product decision.

Primary-source spot checks confirmed [ER keys and notation](https://mermaid.js.org/syntax/entityRelationshipDiagram.html),
[sequence fragments and notes](https://mermaid.js.org/syntax/sequenceDiagram.html),
[D2 typed rows and engine-specific attachment](https://d2lang.com/tour/sql-tables/), and
[Structurizr filtered views](https://docs.structurizr.com/dsl/cookbook/filtered-view/).
D2's [TALA announcement](https://d2lang.com/blog/tala-is-open-source/) confirms its September 2026
open-source change. Older paid-engine assumptions would misstate the comparison.

The research did not benchmark competitor rendering quality, latency, or accessibility conformance.
Counts are reviewed source/documentation judgments, not 1,040 executed product tests.
PR [#28](https://github.com/byronwall/draftably/pull/28) is an open rich-node planning PR,
not proof that its image features have shipped. Coordinate that plan before starting overlapping work.

## Preserved Pro result materials

[Complete original Pro artifacts (archived)](https://github.com/byronwall/draftably/blob/1ae738518c60e44e06f7f483ffa0e61e28a784c2/docs/intent/diagram-library-coverage/assets/pro-results/diagram-library-gaps-2026-10-27/ASSET_INDEX.md) are archived at revision 1ae73851. ZIP containers remain local.
