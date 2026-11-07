---
'draftably': patch
---

`routing hops=on` now hops one line of every crossing pair, the one with the greater id, on a level run (arcing up) or an upright one (arcing right), lines that share an end included where they cross away from it. A label placed for itself keeps off the arcs; an authored `label` place is not moved.
