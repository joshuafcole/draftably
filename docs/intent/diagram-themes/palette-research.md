# Palette research: the Drafting set

Byron found the five themes "good, not great". He asked for an opinionated base look that makes a
draftably diagram easy to recognize. The textured "Pressed paper" try is off the table
([texture-research.md](texture-research.md)). This round changes color only. The goals come from
[FEEL.md](../diagram-quality/FEEL.md): color carries meaning, two to four accent families plus
neutrals, a legend gives the coloring a schema, and the frame never shouts over the content.

## What was wrong

A baseline sheet of the old five themes on four real files showed these problems:

- **The themes looked alike.** Each theme changed the canvas and two accents. The named families
  (`blue`, `amber` …) were the same everywhere, with one chroma multiplier per theme.
- **Every shade-500 fill was a heavy slab.** White text forces a dark fill, so each colored node
  shouted.
- **Amber and orange turned brown.** A warm fill dark enough for white text is rust or brown.
  Orange 500 and red 500 were nearly the same color (ΔE 0.05).
- **Pairs merged for color-blind readers.** Fieldnotes' forest and clay, Mulberry's berry and
  lilac, and the diff marks' green and amber all fell below ΔE 0.06 under deuteranopia.

## Twenty directions

The lab (`tmp/palette/lab.mjs`, not committed) drew each direction as a small diagram: four accent
roles, pale tints, a neutral node, a group, the three change marks, a focus ring, and the same card
under simulated deuteranopia and protanopia (Machado 2009, full severity). Scores are 0–10:

- **Roles:** accents that stay apart under deuteranopia (ΔE > 0.06), 2.5 points each.
- **Labels:** the lowest WCAG ratio of text on any fill; 3:1 scores 0 and 7:1 scores 10.
- **Thumb:** the smallest OKLab ΔE among accent fills and the neutral node, the distinctness at
  thumbnail size; 0.16 scores 10.
- **Marks:** the change marks apart from each other (ΔE) and from the canvas (WCAG).
- **CVD:** the smallest ΔE among accents and among marks under both simulations.
- **Quiet:** a group frame near 1.35:1 on the canvas, a group fill close to the canvas, and
  connections stronger than frames.

| #   | Direction            | Idea                                        | Roles | Labels (min) | Thumb | Marks | CVD | Quiet | Mean |
| --- | -------------------- | ------------------------------------------- | ----: | -----------: | ----: | ----: | --: | ----: | ---: |
| 1   | Graphite (old)       | dark green and ochre, generic families      |     5 |      7 (5.7) |     5 |     8 |   2 |    10 |  6.0 |
| 2   | Fieldnotes (old)     | forest and clay on cream                    |     5 |     5 (5.14) |     6 |     7 |   1 |    10 |  5.7 |
| 3   | Signal (old)         | cobalt and orange                           |    10 |      4 (4.5) |     8 |    10 |   2 |    10 |  7.2 |
| 4   | Mulberry (old)       | berry and lilac                             |    10 |     4 (4.49) |     7 |     8 |   4 |    10 |  7.2 |
| 5   | Midnight (old)       | teal and coral on teal-black                |     5 |    10 (7.83) |     5 |     9 |   1 |     8 |  6.2 |
| 6   | Drafting ink         | navy ink, drafting blue, marker orange      |    10 |     5 (4.88) |     9 |    10 |   3 |    10 |  7.8 |
| 7   | Blueprint            | blue ground, white lines, cyan and yellow   |    10 |    10 (8.34) |     7 |    10 |   8 |     6 |  8.4 |
| 8   | Pencil + highlighter | graphite nodes, one highlighter, one blue   |     8 |     5 (4.93) |    10 |     8 |   7 |    10 |  7.9 |
| 9   | Okabe–Ito            | color-blind-safe categorical set            |    10 |     5 (5.19) |    10 |     7 |   7 |    10 |  8.3 |
| 10  | Tol muted            | Paul Tol's muted scheme                     |     5 |     5 (4.87) |    10 |     9 |   5 |    10 |  7.3 |
| 11  | Nordic frost         | gray-blue ground, dusty blue, sage, apricot |    10 |     4 (4.43) |     6 |     7 |   5 |    10 |  6.8 |
| 12  | Risograph            | flat fluorescent pink, blue, yellow, green  |    10 |     4 (4.73) |    10 |     6 |   3 |    10 |  7.2 |
| 13  | Swiss red            | black, gray, one red                        |     8 |     4 (4.68) |    10 |    10 |   8 |    10 |  8.2 |
| 14  | Desert               | sand, terracotta, sage, indigo, mustard     |     5 |     4 (4.51) |    10 |     9 |   5 |    10 |  7.2 |
| 15  | Sumi + seal          | black ink tones, indigo, vermilion seal     |     8 |     6 (5.33) |    10 |    10 |   9 |    10 |  8.7 |
| 16  | Slate night          | neutral dark gray, soft bright accents      |     5 |    10 (7.32) |     7 |    10 |   0 |    10 |  6.9 |
| 17  | Solarized cream      | Solarized accents on cream                  |     5 |     4 (4.55) |     8 |     6 |   2 |    10 |  5.7 |
| 18  | Pastel cards         | pale solid fills, dark text everywhere      |     2 |   10 (10.34) |     4 |     4 |   1 |    10 |  5.3 |
| 19  | Harbor               | deep teal, coral, steel blue                |    10 |     5 (4.86) |     8 |     8 |   5 |    10 |  7.7 |
| 20  | Moss + clay          | olive, clay, slate blue, bronze             |     5 |     3 (4.35) |     5 |     9 |   2 |    10 |  5.7 |

The label column measures the lab's hand-picked swatches. The real ramps hold every fill to 4.5:1
or 7:1, so this column only shows how far a direction must bend to get there.

Codex drew a diagram comp for the eight strongest (Drafting, Blueprint, Okabe–Ito, Sumi, Swiss,
Harbor, Desert, Pencil). Two lessons came from the comps, not the numbers:

- **A loud color on the most common role shouts.** Sumi with red services and Drafting with gold
  services both looked like warning signs. A second Drafting comp with pale services, one gold
  highlight and blue entry points was the look we wanted.
- **Blueprint is the most recognizable.** It reads as "a drawing" at a glance and suits a tool
  named for drafting.

## The final set

| Theme                | Replaces | Character                                                         |
| -------------------- | -------- | ----------------------------------------------------------------- |
| `drafting` (default) | graphite | Navy ink on cool paper, drafting blue and marker gold. Compact.   |
| `fieldnotes`         | —        | Serif on warm paper, now indigo and terracotta (from Desert).     |
| `signal`             | —        | Okabe–Ito's color-blind-safe hues on white, monospace labels.     |
| `ink`                | mulberry | Sumi ink tones, indigo and a vermilion seal, generous spacing.    |
| `blueprint` (dark)   | midnight | White lines on blueprint blue, cyan and yellow, monospace titles. |

Drafting and Blueprint share the drafting blue and gold, so the default and the dark theme read
as one family. Geometry did not change: each new theme keeps its predecessor's padding and fonts,
so layouts are the same.

Changes that apply to every theme:

- **Warm families stay bright.** `amber`, `orange` and any warm theme accent keep 400 and 500 as
  bright fills with dark text. 600 and darker carry white text. Orange sits a step darker than
  amber, so the two differ in lightness as well as hue.
- **Hues moved for color blindness.** Green leans blue (155°), red leans orange (32°), and violet
  moved away from blue (305°).
- **A theme can tune families.** Signal draws `green`, `orange`, `red` and `rose` as Okabe–Ito's
  bluish green, orange, vermilion and reddish purple.
- **Change marks differ in lightness.** In light themes, added is green 500, changed is amber 500
  and removed is red 700. Each border is held to 3:1 on the canvas.
- **The focus ring meets 3:1.** The gold ring darkens until it does.

## Results

Measured on the resolved colors of each theme (old → new). ΔE is OKLab distance; under 0.04 two
colors are hard to tell apart.

| Theme                | Worst mark pair ΔE, deut / prot | Primary vs secondary ΔE, deut / prot |
| -------------------- | ------------------------------: | -----------------------------------: |
| graphite → drafting  |    0.031 / 0.041 → 0.08 / 0.117 |        0.112 / 0.105 → 0.397 / 0.329 |
| fieldnotes           |   0.026 / 0.038 → 0.089 / 0.107 |         0.066 / 0.058 → 0.196 / 0.18 |
| signal               |   0.028 / 0.032 → 0.094 / 0.139 |         0.316 / 0.312 → 0.39 / 0.307 |
| mulberry → ink       |   0.028 / 0.039 → 0.097 / 0.114 |        0.012 / 0.024 → 0.186 / 0.175 |
| midnight → blueprint |   0.035 / 0.052 → 0.065 / 0.064 |        0.081 / 0.063 → 0.357 / 0.289 |

- **Contrast.** Every built-in shade of every family in every theme meets WCAG AA: 4.5:1 at least
  (the lowest is 4.50), and 7:1 for pale shades. Node text is 11.5–17.4:1, group text 7.8–11.5:1,
  canvas text 12.5–16.5:1 and connections 7.1–10.5:1. `tests/themes.test.ts` checks these.
- **Orange vs red at 500** went from 0.05 to well apart (orange is now a bright fill).

## Left over

- Families at the same shade still rely on hue. Teal and green (ΔE 0.04–0.06), and blue and
  violet under protanopia (0.02), stay close. For meaning that must survive color blindness,
  pick one bright warm family and one dark cool family, or use Signal.
- In Blueprint, a dark group shade (900) of `amber` or `violet` reads brown or plum. Dark yellow is
  brown at any hue.
- Many-family files such as `examples/aws-vpc-network.draft` still look busy. That is authoring;
  `check` flags it as `many-colors`.

## Follow-up: member cards (November 2026)

A side-by-side test against a hand-placed drawing of the same diagram found the draftably render
harder to read. The main cause was this page's first finding, still live: a member that inherits
its group's family drew at 500, so a group of seven sources became seven dark slabs. Dark pixels
covered 21.6% of the render against 3.5% in the hand-placed drawing.

- **Inherited members are pale cards.** A node in its container's family with no shade of its own
  draws at 50 (950 in Blueprint) on the frame's tint, with the family's outline and ink. Fill sets
  it apart from the frame, not distance in shade. This only applies while the frame is a quiet
  surface shade; a member of a dark frame still steps past it.
- **A node that names a color keeps 500.** The comps above wanted "pale services, one gold
  highlight". The most common role is the inherited member, so it goes pale. A node that names a
  family is the author picking it out, which is the highlight, so it keeps the strong fill. A pale
  default there too would leave no default way to mark the one thing that matters.
- **The legend follows.** A `legend family` line with no `shade=` draws what the family's nodes
  draw: 500 when a node names the family, the card shade when all of them inherit it.

On the test diagram the change took dark area from 21.6% to about 3%, with no file edit.
