# How a draftably diagram should feel

This is the standing intent behind draftably's drawings and viewer: what "good" looks and feels
like to the person who uses it every day. It comes from review sessions over real diagrams, the
latest being the [23 October walkthrough](../viewer-feedback-2026-10-23/README.md) of thirteen
deployment diagrams. Use it to judge a change, a layout rule or an audit finding. When a rule
here and a metric disagree, this file is the tie-breaker; if this file is wrong, change it on
purpose.

The quality audit ([RUBRIC.md](RUBRIC.md)) measures defects. This file says
what the measurements are for.

## The one-line version

A diagram should read like a careful person drew it: it flows left to right and top to bottom,
lines take the obvious way in, color means something, the frame never shouts over the content,
and the tool responds the instant you touch it.

## Reading order and ports

- **Flow goes left to right, then top to bottom.** Lines leave a box by its right or bottom side
  and arrive on its left or top. Left is the more typical entry in a flow.
- **Never arrive from below** unless nothing else works. A port on a box's bottom edge for a line
  that came from above reads as backwards and is the single most common complaint.
- **Take the obvious path.** If a line could go out the bottom and straight into the top of the
  next thing, it should. A loop round the outside, "all these bends just to come in at the top",
  is worse than one crossing.
- **Ports can meet a line part-way.** A horizontal stub may join a vertical trunk; it does not
  need its own lane all the way to the side it "should" enter.
- When an obstacle (a label, a group's title band) forces a detour, that is a cost to weigh, not
  a wall. If the honest route crosses a title band or passes near a label, that can be fine.

## Lines and containers

- **A line to something outside its container leaves the container and keeps going.** It should
  not run along the inside of the frame to reach a box outside it.
- **The connection is the stronger mark.** Where a line crosses a container border, the border
  gives way (a halo breaks it), and container borders are quieter than lines.
- **Fewer crossings.** Accept a crossing only when avoiding it costs a real detour. "It could
  have gone below this other one" means the crossing was not needed.
- **Labels sit clear of boxes.** An edge label tight against a node is hard to read; move it
  along the line.
- **A label sits on its own line.** The line runs through it, at a corner or mid-run, the same
  for every label. A label slides along its line before it steps beside it, and steps beside it
  only when another line would run through it. Half on and half beside reads as two systems.

## Placement

- **Keep related things together.** A node connected to one neighbour should sit beside it, not
  a long way down the flow, even if that bends the aspect ratio a little.
- **Siblings sit where their connections point.** A group fed by another group sits on that
  group's side (Configuration to the right of Operator tools when tools feed configuration).
- Long top-to-bottom flows are fine when that is how the content reads.

## Color

- **Color carries meaning.** Two to four accent families, each for one role, and neutrals
  (`slate`, `stone`) for everything else. A stack of colors is noise.
- **Say what the colors mean.** A legend on screen gives the coloring a schema.
- **No Christmas trees.** Avoid red next to green and arbitrary complementary pairs (red and
  blue) unless they encode opposites.
- **A member never matches its container.** Red on red loses the member. Nested containers of
  one family step in shade: lighter frames underneath, smaller and stronger regions on top.
- Muddy grays are a smell: if a neutral is doing the work, it should look intentional.

## Framing

- **Fit with a margin.** A fitted diagram fills about 90–95% of the view, never edge to edge,
  and never zooms past actual size on a large monitor.
- A collapsed container keeps its header exactly where it was; collapsing must not move the
  title or crowd it.

## Interaction

- **The wheel zooms.** No modifier, no wheel panning; drag the background to pan, drag an object
  to move it. No surprise zoom from holding Cmd and moving the mouse.
- **Zoom is smooth**, a modest step per notch, never jumpy.
- **Everything that moves on drag says so on hover.**
- **Stable.** Clicking or pressing a shape changes nothing else on screen; lines do not jump
  while you select.
- **Fast.** Moving a container, collapsing one, or switching diagrams answers immediately.
  Seconds of delay after an edit is a bug, wherever it comes from.
- **No flashes.** Moving between diagrams never blanks the screen.
- **Edit in place.** Editing a title happens on the object, in its own font and colors, with no
  scrolling text box.
- **Motion explains change.** Collapse and expand animate so you see where things went.

## The diagram list

- Recent order must read as sorted: show times, not just dates, when files share a day.
- Folders should be visible as folders when diagrams live in more than one.
