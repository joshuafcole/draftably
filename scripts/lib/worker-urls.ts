import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Vite's library build writes a worker as
 * `new Worker(new URL("" + new URL("assets/x.js", import.meta.url).href, import.meta.url))`.
 * Host bundlers recognize only the plain `new Worker(new URL("./x.js", import.meta.url))`:
 * Turbopack (Next.js) turned the nested form into a `file://` URL, and the bare `assets/` path
 * sent Vite in Nuxt to the app's own `assets` alias. Both lost the worker. Write the plain form,
 * which webpack, Turbopack and Vite all bundle. Throws when nothing matches or a nested form is
 * left, so a change in Vite's output fails the build instead of shipping a lost worker.
 */
export function relativeWorkerUrls(dir: string): void {
  const nested =
    /new URL\(\s*\/\* @vite-ignore \*\/\s*"" \+ new URL\((["'])(?:\.\/)?(assets\/[^"']+)\1, import\.meta\.url\)\.href,\s*import\.meta\.url\s*\)/g;
  let count = 0;
  for (const file of readdirSync(dir, { recursive: true }) as string[]) {
    if (!file.endsWith('.js')) continue;
    const full = path.join(dir, file);
    const text = readFileSync(full, 'utf8');
    const next = text.replace(nested, (_, quote, asset) => {
      count++;
      return `new URL(${quote}./${asset}${quote}, import.meta.url)`;
    });
    if (/"" \+ new URL\(/.test(next)) throw Error(`A nested worker URL is left in ${full}`);
    if (next !== text) writeFileSync(full, next);
  }
  if (!count) throw Error(`No worker URL to rewrite in ${dir}`);
}
