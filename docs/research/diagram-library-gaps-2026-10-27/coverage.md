# Coverage across 15 alternatives

This is a reviewed projection of the Pro research, checked October 28, 2026.
The baseline is `2995a98eef31803fa8669a7ada5c8f8892486bb7`.
See [the decision](summary.md), [next steps](next-steps.md), and
[the archived reports](https://github.com/byronwall/draftably/blob/1ae738518c60e44e06f7f483ffa0e61e28a784c2/docs/intent/diagram-library-coverage/assets/pro-results/diagram-library-gaps-2026-10-27/ASSET_INDEX.md).

N = native; P = partial or ordinary approximation; C = custom application work;
E = named extension or separate edition; U = unavailable in the evaluated scope;
? = insufficient evidence. Paid does not mean non-native. Native does not mean standards conformance.

Counts exclude Draftably. The denominator is 15 alternatives, including six text languages.
A toolkit demo does not establish native notation. A label can approximate a meaning without validating it.
These counts describe this comparison set. They do not measure demand or market share.

The two CSV companions retain each judgment, its reason, edition scope, direct evidence URLs, and date.
They remove repeated research bookkeeping from the original downloads.

Compound rows bundle related features. A P can mean only one part of the bundle exists.
For example, Draftably has sequence phases but lacks fragments and activation intervals.

## Diagram families

28 rows × 16 tools = 448 judgments.

[Reasons and sources for every cell](diagram-types.csv).

### Text languages

| Capability                               | Draftably | Mermaid | PlantUML | Graphviz | D2  | Structurizr DSL | nomnoml |
| ---------------------------------------- | --------- | ------- | -------- | -------- | --- | --------------- | ------- |
| Flowcharts / generic directed processes  | N         | N       | N        | N        | N   | P               | N       |
| UML activity notation                    | P         | P       | N        | P        | P   | U               | P       |
| Sequence: participants, ordered messages | N         | N       | N        | C        | N   | P               | U       |
| Sequence: fragments, activation, notes   | P         | N       | N        | C        | P   | P               | U       |
| State machines / statecharts             | P         | N       | N        | P        | P   | U               | P       |
| Class / object UML                       | P         | N       | N        | P        | N   | U               | N       |
| ER / schema diagrams                     | P         | N       | N        | P        | N   | U               | P       |
| ER: keys, typed fields, cardinality      | P         | N       | N        | P        | N   | U               | P       |
| Software architecture                    | P         | N       | N        | P        | P   | N               | P       |
| C4 model and views                       | P         | P       | P        | P        | P   | N               | P       |
| Cloud / network architecture             | P         | N       | N        | P        | P   | N               | P       |
| Swim lanes                               | N         | N       | N        | P        | P   | U               | P       |
| BPMN 2.0 notation and model              | P         | P       | P        | C        | C   | U               | U       |
| Trees / hierarchies                      | N         | N       | N        | N        | P   | P               | P       |
| Mind maps                                | P         | N       | N        | P        | P   | U               | P       |
| Chronological timelines                  | U         | N       | P        | C        | P   | U               | U       |
| Gantt / project schedules                | U         | N       | N        | C        | C   | U               | U       |
| User journeys                            | P         | N       | P        | C        | P   | U               | P       |
| Requirements diagrams                    | P         | N       | P        | P        | P   | U               | P       |
| Packet / bit-field diagrams              | N         | N       | N        | C        | C   | U               | U       |
| Byte / file-layout diagrams              | N         | P       | P        | C        | C   | U               | U       |
| UML component / deployment               | P         | P       | N        | P        | P   | P               | P       |
| Dependency / relationship graphs         | N         | N       | N        | N        | N   | N               | N       |
| Timing / waveform diagrams               | U         | U       | N        | C        | C   | U               | U       |
| Git / branching history                  | P         | N       | ?        | P        | P   | U               | P       |
| Sankey / weighted-flow diagrams          | U         | N       | ?        | C        | C   | U               | U       |
| Kanban boards                            | P         | N       | ?        | P        | P   | U               | P       |
| Wireframes / UI mockups                  | P         | P       | N        | P        | P   | U               | P       |

### Graph and diagram libraries

| Capability                               | Draftably | mingrammer/diagrams | Cytoscape.js | AntV G6 |
| ---------------------------------------- | --------- | ------------------- | ------------ | ------- |
| Flowcharts / generic directed processes  | N         | P                   | N            | N       |
| UML activity notation                    | P         | P                   | P            | P       |
| Sequence: participants, ordered messages | N         | C                   | C            | C       |
| Sequence: fragments, activation, notes   | P         | C                   | C            | C       |
| State machines / statecharts             | P         | P                   | P            | P       |
| Class / object UML                       | P         | C                   | C            | C       |
| ER / schema diagrams                     | P         | C                   | C            | C       |
| ER: keys, typed fields, cardinality      | P         | C                   | C            | C       |
| Software architecture                    | P         | N                   | P            | P       |
| C4 model and views                       | P         | P                   | P            | P       |
| Cloud / network architecture             | P         | N                   | P            | P       |
| Swim lanes                               | N         | P                   | C            | C       |
| BPMN 2.0 notation and model              | P         | C                   | C            | C       |
| Trees / hierarchies                      | N         | P                   | N            | N       |
| Mind maps                                | P         | C                   | C            | N       |
| Chronological timelines                  | U         | C                   | C            | P       |
| Gantt / project schedules                | U         | C                   | C            | C       |
| User journeys                            | P         | P                   | P            | P       |
| Requirements diagrams                    | P         | P                   | P            | P       |
| Packet / bit-field diagrams              | N         | C                   | C            | C       |
| Byte / file-layout diagrams              | N         | C                   | C            | C       |
| UML component / deployment               | P         | P                   | P            | P       |
| Dependency / relationship graphs         | N         | N                   | N            | N       |
| Timing / waveform diagrams               | U         | C                   | C            | C       |
| Git / branching history                  | P         | P                   | P            | P       |
| Sankey / weighted-flow diagrams          | U         | C                   | C            | C       |
| Kanban boards                            | P         | P                   | P            | P       |
| Wireframes / UI mockups                  | P         | P                   | P            | P       |

### Editor and modeling libraries

| Capability                               | Draftably | React Flow (xyflow) | JointJS | GoJS | bpmn-js | AntV X6 | yFiles |
| ---------------------------------------- | --------- | ------------------- | ------- | ---- | ------- | ------- | ------ |
| Flowcharts / generic directed processes  | N         | P                   | N       | N    | P       | N       | N      |
| UML activity notation                    | P         | P                   | P       | P    | P       | P       | P      |
| Sequence: participants, ordered messages | N         | C                   | C       | C    | U       | C       | C      |
| Sequence: fragments, activation, notes   | P         | C                   | C       | C    | U       | C       | C      |
| State machines / statecharts             | P         | P                   | P       | P    | U       | P       | P      |
| Class / object UML                       | P         | C                   | C       | P    | U       | C       | P      |
| ER / schema diagrams                     | P         | C                   | C       | P    | U       | C       | P      |
| ER: keys, typed fields, cardinality      | P         | C                   | C       | P    | U       | C       | P      |
| Software architecture                    | P         | P                   | P       | P    | U       | P       | P      |
| C4 model and views                       | P         | P                   | P       | P    | U       | P       | P      |
| Cloud / network architecture             | P         | P                   | P       | P    | U       | P       | P      |
| Swim lanes                               | N         | C                   | E       | C    | N       | C       | P      |
| BPMN 2.0 notation and model              | P         | C                   | E       | C    | N       | C       | P      |
| Trees / hierarchies                      | N         | C                   | E       | N    | U       | C       | N      |
| Mind maps                                | P         | C                   | C       | C    | U       | C       | C      |
| Chronological timelines                  | U         | C                   | C       | C    | U       | C       | C      |
| Gantt / project schedules                | U         | C                   | C       | C    | U       | C       | C      |
| User journeys                            | P         | P                   | P       | P    | U       | P       | P      |
| Requirements diagrams                    | P         | P                   | P       | P    | U       | P       | P      |
| Packet / bit-field diagrams              | N         | C                   | C       | C    | U       | C       | C      |
| Byte / file-layout diagrams              | N         | C                   | C       | C    | U       | C       | C      |
| UML component / deployment               | P         | P                   | P       | P    | U       | P       | P      |
| Dependency / relationship graphs         | N         | N                   | N       | N    | U       | N       | N      |
| Timing / waveform diagrams               | U         | C                   | C       | C    | U       | C       | C      |
| Git / branching history                  | P         | P                   | P       | P    | U       | P       | P      |
| Sankey / weighted-flow diagrams          | U         | C                   | C       | C    | U       | C       | C      |
| Kanban boards                            | P         | P                   | P       | P    | U       | P       | P      |
| Wireframes / UI mockups                  | P         | P                   | P       | P    | U       | P       | P      |

### Commonality

| Capability                               | Draftably | N   | P   | C   | E   | U   | ?   |
| ---------------------------------------- | --------- | --- | --- | --- | --- | --- | --- |
| Flowcharts / generic directed processes  | N         | 11  | 4   | 0   | 0   | 0   | 0   |
| UML activity notation                    | P         | 1   | 13  | 0   | 0   | 1   | 0   |
| Sequence: participants, ordered messages | N         | 3   | 1   | 9   | 0   | 2   | 0   |
| Sequence: fragments, activation, notes   | P         | 2   | 2   | 9   | 0   | 2   | 0   |
| State machines / statecharts             | P         | 2   | 11  | 0   | 0   | 2   | 0   |
| Class / object UML                       | P         | 4   | 3   | 6   | 0   | 2   | 0   |
| ER / schema diagrams                     | P         | 3   | 4   | 6   | 0   | 2   | 0   |
| ER: keys, typed fields, cardinality      | P         | 3   | 4   | 6   | 0   | 2   | 0   |
| Software architecture                    | P         | 4   | 10  | 0   | 0   | 1   | 0   |
| C4 model and views                       | P         | 1   | 13  | 0   | 0   | 1   | 0   |
| Cloud / network architecture             | P         | 4   | 10  | 0   | 0   | 1   | 0   |
| Swim lanes                               | N         | 3   | 5   | 5   | 1   | 1   | 0   |
| BPMN 2.0 notation and model              | P         | 1   | 3   | 8   | 1   | 2   | 0   |
| Trees / hierarchies                      | N         | 7   | 4   | 2   | 1   | 1   | 0   |
| Mind maps                                | P         | 3   | 3   | 7   | 0   | 2   | 0   |
| Chronological timelines                  | U         | 1   | 3   | 8   | 0   | 3   | 0   |
| Gantt / project schedules                | U         | 2   | 0   | 10  | 0   | 3   | 0   |
| User journeys                            | P         | 1   | 11  | 1   | 0   | 2   | 0   |
| Requirements diagrams                    | P         | 1   | 12  | 0   | 0   | 2   | 0   |
| Packet / bit-field diagrams              | N         | 2   | 0   | 10  | 0   | 3   | 0   |
| Byte / file-layout diagrams              | N         | 0   | 2   | 10  | 0   | 3   | 0   |
| UML component / deployment               | P         | 1   | 13  | 0   | 0   | 1   | 0   |
| Dependency / relationship graphs         | N         | 14  | 0   | 0   | 0   | 1   | 0   |
| Timing / waveform diagrams               | U         | 1   | 0   | 10  | 0   | 4   | 0   |
| Git / branching history                  | P         | 1   | 11  | 0   | 0   | 2   | 1   |
| Sankey / weighted-flow diagrams          | U         | 1   | 0   | 10  | 0   | 3   | 1   |
| Kanban boards                            | P         | 1   | 11  | 0   | 0   | 2   | 1   |
| Wireframes / UI mockups                  | P         | 1   | 12  | 0   | 0   | 2   | 0   |

## Features

37 rows × 16 tools = 592 judgments.

[Reasons and sources for every cell](features.csv).

### Text languages

| Capability                                  | Draftably | Mermaid | PlantUML | Graphviz | D2  | Structurizr DSL | nomnoml |
| ------------------------------------------- | --------- | ------- | -------- | -------- | --- | --------------- | ------- |
| Dedicated diagram text DSL                  | N         | N       | N        | N        | N   | N               | N       |
| Built-in shape vocabulary                   | N         | N       | N        | N        | N   | N               | N       |
| Icon assets / catalogs                      | U         | N       | N        | P        | N   | N               | U       |
| Images in diagrams                          | U         | N       | N        | N        | N   | N               | U       |
| Rich / formatted labels                     | P         | N       | N        | N        | N   | P               | P       |
| Attached notes / annotations                | P         | N       | N        | P        | N   | P               | N       |
| Mathematical label notation                 | U         | P       | N        | C        | N   | U               | U       |
| Arrowhead / endpoint vocabulary             | P         | N       | N        | N        | N   | P               | N       |
| Relationship multiplicity / cardinality     | P         | N       | N        | P        | N   | P               | P       |
| Named / semantic connection ports           | P         | P       | N        | N        | N   | U               | U       |
| Nested containers / groups                  | N         | N       | N        | N        | N   | N               | N       |
| Cell / compartment structures               | N         | N       | N        | N        | N   | U               | N       |
| Automatic layout                            | N         | N       | N        | N        | N   | N               | N       |
| Obstacle-aware / orthogonal routing         | N         | P       | P        | P        | N   | P               | P       |
| Layout constraints / placement hints        | N         | P       | N        | N        | N   | P               | P       |
| Incremental / position-preserving layout    | P         | ?       | ?        | P        | P   | P               | ?       |
| Themes / reusable styling                   | N         | N       | N        | P        | N   | N               | N       |
| Named views / filtering                     | P         | P       | P        | N        | N   | N               | C       |
| Expand / collapse                           | P         | N       | P        | C        | P   | ?               | C       |
| Change marks with semantic status           | N         | P       | P        | P        | P   | P               | P       |
| Aligned before / after semantic panels      | N         | C       | C        | C        | C   | ?               | C       |
| Compare layout / routing candidates         | N         | C       | C        | C        | C   | ?               | C       |
| SVG export                                  | N         | N       | N        | N        | N   | N               | N       |
| PNG export                                  | N         | N       | N        | N        | N   | N               | N       |
| PDF export                                  | U         | N       | N        | N        | N   | ?               | C       |
| Source embedded in exported image           | N         | ?       | N        | ?        | ?   | ?               | N       |
| Structured import / export                  | P         | P       | P        | N        | P   | N               | P       |
| Reuse / includes / definitions              | U         | P       | N        | P        | N   | N               | N       |
| Data-driven programmatic generation         | C         | C       | N        | N        | N   | N               | C       |
| Syntax / structural validation              | N         | N       | N        | N        | N   | N               | N       |
| Domain semantics / constraints              | P         | P       | P        | U        | P   | N               | P       |
| Document / keyboard / screen-reader support | P         | P       | P        | P        | ?   | P               | ?       |
| Visual edits round-trip to canonical source | N         | C       | U        | C        | C   | P               | U       |
| Local CLI / automation                      | N         | N       | N        | N        | N   | N               | N       |
| Local / offline operation                   | N         | N       | N        | N        | N   | N               | N       |
| Interactive editor primitives               | N         | P       | P        | P        | P   | P               | C       |
| Undo / redo                                 | N         | C       | C        | C        | C   | ?               | C       |

### Graph and diagram libraries

| Capability                                  | Draftably | mingrammer/diagrams | Cytoscape.js | AntV G6 |
| ------------------------------------------- | --------- | ------------------- | ------------ | ------- |
| Dedicated diagram text DSL                  | N         | P                   | U            | U       |
| Built-in shape vocabulary                   | N         | P                   | N            | N       |
| Icon assets / catalogs                      | U         | N                   | P            | P       |
| Images in diagrams                          | U         | N                   | N            | N       |
| Rich / formatted labels                     | P         | P                   | P            | P       |
| Attached notes / annotations                | P         | P                   | P            | P       |
| Mathematical label notation                 | U         | C                   | C            | C       |
| Arrowhead / endpoint vocabulary             | P         | P                   | N            | N       |
| Relationship multiplicity / cardinality     | P         | P                   | P            | P       |
| Named / semantic connection ports           | P         | P                   | P            | N       |
| Nested containers / groups                  | N         | N                   | N            | N       |
| Cell / compartment structures               | N         | C                   | C            | C       |
| Automatic layout                            | N         | N                   | N            | N       |
| Obstacle-aware / orthogonal routing         | N         | P                   | P            | N       |
| Layout constraints / placement hints        | N         | P                   | P            | P       |
| Incremental / position-preserving layout    | P         | C                   | P            | P       |
| Themes / reusable styling                   | N         | N                   | N            | N       |
| Named views / filtering                     | P         | C                   | N            | P       |
| Expand / collapse                           | P         | U                   | E            | N       |
| Change marks with semantic status           | N         | P                   | P            | P       |
| Aligned before / after semantic panels      | N         | C                   | C            | C       |
| Compare layout / routing candidates         | N         | C                   | C            | C       |
| SVG export                                  | N         | N                   | E            | E       |
| PNG export                                  | N         | N                   | N            | N       |
| PDF export                                  | U         | N                   | C            | C       |
| Source embedded in exported image           | N         | ?                   | ?            | ?       |
| Structured import / export                  | P         | P                   | N            | N       |
| Reuse / includes / definitions              | U         | N                   | N            | N       |
| Data-driven programmatic generation         | C         | N                   | N            | N       |
| Syntax / structural validation              | N         | P                   | P            | P       |
| Domain semantics / constraints              | P         | C                   | C            | C       |
| Document / keyboard / screen-reader support | P         | ?                   | ?            | ?       |
| Visual edits round-trip to canonical source | N         | U                   | P            | P       |
| Local CLI / automation                      | N         | N                   | E            | C       |
| Local / offline operation                   | N         | N                   | N            | N       |
| Interactive editor primitives               | N         | U                   | P            | N       |
| Undo / redo                                 | N         | P                   | E            | N       |

### Editor and modeling libraries

| Capability                                  | Draftably | React Flow (xyflow) | JointJS | GoJS | bpmn-js | AntV X6 | yFiles |
| ------------------------------------------- | --------- | ------------------- | ------- | ---- | ------- | ------- | ------ |
| Dedicated diagram text DSL                  | N         | U                   | U       | U    | U       | U       | U      |
| Built-in shape vocabulary                   | N         | P                   | N       | N    | N       | N       | N      |
| Icon assets / catalogs                      | U         | C                   | P       | P    | P       | P       | P      |
| Images in diagrams                          | U         | C                   | N       | N    | C       | N       | N      |
| Rich / formatted labels                     | P         | P                   | N       | P    | P       | P       | N      |
| Attached notes / annotations                | P         | P                   | E       | P    | N       | P       | P      |
| Mathematical label notation                 | U         | C                   | C       | C    | C       | C       | C      |
| Arrowhead / endpoint vocabulary             | P         | N                   | N       | N    | N       | N       | N      |
| Relationship multiplicity / cardinality     | P         | P                   | P       | P    | P       | P       | P      |
| Named / semantic connection ports           | P         | N                   | N       | N    | P       | N       | N      |
| Nested containers / groups                  | N         | N                   | N       | N    | N       | N       | N      |
| Cell / compartment structures               | N         | C                   | E       | N    | U       | C       | N      |
| Automatic layout                            | N         | C                   | E       | N    | E       | C       | N      |
| Obstacle-aware / orthogonal routing         | N         | C                   | N       | N    | P       | N       | N      |
| Layout constraints / placement hints        | N         | P                   | P       | P    | P       | P       | N      |
| Incremental / position-preserving layout    | P         | P                   | P       | P    | P       | P       | N      |
| Themes / reusable styling                   | N         | N                   | P       | N    | N       | P       | P      |
| Named views / filtering                     | P         | P                   | P       | P    | P       | P       | N      |
| Expand / collapse                           | P         | E                   | C       | N    | N       | C       | N      |
| Change marks with semantic status           | N         | P                   | P       | P    | E       | P       | P      |
| Aligned before / after semantic panels      | N         | C                   | C       | C    | C       | C       | C      |
| Compare layout / routing candidates         | N         | C                   | C       | C    | C       | C       | C      |
| SVG export                                  | N         | C                   | E       | N    | N       | N       | N      |
| PNG export                                  | N         | C                   | E       | N    | C       | N       | C      |
| PDF export                                  | U         | C                   | E       | C    | C       | C       | C      |
| Source embedded in exported image           | N         | C                   | C       | C    | ?       | ?       | ?      |
| Structured import / export                  | P         | N                   | N       | N    | N       | N       | N      |
| Reuse / includes / definitions              | U         | N                   | N       | N    | P       | N       | N      |
| Data-driven programmatic generation         | C         | N                   | N       | N    | N       | N       | N      |
| Syntax / structural validation              | N         | P                   | P       | N    | N       | P       | P      |
| Domain semantics / constraints              | P         | C                   | C       | C    | N       | C       | C      |
| Document / keyboard / screen-reader support | P         | N                   | C       | N    | P       | P       | P      |
| Visual edits round-trip to canonical source | N         | P                   | P       | P    | N       | P       | P      |
| Local CLI / automation                      | N         | C                   | C       | C    | E       | C       | C      |
| Local / offline operation                   | N         | N                   | N       | N    | N       | N       | N      |
| Interactive editor primitives               | N         | N                   | N       | N    | N       | N       | N      |
| Undo / redo                                 | N         | E                   | E       | N    | N       | N       | N      |

### Commonality

| Capability                                  | Draftably | N   | P   | C   | E   | U   | ?   |
| ------------------------------------------- | --------- | --- | --- | --- | --- | --- | --- |
| Dedicated diagram text DSL                  | N         | 6   | 1   | 0   | 0   | 8   | 0   |
| Built-in shape vocabulary                   | N         | 13  | 2   | 0   | 0   | 0   | 0   |
| Icon assets / catalogs                      | U         | 5   | 8   | 1   | 0   | 1   | 0   |
| Images in diagrams                          | U         | 12  | 0   | 2   | 0   | 1   | 0   |
| Rich / formatted labels                     | P         | 6   | 9   | 0   | 0   | 0   | 0   |
| Attached notes / annotations                | P         | 5   | 9   | 0   | 1   | 0   | 0   |
| Mathematical label notation                 | U         | 2   | 1   | 10  | 0   | 2   | 0   |
| Arrowhead / endpoint vocabulary             | P         | 13  | 2   | 0   | 0   | 0   | 0   |
| Relationship multiplicity / cardinality     | P         | 3   | 12  | 0   | 0   | 0   | 0   |
| Named / semantic connection ports           | P         | 9   | 4   | 0   | 0   | 2   | 0   |
| Nested containers / groups                  | N         | 15  | 0   | 0   | 0   | 0   | 0   |
| Cell / compartment structures               | N         | 7   | 0   | 5   | 1   | 2   | 0   |
| Automatic layout                            | N         | 11  | 0   | 2   | 2   | 0   | 0   |
| Obstacle-aware / orthogonal routing         | N         | 6   | 8   | 1   | 0   | 0   | 0   |
| Layout constraints / placement hints        | N         | 4   | 11  | 0   | 0   | 0   | 0   |
| Incremental / position-preserving layout    | P         | 1   | 10  | 1   | 0   | 0   | 3   |
| Themes / reusable styling                   | N         | 11  | 4   | 0   | 0   | 0   | 0   |
| Named views / filtering                     | P         | 5   | 8   | 2   | 0   | 0   | 0   |
| Expand / collapse                           | P         | 5   | 2   | 4   | 2   | 1   | 1   |
| Change marks with semantic status           | N         | 0   | 14  | 0   | 1   | 0   | 0   |
| Aligned before / after semantic panels      | N         | 0   | 0   | 14  | 0   | 0   | 1   |
| Compare layout / routing candidates         | N         | 0   | 0   | 14  | 0   | 0   | 1   |
| SVG export                                  | N         | 11  | 0   | 1   | 3   | 0   | 0   |
| PNG export                                  | N         | 11  | 0   | 3   | 1   | 0   | 0   |
| PDF export                                  | U         | 5   | 0   | 8   | 1   | 0   | 1   |
| Source embedded in exported image           | N         | 2   | 0   | 3   | 0   | 0   | 10  |
| Structured import / export                  | P         | 10  | 5   | 0   | 0   | 0   | 0   |
| Reuse / includes / definitions              | U         | 12  | 3   | 0   | 0   | 0   | 0   |
| Data-driven programmatic generation         | C         | 13  | 0   | 2   | 0   | 0   | 0   |
| Syntax / structural validation              | N         | 8   | 7   | 0   | 0   | 0   | 0   |
| Domain semantics / constraints              | P         | 2   | 4   | 8   | 0   | 1   | 0   |
| Document / keyboard / screen-reader support | P         | 2   | 7   | 1   | 0   | 0   | 5   |
| Visual edits round-trip to canonical source | N         | 1   | 8   | 3   | 0   | 3   | 0   |
| Local CLI / automation                      | N         | 7   | 0   | 6   | 2   | 0   | 0   |
| Local / offline operation                   | N         | 15  | 0   | 0   | 0   | 0   | 0   |
| Interactive editor primitives               | N         | 7   | 6   | 1   | 0   | 1   | 0   |
| Undo / redo                                 | N         | 5   | 1   | 5   | 3   | 0   | 1   |

## Interpretation limits

- The set contains popular and influential tools, rather than a claimed global top-15 ranking.
- Text DSLs and application toolkits answer different jobs. Read their scope before comparing totals.
- A source-portability judgment uses `.draft` mode for Draftably, rather than its broader standalone editor.
- Named SQL-field endpoints count as ports within that family. They do not imply general declared ports.
- Shape-based BPMN approximations do not imply a BPMN metamodel, XML exchange, or execution.
- Source-bearing images are confirmed for PlantUML and nomnoml. Unknowns prevent an exclusivity claim.
- Third-party extensions have separate licenses. In particular, the researched Cytoscape SVG extension is GPL-3.0.
- These are documentation and source assessments. Competitor renderers were not benchmarked.
- Codex checked the main Draftably claims and selected primary sources. It did not execute 1,040 independent trials.
