/**
 * `draftably pdf`: a set of diagrams as one vector PDF. PDFKit draws one page per diagram (or per
 * emphasis state) from the same SVG `inspect --svg` draws, then pdf-lib adds bookmarks and
 * attaches each file's `.draft` source, which `check` and `open` read back.
 */
// The editor's declaration build reaches this file but not src/*.d.ts, so name the types here.
// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference path="./svg-to-pdfkit.d.ts" />
import fs from 'node:fs';
import path from 'node:path';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNull,
  PDFRawStream,
  PDFString,
  type PDFRef,
} from 'pdf-lib';
import { compile } from '../dsl/compile';
import { projectScene } from '../dsl/project';
import { formatSource } from '../dsl/syntax';

import { FACES, type FaceId } from '../model/fonts';
import { listedStates, withState } from '../model/status';
import { svgHref } from './links';
import { fontFiles } from './raster-fonts';
import { renderSvg } from './svg';

export type PdfOrder = 'name' | 'title' | 'given';
export type PdfPage = 'fit' | 'letter' | 'a4' | 'slide';
export const PDF_ORDERS: PdfOrder[] = ['name', 'title', 'given'];
export const PDF_PAGES: PdfPage[] = ['fit', 'letter', 'a4', 'slide'];

export interface PdfOptions {
  order?: PdfOrder;
  page?: PdfPage;
  /** A cover page with this title and a contents list. */
  title?: string;
  /** One page per emphasis state. */
  states?: boolean;
  /** Attach each file's source; on unless set false. */
  source?: boolean;
}

/** A diagram to print: the name it is listed and attached under, and its source. */
export interface PdfInput {
  name: string;
  source: string;
}

/** Fixed page sizes in CSS pixels (96 per inch), portrait; slide is 16:9 and always landscape. */
const SIZES = { letter: [816, 1056], a4: [794, 1123], slide: [1280, 720] } as const;
const MARGIN = 48;
/** Points per CSS pixel. */
const PX = 0.75;
/** Cover layout in CSS pixels: page padding, the heading on the first page, one contents row. */
const COVER_PAD = 72,
  COVER_HEAD = 38.4 + 6 + 20.3 + 36 + 18.85 + 10,
  COVER_ROW = 29.3;

const coverSize = (page: PdfPage) => (page === 'fit' ? [1056, 816] : SIZES[page]);

/** The first contents row on each cover page; each page holds as many rows as fit. */
function coverStarts(page: PdfPage, rows: number) {
  const h = coverSize(page)[1],
    starts: number[] = [];
  for (let at = 0; at < rows;) {
    starts.push(at);
    at += Math.floor((h - COVER_PAD * 2 - (starts.length === 1 ? COVER_HEAD : 0)) / COVER_ROW);
  }
  return starts;
}

export const isPdfName = (name: string) => /\.pdf$/i.test(name);

/** `.draft` files from files and folders, as given; a folder's files by name. */
export function pdfInputs(args: string[]): PdfInput[] {
  const files = args.flatMap(f =>
    fs.statSync(path.resolve(f), { throwIfNoEntry: false })?.isDirectory()
      ? fs
          .readdirSync(path.resolve(f))
          .filter(n => n.endsWith('.draft'))
          .sort()
          .map(n => path.join(f, n))
      : [f],
  );
  return files.map(f => ({ name: f, source: fs.readFileSync(path.resolve(f), 'utf8') }));
}

interface Sheet {
  title: string;
  svg: string;
  w: number;
  h: number;
}

/** Each input's pages; throws naming the first file with errors, before anything is printed. */
async function sheets(inputs: PdfInput[], opts: PdfOptions) {
  const drawn = [];
  for (const input of inputs) {
    // Name the file, so the person exporting knows which one to fix or leave out.
    const fail = (lines: string[]) => {
      throw Error(`${input.name} has errors; fix them or leave it out. ${lines.join(' ')}`);
    };
    const scene = await compile(input.source).catch((e: Error) => fail([e.message]));
    const errors = scene.diagnostics.filter(d => d.level === 'error');
    if (errors.length) fail(errors.map(d => `${d.line ? `Line ${d.line}: ` : ''}${d.message}`));
    const doc = projectScene(scene),
      title = doc.appearance.heading?.title || doc.title || path.basename(input.name, '.draft');
    const states = opts.states ? listedStates(doc) : [];
    const pages: Sheet[] = (states.length ? states : [undefined]).map(state => {
      // Links are written as `inspect --svg` writes them: joined to a URL `link-base`.
      const svg = renderSvg(state ? withState(doc, state.id) : doc, {
        href: svgHref(scene, input.name),
      });
      const [, w, h] = /width="([\d.]+)" height="([\d.]+)"/.exec(svg)!.map(Number);
      return { title: state ? `${title}: ${state.label}` : title, svg, w, h };
    });
    drawn.push({ input, title, pages });
  }
  if (opts.order === 'name')
    drawn.sort((a, b) => path.basename(a.input.name).localeCompare(path.basename(b.input.name)));
  else if (opts.order === 'title') drawn.sort((a, b) => a.title.localeCompare(b.title));
  return drawn;
}

/** A page's size: the diagram's own, or the fixed size turned to the diagram's orientation. */
function pageSize(page: PdfPage, w: number, h: number) {
  if (page === 'fit') return [Math.ceil(w), Math.ceil(h)];
  const [a, b] = SIZES[page];
  return page === 'slide' || w > h ? [Math.max(a, b), Math.min(a, b)] : [a, b];
}

/** PDFKit's loaded font, for the line metrics its type definitions leave out. */
interface LoadedFont {
  ascender: number;
  descender: number;
}

/**
 * Draw the cover pages and one page per sheet with PDFKit. Sizes are CSS pixels, as the diagrams
 * are, drawn as points (96 px to 72 pt), so a page prints at the size the viewer shows.
 */
async function draw(pages: Sheet[], opts: PdfOptions, starts: number[], count: number) {
  const [{ default: PDFDocument }, { default: SVGtoPDF }] = await Promise.all([
    import('pdfkit'),
    import('svg-to-pdfkit'),
  ]);
  const doc = new PDFDocument({ autoFirstPage: false, compress: true }),
    chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise(resolve => doc.on('end', resolve));
  const fonts = fontFiles();
  for (const [id, file] of Object.entries(fonts)) doc.registerFont(id, file);
  const add = (w: number, h: number) => doc.addPage({ size: [w * PX, h * PX], margin: 0 });
  const page = opts.page ?? 'fit';

  if (opts.title) {
    const [w, h] = coverSize(page),
      cover = starts.length;
    // One line of text in a CSS line box `lh` tall whose top is at `top`. The cover is laid out
    // in pixels but drawn in points: PDFKit starts a new page for text below the page's height
    // in points, so it must not run under a scale.
    const line = (text: string, x: number, top: number, size: number, lh: number, o = {}) => {
      const f = (doc as unknown as { _font: LoadedFont })._font,
        content = ((f.ascender - f.descender) / 1000) * size;
      doc
        .fontSize(size * PX)
        .text(text, x * PX, (top + (lh - content) / 2) * PX, { lineBreak: false, ...o });
    };
    for (let c = 0; c < cover; c++) {
      add(w, h);
      let y = COVER_PAD;
      if (!c) {
        doc.font('sans-600').fillColor('#1f2933');
        line(opts.title, 80, y, 32, 38.4);
        y += 38.4 + 6;
        doc.font('sans-500').fillColor('#6b7785');
        line(`${count} ${count === 1 ? 'diagram' : 'diagrams'}`, 80, y, 14, 20.3);
        y += 20.3 + 36;
        doc.font('sans-600');
        line('CONTENTS', 80, y, 13, 18.85, { characterSpacing: 13 * 0.06 * PX });
        y += 18.85 + 10;
      }
      const right = w - 80;
      pages.slice(starts[c], starts[c + 1]).forEach((p, at) => {
        const i = starts[c] + at,
          n = String(cover + i + 1);
        doc.font('sans-500').fillColor('#1f2933');
        const nw = doc.fontSize(14 * PX).widthOfString(n) / PX;
        line(p.title, 80, y + 4, 14, 20.3, { width: (right - nw - 12 - 80) * PX, ellipsis: true });
        doc.fillColor('#6b7785');
        line(n, right - nw, y + 4, 14, 20.3);
        doc.goTo(80 * PX, y * PX, (right - 80) * PX, (COVER_ROW - 1) * PX, `page-${i}`);
        doc.rect(80 * PX, (y + COVER_ROW - 1) * PX, (right - 80) * PX, PX).fill('#e6e9ee');
        y += COVER_ROW;
      });
    }
  }

  pages.forEach((p, i) => {
    const [w, h] = pageSize(page, p.w, p.h);
    // A fixed page scales the drawing to fit inside the margins, never past its own size.
    const scale = page === 'fit' ? 1 : Math.min(1, (w - MARGIN * 2) / p.w, (h - MARGIN * 2) / p.h);
    add(w, h).scale(PX);
    doc.addNamedDestination(`page-${i}`);
    // svg-to-pdfkit sizes the drawing by the root's own size, so the scale goes there.
    const svg = p.svg.replace(
      /width="[\d.]+" height="[\d.]+"/,
      `width="${p.w * scale}" height="${p.h * scale}"`,
    );
    SVGtoPDF(doc, svg, (w - p.w * scale) / 2, (h - p.h * scale) / 2, {
      assumePt: true,
      fontCallback: (family: string, bold: boolean) => faceId(family, bold),
    });
  });
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

/** The bundled face an SVG `font-family` and weight name, as PDFKit registered it. */
function faceId(family: string, bold: boolean): FaceId {
  const ids = Object.keys(FACES) as FaceId[];
  const named = ids.filter(id => family.includes(FACES[id].family));
  return (
    named.find(id => FACES[id].weight >= 600 === bold) ??
    named[0] ??
    (bold ? 'sans-600' : 'sans-500')
  );
}

/** Flat bookmarks: one per entry, each opening its page. */
function addOutline(pdf: PDFDocument, entries: { title: string; page: PDFRef }[]) {
  const ctx = pdf.context,
    root = ctx.nextRef(),
    refs = entries.map(() => ctx.nextRef());
  entries.forEach((e, i) => {
    const item = ctx.obj({
      Title: PDFHexString.fromText(e.title),
      Parent: root,
      Dest: ctx.obj([e.page, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
    });
    if (i > 0) item.set(PDFName.of('Prev'), refs[i - 1]);
    if (i < refs.length - 1) item.set(PDFName.of('Next'), refs[i + 1]);
    ctx.assign(refs[i], item);
  });
  ctx.assign(
    root,
    ctx.obj({ Type: 'Outlines', First: refs[0], Last: refs.at(-1)!, Count: refs.length }),
  );
  pdf.catalog.set(PDFName.of('Outlines'), root);
  pdf.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));
}

/** The PDF of `inputs`: cover, pages, bookmarks and attached sources. */
export async function buildPdf(inputs: PdfInput[], opts: PdfOptions = {}) {
  if (!inputs.length) throw Error('No diagrams to print.');
  const drawn = await sheets(inputs, opts),
    pages = drawn.flatMap(d => d.pages),
    starts = opts.title ? coverStarts(opts.page ?? 'fit', pages.length) : [],
    cover = starts.length;
  const pdf = await PDFDocument.load(await draw(pages, opts, starts, drawn.length));
  if (pdf.getPageCount() !== cover + pages.length)
    throw Error(`Drew ${pdf.getPageCount()} pages; expected ${cover + pages.length}.`);
  const refs = pdf.getPages().map(p => p.ref);
  addOutline(pdf, [
    ...(cover ? [{ title: 'Contents', page: refs[0] }] : []),
    ...pages.map((p, i) => ({ title: p.title, page: refs[cover + i] })),
  ]);
  pdf.setTitle(opts.title ?? (drawn.length === 1 ? drawn[0].title : 'Diagrams'), {
    showInWindowTitleBar: true,
  });
  pdf.setCreator('draftably');
  if (opts.source !== false) {
    const used = new Set<string>();
    for (const { input, title } of drawn) {
      let name = path.basename(input.name);
      for (let n = 2; used.has(name); n++)
        name = path.basename(input.name, '.draft') + `-${n}.draft`;
      used.add(name);
      await pdf.attach(new TextEncoder().encode(formatSource(input.source)), name, {
        mimeType: 'text/plain',
        description: title,
      });
    }
  }
  return { bytes: await pdf.save(), pages: pdf.getPageCount() };
}

/** The `.draft` sources attached to a PDF, in order; empty when it has none. */
export async function readPdfSources(bytes: Uint8Array) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false }),
    out: PdfInput[] = [];
  const names = pdf.catalog.lookupMaybe(PDFName.of('Names'), PDFDict);
  const walk = (node: PDFDict | undefined) => {
    if (!node) return;
    const kids = node.lookupMaybe(PDFName.of('Kids'), PDFArray);
    for (let i = 0; kids && i < kids.size(); i++) walk(kids.lookup(i, PDFDict));
    const list = node.lookupMaybe(PDFName.of('Names'), PDFArray);
    for (let i = 1; list && i < list.size(); i += 2) {
      const spec = list.lookup(i, PDFDict),
        file = spec.lookupMaybe(PDFName.of('EF'), PDFDict)?.lookup(PDFName.of('F'));
      const label = spec.lookup(PDFName.of('UF')) ?? spec.lookup(PDFName.of('F'));
      const name =
        label instanceof PDFString || label instanceof PDFHexString ? label.decodeText() : '';
      if (!name.endsWith('.draft') || !(file instanceof PDFRawStream)) continue;
      out.push({ name, source: new TextDecoder().decode(decodePDFRawStream(file).decode()) });
    }
  };
  walk(names?.lookupMaybe(PDFName.of('EmbeddedFiles'), PDFDict));
  return out;
}
