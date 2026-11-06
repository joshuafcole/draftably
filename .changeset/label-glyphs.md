---
'draftably': minor
---

`check` tests an edge label by its text rather than its box. `label-collision` now means a word cannot be read: a box is drawn over the label's text (lines and labels are drawn before boxes), the label's box covers a group's title or another label's text, or another line runs through the text. A label whose padding alone touches a box or another label is the new, milder `label-crowded`.
