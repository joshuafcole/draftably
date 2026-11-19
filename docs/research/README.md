# Research

## Embedding and distribution

The embedding study proposes a native runtime, Markdown adapters, and an optional independent viewer.
It distinguishes custom build integrations from native support on hosted platforms.

[Summary](embedding-ecosystem-2026-11-03/summary.md) ·
[Plan and original Pro assets (archived)](https://github.com/byronwall/draftably/tree/525e8807e1f05a528a973757714bf0584d94594a/docs/intent/embedding-ecosystem) ·
[Run record](embedding-ecosystem-2026-11-03/run.md)

Status: shipped as `@draftably/runtime` and `@draftably/markdown`; see [Embed diagrams](https://draftably.dev/docs/embed) and [the closure record](../initiative-history.json).

## Themes and palettes

Two studies shaped the five themes. The palette study scored twenty color directions for distinct
roles, label contrast, color-blind separation and quiet frames. It replaced Graphite, Mulberry and
Midnight with Drafting, Ink and Blueprint, and made inherited group members pale cards. The texture
study wrote a recipe for a textured paper theme ("Pressed"). That try was set aside before the
palette study, so no textured theme shipped. Its rules for grain, halos and export still apply to a
later textured theme.

[Palette study (archived)](https://github.com/byronwall/draftably/blob/2083565255480f4f33c1fbba3f9831ac5910575b/docs/intent/diagram-themes/palette-research.md) ·
[Texture study (archived)](https://github.com/byronwall/draftably/blob/2083565255480f4f33c1fbba3f9831ac5910575b/docs/intent/diagram-themes/texture-research.md)

Status: shipped as the `theme` and `theme-color` lines; see [Themes and colors](../DSL.md#themes-and-colors), the appearance rules in [ARCHITECTURE.md](../ARCHITECTURE.md#components--the-interface) and [the closure record](../initiative-history.json).

Known limits from the palette study:

- Families at the same shade still rely on hue. Teal and green stay close, and blue and violet
  merge under protanopia. For meaning that must survive color blindness, pair one bright warm
  family with one dark cool family, or use Signal.
- In Blueprint, a dark group shade (900) of `amber` or `violet` reads brown or plum.

## Upstream proposals

[Saved drafts](upstream-proposals.md) for asking a Markdown host or Kroki to render `draft` fences. None has been sent.

## Diagram library coverage

| Topic                                             | Status                                                                                                                     | Files                                                                                                                                                                                                                              |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Draftably versus 15 popular diagramming libraries | Merged in [PR #221](https://github.com/byronwall/draftably/pull/221); see [the closure record](../initiative-history.json) | [Decision](diagram-library-gaps-2026-10-27/summary.md), [coverage](diagram-library-gaps-2026-10-27/coverage.md), [next steps](diagram-library-gaps-2026-10-27/next-steps.md), [run record](diagram-library-gaps-2026-10-27/run.md) |

The comparison covers 28 diagram families and 37 features across Draftably and 15 alternatives.
Its evidence tables separate native notation, approximations, custom application work, and extensions.
