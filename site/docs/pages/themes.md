# Themes

A `theme` line picks one of five presets. A theme changes fonts, padding and colors. The structure
stays, and boxes resize to fit, so some boxes move. Here is one file drawn in each of them.

```draft themes
group edge "Edge" color=blue
node web "Web app" in=edge
node gw "API gateway" in=edge
group core "Services" color=mint
node orders "Orders" in=core
node pay "Payments" in=core shape=pill
node db "Postgres" color=violet
edge e1 web -> gw "HTTPS"
edge e2 gw -> orders "create order"
edge e3 orders -> pay "charge" kind=async
edge e4 orders -> db "persist"
legend blue "Public entry points"
legend violet "Data stores"
```

## Pick a theme

A file with no `theme` line uses `drafting`. The sample above has no `theme` line, so a copy of it
draws in `drafting`. To pick another theme, write its line first in the file:

```text
theme fieldnotes
```

In the Editor, select **Appearance**, the palette at the right of the toolbar. Then select a theme.
The Editor writes the `theme` line for you.

| Theme        | Character                                                       |
| ------------ | --------------------------------------------------------------- |
| `drafting`   | Navy ink on cool paper, drafting blue and marker gold. Compact. |
| `fieldnotes` | Editorial: serif titles on warm paper, indigo and terracotta.   |
| `signal`     | Color-blind-safe Okabe–Ito hues on white.                       |
| `ink`        | Sumi ink tones, indigo and a vermilion seal, generous padding.  |
| `blueprint`  | Dark: white lines on blueprint blue, monospace titles.          |

A file in the default theme follows the page it is embedded in: with no `theme` line or with
`theme drafting`, also with padding and font overrides. On a dark page the viewer and the editor
draw it in a dark variant of `drafting`, with the same type and spacing. A page is dark only
when its `color-scheme` allows dark. A page that declares none stays light, also on a dark system.
A dark-mode site opts in with one line, `:root { color-scheme: light dark }` to follow the system
setting or `color-scheme: dark` on its dark class (see [Dark pages](#dark-pages)).
Another theme (`fieldnotes`, `signal`, `ink`, `blueprint`), a `theme-color` line or a color on the
`theme` line (`canvas=`, `text=`, `connection=`) keeps the file's colors on every page. To keep one
diagram light, set `color-scheme: light` on its element.

## Match a design system

The file holds the whole look, so the viewer, the CLI and every export draw it the same way. The
`theme` line takes overrides such as `padding-x=`, `radius=` and `title-font=`. A `theme-color`
line changes one shade of a built-in family or adds a family of your own, such as a brand color:

```text
theme fieldnotes padding-x=18 radius=3
theme-color brand shade=100 fill="#EAF1ED" stroke="#9AB4A4" ink="#244431"
theme-color brand shade=800 fill="#244431" stroke="#244431" ink="#FFFFFF"
node context "Context" color=brand shade=100
node focus "Main step" color=brand shade=800
```

Shades run from 50 (lightest) to 950 (darkest), and a color with no shade uses 500. Padding and
fonts change box sizes, so they can move boxes. Colors and shades never move anything.
[Themes and colors](#themes-and-colors) lists every attribute and family.
