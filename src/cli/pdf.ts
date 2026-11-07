/**
 * `draftably pdf`: a set of diagrams as one vector PDF. Headless Chrome prints one page per
 * diagram (or per emphasis state) from the same SVG `inspect --svg` draws, then pdf-lib adds
 * bookmarks and attaches each file's `.draft` source, which `check` and `open` read back.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
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
import { listedStates, withState } from '../model/status';
import { svgHref } from './links';
import { findChrome } from './png';
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
const COVER_ROWS = 24;

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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Prefix every id in `svg`, so the arrowheads of one page never stand in for another's. */
function scopeIds(svg: string, prefix: string) {
  const ids = new Set([...svg.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]));
  return svg
    .replace(/\bid="([^"]+)"/g, (_, id) => `id="${prefix}${id}"`)
    .replace(/url\(#([^)]+)\)/g, (m, id) => (ids.has(id) ? `url(#${prefix}${id})` : m))
    .replace(/href="#([^"]+)"/g, (m, id) => (ids.has(id) ? `href="#${prefix}${id}"` : m));
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

/** The print document: optional cover pages, then one named page per sheet. */
function printHtml(pages: Sheet[], opts: PdfOptions, cover: number, count: number) {
  const page = opts.page ?? 'fit',
    css: string[] = [],
    body: string[] = [];
  const add = (w: number, h: number, inner: string, id: string) => {
    const name = `p${body.length}`;
    css.push(`@page ${name}{size:${w}px ${h}px}`);
    body.push(
      `<section id="${id}" style="page:${name};width:${w}px;height:${h}px">${inner}</section>`,
    );
  };
  if (opts.title) {
    const [w, h] = page === 'fit' ? [1056, 816] : SIZES[page];
    for (let c = 0; c < cover; c++) {
      const rows = pages
        .slice(c * COVER_ROWS, (c + 1) * COVER_ROWS)
        .map(
          (p, i) =>
            `<li><a href="#page-${c * COVER_ROWS + i}"><span>${esc(p.title)}</span><b>${cover + c * COVER_ROWS + i + 1}</b></a></li>`,
        );
      add(
        w,
        h,
        `<div class="cover">${c ? '' : `<h1>${esc(opts.title)}</h1><p>${count} ${count === 1 ? 'diagram' : 'diagrams'}</p><h2>Contents</h2>`}<ol>${rows.join('')}</ol></div>`,
        `cover-${c}`,
      );
    }
  }
  pages.forEach((p, i) => {
    const [w, h] = pageSize(page, p.w, p.h);
    // A fixed page scales the drawing to fit inside the margins, never past its own size.
    const scale = page === 'fit' ? 1 : Math.min(1, (w - MARGIN * 2) / p.w, (h - MARGIN * 2) / p.h);
    const svg = scopeIds(p.svg, `p${i}-`).replace(
      /width="[\d.]+" height="[\d.]+"/,
      `width="${p.w * scale}" height="${p.h * scale}"`,
    );
    add(w, h, svg, `page-${i}`);
  });
  return `<!doctype html><meta charset="utf-8"><title>${esc(opts.title ?? 'Diagrams')}</title><style>
@page{margin:0}${css.join('')}
html,body{margin:0}
section{break-after:page;overflow:hidden;display:flex;align-items:center;justify-content:center}
section:last-child{break-after:auto}
svg{display:block;flex:none}
.cover{box-sizing:border-box;width:100%;height:100%;padding:72px 80px;font:14px/1.45 Inter,-apple-system,Helvetica,Arial,sans-serif;color:#1f2933}
.cover h1{font-size:32px;line-height:1.2;margin:0 0 6px;font-weight:650}
.cover p{margin:0 0 36px;color:#6b7785}
.cover h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6b7785;margin:0 0 10px;font-weight:600}
.cover ol{list-style:none;margin:0;padding:0}
.cover a{display:flex;gap:12px;padding:4px 0;color:inherit;text-decoration:none;border-bottom:1px solid #e6e9ee}
.cover a span{flex:1}
.cover a b{font-weight:500;color:#6b7785;font-variant-numeric:tabular-nums}
</style>${body.join('')}`;
}

/** Print `html` to a PDF with headless Chrome. */
async function print(html: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-pdf-'));
  try {
    const page = path.join(dir, 'print.html'),
      out = path.join(dir, 'out.pdf');
    fs.writeFileSync(page, html);
    await promisify(execFile)(
      findChrome(),
      [
        '--headless=new',
        '--disable-gpu',
        '--no-first-run',
        `--user-data-dir=${path.join(dir, 'profile')}`,
        '--no-pdf-header-footer',
        `--print-to-pdf=${out}`,
        pathToFileURL(page).href,
      ],
      { timeout: 120_000 },
    );
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
    cover = opts.title ? Math.ceil(pages.length / COVER_ROWS) : 0;
  const pdf = await PDFDocument.load(await print(printHtml(pages, opts, cover, drawn.length)));
  if (pdf.getPageCount() !== cover + pages.length)
    throw Error(
      `Chrome printed ${pdf.getPageCount()} pages; expected ${cover + pages.length}. A page overflowed.`,
    );
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
