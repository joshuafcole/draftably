# Theming

A diagram has three layers of color: the drawing, the viewer's frame and controls, and the
editor's panels. The page's `color-scheme` sets all of them, with no JavaScript option. CSS
properties change the frame and the panels.

## Dark pages

The drawing and the frame follow the page's color scheme. On a dark page, a diagram whose source
is in the default theme draws dark, in that theme's dark variant, and the frame goes dark too. A
source is in the default theme with no `theme` line or with `theme drafting`, and no `theme-color`
line or color on the `theme` line.
Each element reads its own computed `color-scheme`, which it inherits from the page:

| Computed `color-scheme`     | The diagram draws                  |
| --------------------------- | ---------------------------------- |
| `normal` (nothing declared) | Light, also on a dark system       |
| `light`                     | Light                              |
| `dark`                      | Dark                               |
| `light dark`                | Dark while the system prefers dark |

A page that declares no `color-scheme` draws light. To follow the user's setting, add
`:root { color-scheme: light dark }`; to force dark, `color-scheme: dark`. A page with its own dark
mode sets both:

```css
:root {
  color-scheme: light dark; /* follow the user's setting */
}
:root.dark {
  color-scheme: dark; /* or a class your page toggles */
}
```

A change of scheme switches the drawing at once, with no new layout.

- **Keep one diagram light.** Set `color-scheme: light` on the element:
  `draft-diagram { color-scheme: light; }`. The same works on `draft-editor`.
- **Pick a look in the source.** `theme drafting` follows the page, as a source with no `theme`
  line does, also with padding or font overrides. Another named theme keeps the file's colors on
  every page: `theme blueprint` stays dark. So does a `theme-color` line, or `canvas=`, `text=` or
  `connection=` on the `theme` line. To keep one diagram light, use CSS, as above. See
  [Themes](#themes).
- **Server-rendered SVG.** Pass `colorScheme: 'auto'` so the server's SVG holds both schemes as
  `light-dark()` colors, and a dark page shows it dark before the element upgrades:
  `renderSvg(source, { target: 'inline', idPrefix, colorScheme: 'auto' })`. Without it, the SVG
  draws light. See [Render SVG](#render-svg).

## Frame colors

The viewer's frame, toolbar and outline read these properties. Each default follows the element's
computed `color-scheme`, as the drawing does: the dark default applies only where the page declares
a scheme that allows dark, and a page that declares none gets the light default. A dark page needs
none of them. Set them on the element or any ancestor to use your own
colors; your values win in both schemes.

| Property              | Light default          | Dark default       | Used for                       |
| --------------------- | ---------------------- | ------------------ | ------------------------------ |
| `--draft-bg`          | `#fff`                 | `#16191e`          | Frame, toolbar and outline     |
| `--draft-ink`         | `#1e293b`              | `#e7eaef`          | Text                           |
| `--draft-border`      | `#cbd5e1`              | `#3d4450`          | Frame and button borders       |
| `--draft-focus`       | `#2563eb`              | `#7fa4e6`          | Focus ring                     |
| `--draft-shadow`      | `rgb(15 23 42 / 0.12)` | `rgb(0 0 0 / 0.4)` | The outline's shadow on focus  |
| `--draft-warning-ink` | `#9a3412`              | `#fdba74`          | Diagnostics text               |
| `--draft-warning-bg`  | `#fff7ed`              | `#431407`          | Diagnostics on a stale drawing |

To set your own color for each scheme, use `light-dark()`:

```css
draft-diagram {
  --draft-focus: light-dark(#0f766e, #5eead4);
}
```

## The editor's panels

The editor's canvas, drawing, panels and toolbar follow the page's scheme, as `<draft-diagram>`
does. To set the panels and toolbar apart from the page, put `data-theme="dark"` or
`data-theme="light"` on the element; a framework component passes the attribute through:
`<DraftEditor data-theme="dark" />`. The panels also read their own properties, set on
`draft-editor`: [Editor colors](#editor-colors) lists them.

## A dark page, start to finish

```css
.app.dark {
  color-scheme: dark; /* the drawings, the frames and the whole editor */
  background: #020617;
  color: #e2e8f0;
}
```

```html
<main class="app dark">
  <draft-diagram source="…"></draft-diagram>
  <draft-editor source="…"></draft-editor>
</main>
```

Each framework page builds this page as a complete app: [React](#react), [Solid](#solid),
[Vue](#vue), [Svelte](#svelte) and [plain HTML](#plain-html).
