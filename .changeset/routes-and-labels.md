---
'draftably': minor
---

Routes, labels, hops and leaders. `route id via=x1,y1;x2,y2` keeps an edge's bends, relative to the content area of the container holding both its ends; it is soft by default and gives way (`check`: `route-gave-way`) when a point lands in a box or the router finds no way through, and `strength=required` holds it. `label id at=0.4 offset=12` keeps a label a fraction along its line and a distance off it. The editor writes both: adding, dragging or removing a bend writes the `route` line (a new bend goes between the bends either side of it), and dragging a selected line's label (or any with Alt) writes the `label` line. A label more than half its height off its line takes a dotted leader back to it (`label-detached` says so). `routing hops=on` draws an arc where a level line passes over an upright one it shares no end with, in the viewer and in exported SVG; routes are unchanged.
