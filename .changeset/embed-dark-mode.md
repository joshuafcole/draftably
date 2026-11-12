---
'draftably': minor
'@draftably/runtime': minor
'@draftably/editor': minor
---

Diagrams now follow a dark page. On a page whose `color-scheme` allows dark, `<draft-diagram>`, `mountViewer`, `<draft-editor>` and `mountEditor` draw a source in the default theme (no `theme` line, or `theme drafting`) in a dark variant of the default theme: graphite surfaces, light text and lines, and the same color families stepped for a dark page. It has the default theme's type and spacing, so every box stays in place. A change of scheme, such as a class on the page that sets `color-scheme`, switches the drawing at once. The viewer draws nothing again: its SVG holds both schemes as `light-dark()` colors. The viewer's frame defaults follow the scheme too, and so do the editor's controls (panels, menus, the zoom control) unless the element sets its own `data-theme`.

A page that declares no `color-scheme` stays light, also on a dark system, so a light-only site never shows a dark diagram. A dark-mode site opts in with one line: `color-scheme: dark` on its dark class, or this to follow the system setting:

```css
:root {
  color-scheme: light dark;
}
```

To keep a diagram light on a dark page, set its scheme:

```css
draft-diagram,
draft-editor {
  color-scheme: light;
}
```

Another theme in the source (`fieldnotes`, `signal`, `ink`, `blueprint`), a `theme-color` line, or a color on the `theme` line keeps the file's colors everywhere. The editor no longer adds a `theme drafting` line on its own. `renderSvg` still draws light by default; its new `colorScheme` option takes `'dark'`, or `'auto'` for `light-dark()` colors.
