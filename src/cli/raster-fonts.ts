/**
 * The bundled diagram fonts as TrueType files on disk, for the PNG and PDF writers. resvg and
 * PDFKit read TrueType, not WOFF2, and resvg loads fonts reliably only from files. The TrueType
 * files are the WOFF2 files in `src/assets/fonts`, decompressed; only the CLI ships them.
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FaceId } from '../model/fonts';
import sans500 from './fonts/inter-latin-500-normal.ttf?inline';
import sans600 from './fonts/inter-latin-600-normal.ttf?inline';
import serif600 from './fonts/source-serif-4-latin-600-normal.ttf?inline';
import mono500 from './fonts/jetbrains-mono-latin-500-normal.ttf?inline';

const DATA: Record<FaceId, string> = {
  'sans-500': sans500,
  'sans-600': sans600,
  'serif-600': serif600,
  'mono-500': mono500,
};

let files: Record<FaceId, string> | undefined;

/** Each face's TrueType file, written once to a folder named by the fonts' content. */
export function fontFiles(): Record<FaceId, string> {
  if (files) return files;
  const hash = createHash('sha1');
  for (const url of Object.values(DATA)) hash.update(url);
  const dir = path.join(os.tmpdir(), `draftably-fonts-${hash.digest('hex').slice(0, 12)}`);
  fs.mkdirSync(dir, { recursive: true });
  const out = {} as Record<FaceId, string>;
  for (const [id, url] of Object.entries(DATA) as [FaceId, string][]) {
    const file = path.join(dir, `${id}.ttf`);
    if (!fs.existsSync(file)) {
      // Write beside the target and rename, so a parallel run never reads half a file.
      const part = `${file}.${process.pid}.part`;
      fs.writeFileSync(part, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      fs.renameSync(part, file);
    }
    out[id] = file;
  }
  return (files = out);
}
