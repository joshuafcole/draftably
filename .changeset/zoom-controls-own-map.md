---
'draftably': patch
---

A click inside a canvas, with no press or focus before it (assistive tech, a host's script), makes that canvas's session the active one, so the zoom controls' Fit acts on the map it was pressed on. Before, with none active it threw "No diagram session is active", and with another map's active it fitted that one.
