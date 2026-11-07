/**
 * A standalone SVG of a projected diagram for terminal and agent inspection. It draws with the
 * same appearance, shapes and title wrapping as the canvas and embeds the fonts it uses.
 */
import { resolveAppearance, swatchFor, type ResolvedAppearance } from '../model/appearance';
import { oldDoc, panelDoc, withoutMargins } from '../model/panels';
import { countText, STACK_OFFSETS } from '../model/stack';
import { measureText } from '../model/fonts';
import { diagramFrame, FRAME_PAD, type DiagramFrame } from '../model/frame';
import { positionMarks, positionMarkup } from '../model/position-marks';
import { headingMarkup } from '../model/heading';
import { legendMarkup, markerMarkup } from '../model/legend';
import { footnoteMarkup } from '../model/footnote';
import { noteMarkup, placeNotes } from '../model/note';
import { drawnSwatch, participantAccent } from '../model/colors';
import { truncateText } from '../model/fonts';
import { drawingBounds } from '../model/bounds';
import { cellsBandOf, isCell, isOpenCell, styleOf } from '../model/graph';
import { brokenRectPath } from '../model/geometry';
import { ICONS } from '../model/icons';
import { edgeLabelLines, edgeLabelType, groupTitleLines, nodeLabel } from '../model/labels';
import { groupLinkMark, LINK_MARK_PATH, linkMark, linkTarget, type LinkMark } from '../model/link';
import {
  headOf,
  markerBox,
  markerFill,
  MARKER_SHAPES,
  MARKER_STROKE,
  tailOf,
  type EndMarker,
} from '../model/markers';
import { computeRoutes, HALO_WIDTH } from '../model/routes';
import {
  drawnLegend,
  edgeInk,
  HALO_GAP,
  haloInk,
  isDiff,
  listedStates,
  MARKER,
  statusPaint,
  usedStatuses,
  withState,
  type StatusPaint,
} from '../model/status';
import type { Diagram, Rect } from '../model/types';
import { visibleRects } from '../dsl/project';
import { haloPieces, panelDrawn, surfaces, phaseOpacity, type Surface } from '../model/surface';
import { LIFELINE, SOFT_PAD, SOFT_RADIUS, SOFT_TITLE } from '../dsl/frame';

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** How an object's `href` is written into the file; as written unless the caller says. */
export interface SvgOptions {
  href?: (href: string) => string;
  /** Writes a link in note or footnote text; null draws the text without a link. */
  textHref?: (href: string) => string | null;
  /** Draw every emphasis state as its own panel. */
  states?: boolean;
  /** Host-owned policies used by the portable runtime. */
  idPrefix?: string;
  fontCss?: string;
  title?: string;
  description?: string;
  styleNonce?: string;
  linkTarget?: '_self' | '_blank';
  metadata?: string;
  maxOutputBytes?: number;
}

export class SvgLimitError extends Error {}

const utf8 = new TextEncoder();

/** Count output as chunks arrive, before joining the final document. */
class SvgChunks extends Array<string> {
  private bytes = 0;
  constructor(private limit = Infinity) {
    super();
  }
  override push(...chunks: string[]) {
    for (const chunk of chunks) {
      this.bytes += utf8.encode(chunk).length + (this.length ? 1 : 0);
      if (this.bytes > this.limit) throw new SvgLimitError('SVG output exceeds maxOutputBytes.');
      super.push(chunk);
    }
    return this.length;
  }
}

/** Wrap marks in a link when the object has one. */
function linked(href: string | undefined, marks: string[], opts: SvgOptions) {
  if (!href) return marks;
  const url = linkTarget(href).kind === 'url';
  return [
    `<a class="link" href="${esc(opts.href?.(href) ?? href)}"${opts.linkTarget === '_self' ? ' target="_self"' : opts.linkTarget === '_blank' || url ? ' target="_blank" rel="noopener noreferrer"' : ''}>`,
    ...marks,
    '</a>',
  ];
}

/** The ↗ that says an object is a link. */
const markMarkup = (m: LinkMark, x: number, y: number, ink: string) =>
  `<path class="link-mark" transform="translate(${x + m.x},${y + m.y}) scale(${m.size / 10})" d="${LINK_MARK_PATH}" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`;

/** How a link in a note or footnote is written: as `href` on objects writes it. */
const writeHref = (opts: SvgOptions) =>
  opts.textHref ?? ((href: string) => opts.href?.(href) ?? href);

/** Hover for links, which a browser applies to an SVG opened on its own. */
const LINK_CSS =
  'a.link{cursor:pointer}a.link:hover .shape{stroke-width:2.4px}a.link:hover .link-mark{stroke-width:2px}';

/** A status's title marks: strike and ink fade, as attributes on a text element. */
const strikeAttr = (p: StatusPaint) =>
  (p.strike ? ' text-decoration="line-through"' : '') +
  (p.inkFade ? ` fill-opacity="${p.inkFade}"` : '');

/** The removed marker on a shape's top-right corner. */
const cornerMarker = (p: StatusPaint, r: Rect, ink: string, canvas: string) =>
  p.marker ? markerMarkup(r.x + r.w - MARKER.inset, r.y + MARKER.inset, ink, canvas) : '';

/** A status's fade, as an attribute on the element that groups an object's marks. */
const fade = (p: StatusPaint) => (p.opacity < 1 ? ` opacity="${p.opacity}"` : '');

const font = (p: { family: string; size: number; weight: number }) =>
  `font-family="${esc(p.family)}" font-size="${p.size}" font-weight="${p.weight}"`;

function outline(shape: string, r: Rect, radius: number, paint: string, ink = '') {
  if (shape === 'diamond')
    return `<path d="M${r.x + r.w / 2},${r.y} L${r.x + r.w},${r.y + r.h / 2} L${r.x + r.w / 2},${r.y + r.h} L${r.x},${r.y + r.h / 2} Z" ${paint}/>`;
  if (shape === 'circle')
    return `<ellipse cx="${r.x + r.w / 2}" cy="${r.y + r.h / 2}" rx="${r.w / 2}" ry="${r.h / 2}" ${paint}/>`;
  if (shape === 'text') return '';
  if (shape === 'marker')
    return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="2" fill="${ink}"/>`;
  const rx = shape === 'pill' ? r.h / 2 : radius;
  return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${rx}" ${paint}/>`;
}

/** The accent ring around an object a `rest=plain` state focuses. */
const haloMarkup = (shape: string, r: Rect, look: ResolvedAppearance) =>
  outline(
    shape === 'text' ? 'box' : shape,
    { x: r.x - HALO_GAP, y: r.y - HALO_GAP, w: r.w + 2 * HALO_GAP, h: r.h + 2 * HALO_GAP },
    look.radius + HALO_GAP,
    `fill="none" stroke="${haloInk(look)}" stroke-width="2"`,
  );

type Route = ReturnType<typeof computeRoutes>['routes'][number];

/** A byte or bit layout's unit numbers and the run-on pieces of its fields. */
function cellsChromeMarkup(doc: Diagram, look: ResolvedAppearance, id: string, g: Rect) {
  const chrome = doc.layout.containers[id]?.cellsChrome,
    ink = drawnSwatch(doc, look, id, 'group').ink;
  if (!chrome) return [];
  return [
    ...(chrome.ruler?.ticks ?? []).map(
      t =>
        `<text x="${g.x + t.x}" y="${g.y + chrome.ruler!.y + chrome.ruler!.h / 2}" text-anchor="middle" dominant-baseline="central" ${font(look.annotation)} fill="${ink}">${esc(t.label)}</text>`,
    ),
    ...Object.entries(chrome.pieces ?? {}).flatMap(([cell, pieces]) => {
      const c = drawnSwatch(doc, look, cell, 'node'),
        title = doc.graph.nodes.find(n => n.id === cell)?.title ?? '';
      return pieces.map(
        r =>
          `<rect x="${g.x + r.x}" y="${g.y + r.y}" width="${r.w}" height="${r.h}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.2"/>` +
          `<text x="${g.x + r.x + r.w / 2}" y="${g.y + r.y + r.h / 2}" text-anchor="middle" dominant-baseline="central" ${font(look.annotation)} fill="${c.ink}" opacity="0.75">${esc(truncateText(`… ${title}`, Math.max(0, r.w - 8), look.annotation))}</text>`,
      );
    }),
  ];
}

/** The connections' paths and label spots, routed around the document's own shapes. */
function routesOf(doc: Diagram) {
  const { vg, rects } = visibleRects(doc);
  return computeRoutes(doc, vg, rects, { previous: [] }).routes;
}

/**
 * The older panel's lines: the merged routes, so a line runs where it does in the newer panel,
 * except where an end changed shape or the label changed, so the old label sits by its own size.
 * Routing all of them as they were would move other lines too, since lines from one box share a
 * turn. A sequence's messages share nothing, and each label sits by its own size, so they all
 * take their older routes.
 */
function oldRoutes(doc: Diagram, merged: Route[]) {
  const shaped = new Set(doc.graph.nodes.filter(n => n.wasShape).map(n => n.id)),
    relabeled = new Set(doc.graph.edges.filter(e => e.was !== undefined).map(e => e.id)),
    rows = !!doc.layout.sequence;
  if (!rows && !shaped.size && !relabeled.size) return merged;
  const old = routesOf(oldDoc(doc));
  return merged.map(r => {
    const e = doc.graph.edges.find(x => x.id === r.id)!;
    return rows || shaped.has(e.from) || shaped.has(e.to) || relabeled.has(e.id)
      ? old.find(x => x.id === r.id)!
      : r;
  });
}

/**
 * One drawing's marks in its own coordinates, and the box they need with a margin. A comparison
 * panel passes routes of the whole merged drawing, so every line it keeps runs where it does in
 * the other panel.
 */
function sceneMarkup(
  doc: Diagram,
  look: ResolvedAppearance,
  marker: MarkerRef,
  opts: SvgOptions,
  shared?: Route[],
) {
  const { vg, rects } = visibleRects(doc);
  const kept = new Set(doc.graph.edges.map(e => e.id)),
    routes = shared ? shared.filter(r => kept.has(r.id)) : routesOf(doc);
  const out = new SvgChunks(opts.maxOutputBytes),
    diff = isDiff(doc);
  const backdrop = sequenceBackdrop(doc, look);
  out.push(...backdrop.panel);
  for (const g of vg.groups) {
    const r = rects.get(g.id)!,
      c = drawnSwatch(doc, look, g.id, 'group'),
      p = statusPaint(look, styleOf(doc, g.id).status, styleOf(doc, g.id).spot),
      // A `cells` group is a title band over cells drawn edge to edge, with no group glyph.
      cells = cellsBandOf(doc, g.id),
      band = cells ? cells / 2 : look.groupHeader / 2 - 7,
      tx = cells ? 12 : 33,
      title = cells
        ? [truncateText(g.title, Math.max(40, r.w - tx - 12), look.groupTitle)]
        : groupTitleLines(g.title, r.w, look, g.titleLines);
    if (g.frame === 'none') continue;
    if (g.frame === 'soft') {
      const hull = g.hull?.length ? g.hull : [{ x: 0, y: 0, w: r.w, h: r.h }];
      out.push(
        ...linked(
          g.href,
          [
            `<g data-id="${esc(g.id)}"${fade(p)}>`,
            ...hull.map(
              h =>
                `<rect x="${r.x + h.x}" y="${r.y + h.y}" width="${h.w}" height="${h.h}" rx="${SOFT_RADIUS}" fill="${c.fill}"/>`,
            ),
            `<text x="${r.x + hull[0].x + SOFT_TITLE.x}" y="${r.y + hull[0].y + SOFT_TITLE.y}" dominant-baseline="central" ${font(look.annotation)} fill="${c.ink}"${strikeAttr(p)}>${esc(truncateText(g.title, Math.max(40, hull[0].w - 2 * SOFT_PAD), look.annotation))}</text>`,
            '</g>',
          ],
          opts,
        ),
      );
      continue;
    }
    out.push(
      ...linked(
        g.href,
        [
          `<g data-id="${esc(g.id)}"${fade(p)}>`,
          p.halo ? haloMarkup('box', r, { ...look, radius: Math.min(10, look.radius + 4) }) : '',
          `<rect class="shape" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${cells ? Math.min(4, look.radius) : Math.min(10, look.radius + 4)}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${p.width ?? 1}" stroke-opacity="${p.stroke ? 1 : 0.65}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}/>`,
          cells
            ? ''
            : `<svg x="${r.x + 12}" y="${r.y + band - 6.5}" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="${c.ink}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${ICONS.group}</svg>`,
          ...cellsChromeMarkup(doc, look, g.id, r),
          ...title.map(
            (line, i) =>
              `<text x="${r.x + tx}" y="${r.y + band + i * look.groupTitle.lineHeight}" dominant-baseline="central" ${font(look.groupTitle)} fill="${c.ink}"${strikeAttr(p)}>${esc(line)}</text>`,
          ),
          g.href
            ? markMarkup(
                groupLinkMark(
                  title[title.length - 1],
                  look.groupTitle,
                  band + (title.length - 1) * look.groupTitle.lineHeight,
                ),
                r.x,
                r.y,
                c.ink,
              )
            : '',
          cornerMarker(p, r, c.stroke, look.canvas),
          '</g>',
        ],
        opts,
      ),
    );
  }
  // Phases go over the groups' column bands, faint enough that both read where they cross.
  out.push(...backdrop.phases);
  // Sequence participants' lifelines, under the message lines.
  for (const n of vg.nodes) {
    const r = rects.get(n.id);
    if (!r || !n.lifeline) continue;
    const x = r.x + r.w / 2;
    out.push(
      `<line x1="${x}" y1="${r.y + r.h}" x2="${x}" y2="${r.y + r.h + n.lifeline}" stroke="${look.muted}" stroke-width="${LIFELINE.width}" stroke-dasharray="${LIFELINE.dash}"/>`,
    );
  }
  const under = surfaces(doc, look);
  for (const route of routes) {
    const edge = doc.graph.edges.find(e => e.id === route.id)!,
      p = statusPaint(look, edge.status, edge.spot),
      ink = edgeInk(look, edge, diff),
      dash = p.dash ?? (edge.dashed ? '5 5' : ''),
      head = headOf(edge),
      tail = tailOf(edge);
    out.push(
      `<g data-id="${esc(edge.id)}"${fade(p)}>`,
      ...haloPieces(under, route.halo).flatMap(({ surface, d }) =>
        paintSurface(
          surface,
          s => `<path d="${d}" fill="none" stroke-width="${HALO_WIDTH}" ${s}/>`,
          'stroke',
        ),
      ),
      `<path d="${route.path}" fill="none" stroke="${ink}" stroke-width="${p.width ? p.width - 0.5 : 1.4}" stroke-linecap="round" stroke-linejoin="round"${dash ? ` stroke-dasharray="${dash}"` : ''}${head === 'none' ? '' : ` marker-end="url(#${marker(head, ink)})"`}${tail === 'none' ? '' : ` marker-start="url(#${marker(tail, ink, true)})"`}/>`,
    );
    const l = route.label,
      message = doc.layout.edges[route.id]?.row !== undefined,
      type = edgeLabelType(look, message),
      lines = edgeLabelLines(edge.label, look, message);
    if (l)
      out.push(
        ...paintSurface(
          under(l),
          s =>
            `<rect x="${l.x - l.w / 2}" y="${l.y - l.h / 2}" width="${l.w}" height="${l.h}" rx="4" ${s}/>`,
        ),
        `<text x="${l.x}" y="${l.y - ((lines.length - 1) * type.lineHeight) / 2}" text-anchor="middle" dominant-baseline="central" ${font(type)} fill="${ink}"${strikeAttr(p)}>${lines.length === 1 ? esc(lines[0]) : lines.map((line, i) => `<tspan x="${l.x}" dy="${i ? type.lineHeight : 0}">${esc(line)}</tspan>`).join('')}</text>`,
      );
    out.push('</g>');
  }
  for (const n of vg.nodes) {
    const r = rects.get(n.id)!,
      style = styleOf(doc, n.id),
      c = drawnSwatch(doc, look, n.id, 'node'),
      p = statusPaint(look, style.status, style.spot),
      radius = isCell(doc, n.id) ? 0 : look.radius,
      label = nodeLabel(doc, n.id, n.title, r),
      first = r.y + label.y - ((label.lines.length - 1) * label.lineHeight) / 2,
      ink = label.mode === 'center' && style.shape !== 'text' ? c.ink : look.text,
      accent = participantAccent(doc, look, n.id),
      paint = `class="shape" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${p.width ?? (accent ? 1.5 : 1.2)}"${p.dash ? ` stroke-dasharray="${p.dash}"` : ''}`;
    const badge = n.count ? countText(n.count) : '',
      bw = measureText(badge, look.annotation) + 12,
      bh = look.annotation.lineHeight + 4;
    const mark = n.href ? linkMark(style.shape, r.w, r.h, badge ? bw : 0) : undefined;
    out.push(
      ...linked(
        n.href,
        [
          `<g data-id="${esc(n.id)}"${fade(p)}>`,
          ...(n.count && style.shape !== 'text'
            ? STACK_OFFSETS.map(d =>
                outline(style.shape, { ...r, x: r.x + d, y: r.y + d }, radius, paint),
              )
            : []),
          p.halo ? haloMarkup(style.shape, r, look) : '',
          isOpenCell(doc, n.id)
            ? `<path d="${brokenRectPath(r)}" ${paint}/>`
            : outline(style.shape, r, radius, paint, look.text),
          accent && style.shape === 'box'
            ? `<path d="${accentPath(r, radius)}" fill="${accent}"/>`
            : '',
          `<text x="${r.x + label.x}" y="${first}" text-anchor="middle" dominant-baseline="central" ${font(look.title)} fill="${ink}"${strikeAttr(p)}>` +
            label.lines
              .map(
                (line, i) =>
                  `<tspan x="${r.x + label.x}" dy="${i ? label.lineHeight : 0}">${esc(line)}</tspan>`,
              )
              .join('') +
            '</text>',
          badge
            ? `<rect x="${r.x + r.w - bw + 6}" y="${r.y - bh / 2}" width="${bw}" height="${bh}" rx="${bh / 2}" fill="${c.stroke}"/>` +
              `<text x="${r.x + r.w - bw / 2 + 6}" y="${r.y}" text-anchor="middle" dominant-baseline="central" ${font(look.annotation)} fill="${look.canvas}">${esc(badge)}</text>`
            : '',
          mark ? markMarkup(mark, r.x, r.y, mark.inside ? c.ink : look.muted) : '',
          badge ? '' : cornerMarker(p, r, c.stroke, look.canvas),
          '</g>',
        ],
        opts,
      ),
    );
  }
  // Where changed objects were, over the boxes so a grown box can't hide its old outline, and
  // outside the bounds: marks move nothing.
  const past = positionMarkup(
    doc,
    look,
    positionMarks(doc, rects, drawingBounds(doc, vg, rects, routes)),
  );
  if (past) out.push(past);
  // A line that crosses cells to reach one is drawn over them, ending in a dot.
  for (const route of routes) {
    if (!route.cross) continue;
    const edge = doc.graph.edges.find(e => e.id === route.id)!,
      p = statusPaint(look, edge.status),
      ink = edgeInk(look, edge, diff),
      [a, b] = route.cross;
    out.push(
      `<g${fade(p)}>`,
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${ink}" stroke-width="${p.width ? p.width - 0.5 : 1.4}"${p.dash || edge.dashed ? ` stroke-dasharray="${p.dash ?? '5 5'}"` : ''}/>`,
      `<circle cx="${b.x}" cy="${b.y}" r="3.5" fill="${ink}"/>`,
      '</g>',
    );
  }
  return {
    markup: out.join('\n'),
    bounds: drawingBounds(doc, vg, rects, routes, FRAME_PAD),
    rects,
    routes,
  };
}

/** Height of a panel's label band in a side-by-side comparison, and the gap between panels. */
const PANEL_LABEL = 24,
  PANEL_GAP = 0;

/** A `<marker>` id, for one end's kind on a line of one color. */
type MarkerRef = (kind: EndMarker, ink: string, tail?: boolean) => string;

/**
 * One marker per kind and line color: an arrowhead for the theme's connection color and each other
 * color used, and any other mark the edges ask for. A tail needs its own, turned to face out.
 */
function markersFor(look: ResolvedAppearance, docs: Diagram[], prefix = '') {
  const inks = [
    ...new Set([
      look.connection,
      ...docs.flatMap(d => d.graph.edges.map(e => edgeInk(look, e, isDiff(d)))),
    ]),
  ];
  const marker: MarkerRef = (kind, ink, tail = false) => {
    const i = inks.indexOf(ink);
    return `${prefix}${kind}${i ? `-${i}` : ''}${tail ? '-tail' : ''}`;
  };
  const defs = new Map<string, string>();
  const add = (kind: EndMarker, ink: string, tail = false) => {
    if (kind === 'none') return;
    const box = markerBox(kind, tail),
      id = marker(kind, ink, tail);
    defs.set(
      id,
      `<marker id="${id}" markerWidth="${box.markerWidth}" markerHeight="${box.markerHeight}" refX="${box.refX}" refY="${box.refY}" orient="${box.orient}" markerUnits="userSpaceOnUse"><path d="${MARKER_SHAPES[kind].d}" fill="${markerFill(kind, ink, look.canvas)}" stroke="${ink}" stroke-width="${MARKER_STROKE}" stroke-linecap="round" stroke-linejoin="round"/></marker>`,
    );
  };
  for (const ink of inks) add('arrow', ink);
  for (const d of docs)
    for (const e of d.graph.edges) {
      const ink = edgeInk(look, e, isDiff(d));
      add(headOf(e), ink);
      add(tailOf(e), ink, true);
    }
  return { defs: [...defs.values()].join(''), marker };
}

/** The file's opening: the canvas, fonts, link hover, markers, and the title above it all. */
function openSvg(
  doc: Diagram,
  look: ResolvedAppearance,
  markers: string,
  { x, y, w, h, heading }: DiagramFrame,
  opts: SvgOptions,
) {
  const prefix = opts.idPrefix ?? 'draft',
    css = LINK_CSS.replace(/a\.link/g, `#${prefix}-svg a.link`),
    out = new SvgChunks(opts.maxOutputBytes);
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" id="${prefix}-svg" role="img" aria-labelledby="${prefix}-title${opts.description ? ` ${prefix}-description` : ''}" viewBox="${x} ${y} ${w} ${h}" width="${w}" height="${h}" data-theme="${look.theme}">`,
    `<title id="${prefix}-title">${esc(opts.title ?? doc.title)}</title>`,
    opts.description ? `<desc id="${prefix}-description">${esc(opts.description)}</desc>` : '',
    opts.metadata ?? '',
    `<defs><style${opts.styleNonce ? ` nonce="${esc(opts.styleNonce)}"` : ''}>${opts.fontCss ?? ''}${doc.graph.nodes.some(n => n.href) || doc.graph.groups.some(g => g.href) ? css : ''}</style>` +
      markers +
      '</defs>',
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${look.canvas}"/>`,
    // The title and subtitle sit above the drawing, left-aligned with the legend under it.
    headingMarkup(look, doc.appearance.heading, heading.x, heading.y, heading.wrap),
  );
  return out;
}

/**
 * Every emphasis state as its own labelled panel, in file order, in a grid whose whole image
 * comes closest to the target aspect ratio. States never move anything, so every panel shares one
 * box and one set of routes, and each object sits at the same place in every panel.
 */
function statesSvg(doc: Diagram, look: ResolvedAppearance, opts: SvgOptions): string {
  const states = listedStates(doc),
    docs = states.map(s => withState(withoutMargins(doc), s.id)),
    { defs, marker } = markersFor(look, docs, opts.idPrefix ? `${opts.idPrefix}-` : ''),
    shared = routesOf(doc),
    scenes = docs.map(d => sceneMarkup(d, look, marker, opts, shared));
  const b = scenes.map(s => s.bounds).reduce(union),
    x0 = Math.floor(b.x),
    y0 = Math.floor(b.y),
    cw = Math.ceil(b.x + b.w) - x0,
    ch = Math.ceil(b.y + b.h) - y0 + PANEL_LABEL,
    statuses = usedStatuses(doc),
    legend = drawnLegend(doc),
    // Panels repeat the drawing, so every note sits in the frame.
    notes = placeNotes(doc, look, new Map(), []);
  const target = doc.appearance.compare?.aspect ?? 1.6,
    grid = (cols: number) => {
      const rows = Math.ceil(states.length / cols),
        frame = diagramFrame(
          look,
          doc.appearance.heading,
          legend,
          statuses,
          { x: x0, y: y0, w: cols * cw, h: rows * ch },
          notes,
          doc.appearance.footnotes,
        );
      return { cols, frame, w: frame.w, h: frame.h };
    },
    { cols, frame } = states
      .map((_, i) => grid(i + 1))
      .reduce((a, c) =>
        Math.abs(Math.log(c.w / c.h / target)) < Math.abs(Math.log(a.w / a.h / target)) ? c : a,
      ),
    out = openSvg(doc, look, defs, frame, opts);
  scenes.forEach((scene, i) => {
    const col = i % cols,
      row = Math.floor(i / cols),
      px = x0 + col * cw,
      py = y0 + row * ch;
    out.push(
      `<text x="${px + 40}" y="${py + 36}" dominant-baseline="central" ${font(look.groupTitle)} fill="${look.text}">${esc(states[i].label)}</text>`,
    );
    if (col)
      out.push(
        `<line x1="${px}" x2="${px}" y1="${py + 16}" y2="${py + ch - 16}" stroke="${look.muted}" stroke-opacity="0.35"/>`,
      );
    if (row && !col)
      out.push(
        `<line x1="${x0 + 40}" x2="${x0 + cols * cw - 40}" y1="${py}" y2="${py}" stroke="${look.muted}" stroke-opacity="0.35"/>`,
      );
    out.push(
      `<g data-state="${esc(states[i].id)}" transform="translate(${col * cw},${row * ch + PANEL_LABEL})">`,
      scene.markup,
      '</g>',
    );
  });
  out.push(footnoteMarkup(look, frame.foot, frame.foot.x, frame.foot.y, writeHref(opts)));
  out.push(legendMarkup(look, frame.key, frame.legend.x, frame.legend.y));
  out.push(noteMarkup(look, frame.notes, writeHref(opts)));
  out.push('</svg>\n');
  return out.join('\n');
}

/**
 * A sequence diagram's panel, a light surface with a border that bounds the exchange, and a row
 * band for each phase with its label in a tab at the left edge. Drawn under everything else.
 */
export function sequenceBackdrop(doc: Diagram, look: ResolvedAppearance) {
  const seq = doc.layout.sequence;
  if (!seq) return { panel: [], phases: [] };
  const { panel } = seq,
    band = swatchFor(look, 'slate', 100, 'group'),
    tab = seq.phaseX ?? panel.x;
  return {
    panel: [
      panelDrawn(doc) &&
        `<rect class="sequence-panel" x="${panel.x}" y="${panel.y}" width="${panel.w}" height="${panel.h}" rx="${Math.min(10, look.radius + 4)}" fill="${swatchFor(look, 'slate', 50, 'group').fill}" stroke="${band.stroke}" stroke-opacity="0.6"/>`,
    ].filter(Boolean) as string[],
    // Alternate phases are tinted, so neighbours read apart even without their divider.
    phases: seq.phases.flatMap((ph, i) => [
      `<rect class="sequence-phase" data-phase="${esc(ph.id)}" x="${panel.x}" y="${ph.y}" width="${panel.w}" height="${ph.h}" fill="${band.stroke}" fill-opacity="${phaseOpacity(i)}"/>`,
      `<line x1="${panel.x}" x2="${panel.x + panel.w}" y1="${ph.y}" y2="${ph.y}" stroke="${band.stroke}" stroke-opacity="0.5"/>`,
      `<text x="${tab + PHASE_TAB}" y="${ph.y + PHASE_TAB}" dominant-baseline="hanging" ${font(look.annotation)} fill="${look.muted}">${esc(ph.label)}</text>`,
    ]),
  };
}

/** Markup painted with a surface: its fill, then a phase band's tint over it. */
function paintSurface(surface: Surface, mark: (paint: string) => string, attr = 'fill') {
  const t = surface.tint;
  return [
    mark(`${attr}="${surface.fill}"`),
    t ? mark(`${attr}="${t.fill}" ${attr}-opacity="${t.opacity}"`) : '',
  ];
}

/** Inset of a phase label from its band's top left corner. */
export const PHASE_TAB = 8;

/** A thin stripe across the top of a box, inside its rounded corners. */
export function accentPath(r: Rect, radius: number) {
  const k = Math.min(radius, r.w / 2, 4),
    t = 4;
  return `M${r.x} ${r.y + t}V${r.y + k}Q${r.x} ${r.y} ${r.x + k} ${r.y}H${r.x + r.w - k}Q${r.x + r.w} ${r.y} ${r.x + r.w} ${r.y + k}V${r.y + t}Z`;
}

export function renderSvg(doc: Diagram, opts: SvgOptions = {}): string {
  const look = resolveAppearance(doc.appearance),
    compare = doc.appearance.compare;
  if (opts.states) return statesSvg(doc, look, opts);
  const { defs, marker } = markersFor(look, [doc], opts.idPrefix ? `${opts.idPrefix}-` : '');
  // With `compare`, each version is its own panel drawn from the merged positions, so the panels
  // share one box and every unchanged object lines up across them.
  const merged = compare ? routesOf(doc) : undefined,
    shared = merged ? [oldRoutes(doc, merged), merged] : [],
    scenes = (compare ? [panelDoc(doc, 'before'), panelDoc(doc, 'after')] : [doc]).map((d, i) =>
      sceneMarkup(d, look, marker, opts, shared[i]),
    );
  const b = scenes.map(s => s.bounds).reduce(union),
    x0 = Math.floor(b.x),
    y0 = Math.floor(b.y),
    bw = Math.ceil(b.x + b.w) - x0,
    bh = Math.ceil(b.y + b.h) - y0,
    label = compare ? PANEL_LABEL : 0,
    statuses = usedStatuses(doc),
    legend = drawnLegend(doc),
    // A comparison's panels repeat the drawing, so its notes sit in the frame.
    notes = compare
      ? placeNotes(doc, look, new Map(), [])
      : placeNotes(doc, look, scenes[0].rects, scenes[0].routes);
  // Along the stacking axis each panel takes only the room its own version needs; across it, the
  // panels share the merged extent, which is what keeps unchanged objects aligned: stacked panels
  // line up left to right, side-by-side panels top to bottom.
  const arrange = (stacked: boolean) => {
    const spans = scenes.map(({ bounds: r }) =>
        stacked
          ? { from: Math.floor(r.y), size: Math.ceil(r.y + r.h) - Math.floor(r.y) }
          : { from: Math.floor(r.x), size: Math.ceil(r.x + r.w) - Math.floor(r.x) },
      ),
      starts = spans.map((_, i) =>
        spans.slice(0, i).reduce((sum, p) => sum + p.size + PANEL_GAP + (stacked ? label : 0), 0),
      ),
      total = starts.at(-1)! + spans.at(-1)!.size,
      areaW = stacked ? bw : total,
      areaH = stacked ? total + label : bh + label,
      frame = diagramFrame(
        look,
        doc.appearance.heading,
        legend,
        statuses,
        { x: x0, y: y0, w: areaW, h: areaH },
        notes,
        doc.appearance.footnotes,
      );
    return { stacked, spans, starts, areaH, frame, w: frame.w, h: frame.h };
  };
  // An explicit direction wins; otherwise take the arrangement whose whole image comes closest to
  // the target aspect ratio.
  const target = compare?.aspect ?? 1.6,
    fit = (a: ReturnType<typeof arrange>) => Math.abs(Math.log(a.w / a.h / target)),
    options = compare?.direction
      ? [arrange(compare.direction === 'down')]
      : [arrange(true), arrange(false)],
    { stacked, spans, starts, areaH, frame } = options.reduce((a, b) => (fit(b) < fit(a) ? b : a));
  const out = openSvg(doc, look, defs, frame, opts);
  scenes.forEach((scene, i) => {
    // Panel i's corner, and the shift that brings its own span to that corner.
    const px = stacked ? x0 : x0 + starts[i],
      py = stacked ? y0 + starts[i] : y0,
      dx = stacked ? 0 : px - spans[i].from,
      dy = (stacked ? py - spans[i].from : 0) + label;
    if (compare) {
      const name = i ? compare.after : compare.before;
      out.push(
        `<text x="${px + 40}" y="${py + 36}" dominant-baseline="central" ${font(look.groupTitle)} fill="${look.text}">${esc(name)}</text>`,
      );
      if (!i && compare.undrawn) {
        const from = px + 40 + measureText(name, look.groupTitle) + 12,
          room = (stacked ? bw : spans[0].size) - (from - px) - 40;
        out.push(
          `<text x="${from}" y="${py + 36}" dominant-baseline="central" ${font(look.annotation)} fill="${look.muted}">${esc(truncateText(`Drawn as new: ${compare.undrawn}`, room, look.annotation))}</text>`,
        );
      }
      if (i)
        out.push(
          stacked
            ? `<line x1="${x0 + 40}" x2="${x0 + bw - 40}" y1="${py - PANEL_GAP / 2}" y2="${py - PANEL_GAP / 2}" stroke="${look.muted}" stroke-opacity="0.35"/>`
            : `<line x1="${px - PANEL_GAP / 2}" x2="${px - PANEL_GAP / 2}" y1="${y0}" y2="${y0 + areaH}" stroke="${look.muted}" stroke-opacity="0.35"/>`,
        );
    }
    out.push(`<g transform="translate(${dx},${dy})">`, scene.markup, '</g>');
  });
  // The legend sits under the drawing, left-aligned with it, its rows wrapped to the frame.
  out.push(footnoteMarkup(look, frame.foot, frame.foot.x, frame.foot.y, writeHref(opts)));
  out.push(legendMarkup(look, frame.key, frame.legend.x, frame.legend.y));
  out.push(noteMarkup(look, frame.notes, writeHref(opts)));
  out.push('</svg>\n');
  return out.join('\n');
}

const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};
