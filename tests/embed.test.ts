import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/main';
import { compareDetailed } from '../src/dsl/compare';
import { formatSource } from '../src/dsl/syntax';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-embed-'));
afterEach(() => vi.restoreAllMocks());

/** Run the CLI and return what it printed to stdout, and its exit code. */
async function run(...argv: string[]) {
  let out = '';
  vi.spyOn(process.stdout, 'write').mockImplementation(chunk => ((out += chunk), true));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  return { code: await main(argv), out };
}

const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

describe('source embedded in exported PNGs', () => {
  it('gives back the formatted source of a plain file byte for byte', async () => {
    const draft = 'examples/checkout.draft',
      png = path.join(dir, 'plain.png');
    expect((await run('inspect', draft, '--png', png)).code).toBe(0);
    const { code, out } = await run('extract', png);
    expect(code).toBe(0);
    expect(out).toBe(formatSource(fs.readFileSync(draft, 'utf8')));
  }, 60_000);

  it('gives back the marked file of a compare export', async () => {
    const before = write(
        'before.draft',
        'diagram "A" version=1\nnode a "A"\nnode b "B"\nedge ab a -> b\n',
      ),
      after = write(
        'after.draft',
        'diagram "A" version=1\nnode a "A"\nnode c "C"\nedge ac a -> c\n',
      ),
      png = path.join(dir, 'compare.png');
    expect((await run('compare', before, after, '--png', png)).code).toBe(0);
    const { merged } = compareDetailed(
      fs.readFileSync(before, 'utf8'),
      fs.readFileSync(after, 'utf8'),
    );
    expect((await run('extract', png)).out).toBe(formatSource(merged));
  }, 60_000);

  it('exits 1 for an export made with --no-source', async () => {
    const png = path.join(dir, 'bare.png');
    await run('inspect', 'examples/checkout.draft', '--png', png, '--no-source');
    expect((await run('extract', png)).code).toBe(1);
  }, 60_000);
});

describe('source attached to a PDF of several diagrams', () => {
  it('gives back each file and stops on a file with errors', async () => {
    const pdf = path.join(dir, 'set.pdf');
    const files = ['examples/checkout.draft', 'examples/emphasis.draft'];
    expect((await run('pdf', ...files, '-o', pdf, '--title', 'Set')).code).toBe(0);
    expect((await run('extract', `${pdf}#emphasis.draft`)).out).toBe(
      formatSource(fs.readFileSync(files[1], 'utf8')),
    );
    expect((await run('check', pdf, '--quiet')).code).toBe(0);
    const broken = write('broken.draft', 'diagram "B" version=1\nedge ab a -> b\n');
    expect((await run('pdf', files[0], broken, '-o', path.join(dir, 'no.pdf'))).code).toBe(1);
    expect(fs.existsSync(path.join(dir, 'no.pdf'))).toBe(false);
  }, 60_000);
});
