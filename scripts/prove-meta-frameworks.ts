/**
 * Proves the host contract in the meta-frameworks: Next.js, SolidStart, Nuxt and SvelteKit.
 *
 *   pnpm runtime:build && pnpm editor:build && pnpm frameworks:build
 *   pnpm prove:meta [next solid-start nuxt sveltekit] [--write]
 *
 * Each app in `integration-examples/meta/<name>/` is small: a route that renders the framework's
 * proof page (`integration-examples/frameworks/<framework>/src/Proof.*`) with a server SVG and a
 * per-request CSP nonce. Each app holds a copy of its proof page, so it runs on its own;
 * `proof.config.json` names those copies, and the build and start commands. The script fails when
 * a copy differs from its source; `--write` refreshes the copies instead. It then copies the app
 * to `tmp/meta/<name>`, installs the packed packages, builds
 * for production, starts the server on a free port and runs `scripts/lib/host-proof.ts` against
 * it. Installs are slow: run it in the background. Screenshots go to `tmp/meta/`.
 */
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { proveHost, report, type HostProof } from './lib/host-proof.ts';

interface AppConfig {
  /** The wrapper package and the proof page to use: react, solid, vue or svelte. */
  framework: string;
  /** Proof page files, from `integration-examples/frameworks/<framework>/` to the app. */
  files: Record<string, string>;
  /** Where `proof.js` and `proof.css` go in the app. */
  shared: string;
  build: string[];
  start: string[];
  /** Path of the proof route. */
  path: string;
}

const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'tmp/meta');
const examples = path.join(root, 'integration-examples');
const APPS = ['next', 'solid-start', 'nuxt', 'sveltekit'];
const only = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const write = process.argv.includes('--write');
// Packs per process, so two runs for different apps can share tmp/meta.
const packs = path.join(out, 'packs', String(process.pid));
mkdirSync(packs, { recursive: true });

const pack = (dir: string) =>
  path.join(
    packs,
    JSON.parse(
      execFileSync('pnpm', ['pack', '--json', '--pack-destination', packs], {
        cwd: path.join(root, 'packages', dir),
        encoding: 'utf8',
      }),
    )
      .filename.split('/')
      .pop(),
  );
const runtime = pack('runtime');
const editor = pack('editor');

const freePort = () =>
  new Promise<number>(resolve => {
    const server = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });

/** The proof page copies the app holds, by path in the app, as they should read. */
function proofCopies(config: AppConfig): Map<string, string> {
  const copies = new Map<string, string>();
  for (const file of ['proof.js', 'proof.css'])
    copies.set(
      path.join(config.shared, file),
      readFileSync(path.join(examples, 'frameworks', file), 'utf8'),
    );
  for (const [from, to] of Object.entries(config.files)) {
    const text = readFileSync(path.join(examples, 'frameworks', config.framework, from), 'utf8');
    let rel = path.relative(path.dirname(to), path.join(config.shared, 'proof.js'));
    if (!rel.startsWith('.')) rel = `./${rel}`;
    if (!text.includes("'../../proof.js'")) throw new Error(`${from} does not import proof.js`);
    copies.set(to, text.replaceAll("'../../proof.js'", `'${rel}'`));
  }
  return copies;
}

/** Fails on a stale proof page copy in the example, or with `--write` refreshes it. */
function checkCopies(name: string, config: AppConfig) {
  const stale: string[] = [];
  for (const [file, text] of proofCopies(config)) {
    const dest = path.join(examples, 'meta', name, file);
    if (existsSync(dest) && readFileSync(dest, 'utf8') === text) continue;
    if (!write) {
      stale.push(file);
      continue;
    }
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, text);
  }
  if (stale.length)
    throw new Error(
      `${name}: stale proof page copies (${stale.join(', ')}); run pnpm prove:meta --write`,
    );
}

/** Copies the app, with its proof page, and points its dependencies at the packed packages. */
function prepare(name: string): { app: string; config: AppConfig } {
  const config = JSON.parse(
    readFileSync(path.join(examples, 'meta', name, 'proof.config.json'), 'utf8'),
  ) as AppConfig;
  checkCopies(name, config);
  const app = path.join(out, name);
  rmSync(app, { recursive: true, force: true });
  cpSync(path.join(examples, 'meta', name), app, {
    recursive: true,
    filter: src => !/node_modules|\.next|\.nuxt|\.output|\.svelte-kit|\/build$|\/dist$/.test(src),
  });
  const wrapper = pack(config.framework);
  const manifest = JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8'));
  // Point the app's own Draftably dependencies at the packs, and add none: a package the app
  // imports but does not list fails to install here, as it would for a reader.
  const packs: Record<string, string> = {
    [`@draftably/${config.framework}`]: wrapper,
    '@draftably/runtime': runtime,
    '@draftably/editor': editor,
  };
  for (const name of Object.keys(manifest.dependencies))
    if (name.startsWith('@draftably/')) {
      if (!packs[name]) throw new Error(`${name}: no pack for this dependency`);
      manifest.dependencies[name] = `file:${packs[name]}`;
    }
  writeFileSync(path.join(app, 'package.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    path.join(app, 'pnpm-workspace.yaml'),
    [
      'packages: []',
      'overrides:',
      `  '@draftably/runtime': 'file:${runtime}'`,
      `  '@draftably/editor': 'file:${editor}'`,
      // Only esbuild must run its build; other skipped builds (sharp, watchers) only warn.
      'strictDepBuilds: false',
      // Next.js and its compiler are large downloads.
      'fetchTimeout: 600000',
      'allowBuilds:',
      '  esbuild: true',
      '',
    ].join('\n'),
  );
  return { app, config };
}

async function serve(app: string, config: AppConfig, name: string) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production' };
  const [cmd, ...args] = config.start;
  const child = spawn(cmd, args, { cwd: app, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', d => (logs += d));
  child.stderr.on('data', d => (logs += d));
  const url = `http://127.0.0.1:${port}${config.path}`;
  for (let i = 0; i < 120; i++) {
    if (child.exitCode !== null)
      throw new Error(`${name}: the server exited\n${logs.slice(-3000)}`);
    const ok = await fetch(url).then(
      r => r.ok,
      () => false,
    );
    if (ok) return { url, stop: () => child.kill(), logs: () => logs };
    await new Promise(r => setTimeout(r, 500));
  }
  child.kill();
  throw new Error(`${name}: the server did not answer at ${url}\n${logs.slice(-3000)}`);
}

const browser = await chromium.launch();
const results: HostProof[] = [];
for (const name of only.length ? only : APPS) {
  const started = Date.now();
  try {
    const { app, config } = prepare(name);
    const run = (cmd: string[], env: Record<string, string> = {}) =>
      execFileSync(cmd[0], cmd.slice(1), {
        cwd: app,
        stdio: 'pipe',
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    run(['pnpm', 'install']);
    run(config.build, { NODE_ENV: 'production' });
    const server = await serve(app, config, name);
    try {
      const result = await proveHost(browser, server.url, name, out);
      const serverErrors = server
        .logs()
        .split('\n')
        .filter(l => /error/i.test(l));
      if (serverErrors.length) result.failed.push(`server log errors: ${serverErrors.join(' | ')}`);
      result.notes.push(`${Math.round((Date.now() - started) / 1000)} s with install and build`);
      results.push(result);
    } finally {
      server.stop();
    }
  } catch (error) {
    const e = error as Error & { stdout?: string; stderr?: string };
    const detail = `${e.stdout ?? ''}${e.stderr ?? ''}`.slice(-3000);
    results.push({
      name,
      passed: [],
      failed: [`${e.message.split('\n')[0]}\n${detail}`],
      notes: [],
    });
  }
}
await browser.close();
if (!report(results)) process.exit(1);
