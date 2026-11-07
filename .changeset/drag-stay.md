---
'draftably': minor
---

`translateEdit` takes `drag: 'stay' | 'near'`, and a session `SessionOptions.drag`: with `stay`, a moved object is kept exactly where it was dropped, as a soft `stay`, rather than placed `near` the neighbour it was dropped by. The default stays `near`.
