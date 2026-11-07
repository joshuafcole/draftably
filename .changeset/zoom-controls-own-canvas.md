---
'draftably': patch
'@draftably/editor': patch
---

A click activates its canvas even without a pointerdown or focusin before it, so with two editors on a page, Enter on one editor's focused Fit button no longer fits the other.
