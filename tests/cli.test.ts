import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from '../src/cli/main';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-cli-'));
afterEach(() => vi.restoreAllMocks());

/** Run the CLI and return everything it printed, and its exit code. */
async function run(...argv: string[]) {
  let out = '';
  const keep = (...parts: unknown[]) => void (out += parts.join(' ') + '\n');
  vi.spyOn(console, 'log').mockImplementation(keep);
  vi.spyOn(console, 'error').mockImplementation(keep);
  return { code: await main(argv), out };
}

const write = (name: string, text: string) => {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

const good = write(
    'set/good.draft',
    'diagram "Good" version=1\nnode a "A"\nnode b "B"\nedge e a -> b\n',
  ),
  bad = write('set/bad.draft', 'diagram "Bad" version=1\nnode a "A"\nedge e a -> zz\n');

describe('cli', () => {
  it('prints one section of the guide, or lists the topics for an unknown one', async () => {
    const legend = await run('docs', 'legend');
    expect(legend.out).toMatch(/^### Legend/);
    expect(legend.out).not.toContain('## Layout engines');
    const unknown = await run('docs', 'nope');
    expect(unknown.code).toBe(1);
    expect(unknown.out).toContain('Themes and colors');
  });

  it('checks every file given and fails when any one fails', async () => {
    const { code, out } = await run('check', good, bad);
    expect(code).toBe(1);
    expect(out).toContain(`${good}: OK`);
    expect(out).toContain(`${bad}: error`);
    expect(out).toContain('1 of 2 files have errors.');
    expect((await run('check', good)).code).toBe(0);
  });

  it('checks the .draft files in a folder', async () => {
    const { code, out } = await run('check', path.join(dir, 'set'));
    expect(code).toBe(1);
    expect(out.indexOf('bad.draft')).toBeLessThan(out.indexOf('good.draft'));
  });

  it('prints help for a command instead of running it', async () => {
    for (const command of ['open', 'vary', 'check']) {
      const { code, out } = await run(command, '--help');
      expect(code).toBe(0);
      expect(out).toMatch(new RegExp(`^Usage:\\n  ${command} `));
    }
  });

  it('prints its version', async () => {
    const { code, out } = await run('--version');
    expect(code).toBe(0);
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('leaves info notes out with --quiet', async () => {
    const noisy = write(
      'noisy.draft',
      'diagram "N" version=1\nnode a "A"\nnode b "B"\nedge e a -> b\nlayout root flow\nstay a x=0 y=0\nstay b x=30 y=10\n',
    );
    expect((await run('check', noisy)).out).toMatch(/^info/m);
    expect((await run('check', noisy, '--quiet')).out).not.toMatch(/^info/m);
  });
});

describe('check --metrics', () => {
  it('prints what vary measures and reads --fit without taking it for a file', async () => {
    const { code, out } = await run('check', good, '--metrics', '--fit', 'tall');
    expect(code).toBe(0);
    expect(out).toMatch(/^Metrics: \d+×\d+ \(aspect [\d.]+\), 0 crossings/m);
    expect(out).toContain('[aspect]');
  });

  it('weighs the findings with --score, and ranks several files by it', async () => {
    const sprawl = write(
      'score/sprawl.draft',
      'diagram "S" version=1\nnode a "A"\nnode b "B"\nedge e a -> b\npin a x=0 y=0\npin b x=900 y=500\n',
    );
    const { code, out } = await run('check', good, sprawl, '--score');
    expect(code).toBe(0);
    expect(out).toMatch(/: Score: 0\.00 \(0 points/);
    const ranked = out.slice(out.indexOf('Ranked by score:'));
    expect(ranked.indexOf(sprawl)).toBeLessThan(ranked.indexOf(good));
    const { out: json } = await run('inspect', sprawl, '--json', '--metrics', '--score');
    expect(JSON.parse(json).score.counts['frame-sprawl']).toBe(1);
  });

  it('adds the same findings to inspect --json --metrics', async () => {
    const { out } = await run('inspect', good, '--json', '--metrics', '--fit', 'tall');
    const geometry = JSON.parse(out);
    expect(geometry.metrics.width).toBeGreaterThan(0);
    expect(geometry.findings.map((d: { code: string }) => d.code)).toContain('aspect');
  });
});
