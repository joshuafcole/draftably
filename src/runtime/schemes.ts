/**
 * One SVG for both color schemes. The light and dark drawings come from one layout and differ
 * only in their colors, so each color that differs becomes `light-dark(light, dark)`, which the
 * browser resolves from the `color-scheme` around the SVG. A scheme change then needs no new
 * render. Browsers read `light-dark()` in presentation attributes as in CSS.
 */
const COLOR = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g;

/** Both drawings as one, or null when they differ in more than color. */
export function mergeSchemes(light: string, dark: string): string | null {
  // The root names its theme; the merged drawing keeps the light one's name.
  const theme = /data-theme="[^"]*"/.exec(light)?.[0];
  if (theme) dark = dark.replace(/data-theme="[^"]*"/, theme);
  const parts = light.split(COLOR),
    other = dark.split(COLOR);
  if (parts.length !== other.length || parts.some((p, i) => p !== other[i])) return null;
  const a = light.match(COLOR) ?? [],
    b = dark.match(COLOR) ?? [];
  let out = parts[0];
  for (let i = 0; i < a.length; i++)
    out +=
      (a[i].toLowerCase() === b[i].toLowerCase() ? a[i] : `light-dark(${a[i]}, ${b[i]})`) +
      parts[i + 1];
  return out;
}
