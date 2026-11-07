/**
 * Fail a pull request that changes what the `draftably` package ships but adds no changeset.
 *
 * The CLI's code lives in the private root package, so `changeset status` cannot tell when it
 * changed. This lists the branch's changes against the base and looks for shipped paths.
 *
 *   node scripts/check-changeset.ts [base]   (default: origin/main)
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** Paths that end up in the published package (see scripts/build-cli.ts). */
const PACKAGES: Record<string, { manifest: string; paths: RegExp[] }> = {
  draftably: {
    manifest: 'packages/cli/package.json',
    paths: [
      /^src\/(?!runtime\/)/,
      /^src\/runtime\/svg-renderer\.ts$/,
      /^index\.html$/,
      /^examples\//,
      /^docs\/DSL\.md$/,
      /^packages\/cli\//,
      /^scripts\/build-cli\.ts$/,
    ],
  },
  '@draftably/runtime': {
    manifest: 'packages/runtime/package.json',
    paths: [
      /^src\/(?:runtime|dsl|model|engines|assets\/fonts)\//,
      /^src\/lib\/font-data\.ts$/,
      /^packages\/runtime\//,
      /^scripts\/build-runtime\.ts$/,
      /^tsconfig\.runtime\.json$/,
    ],
  },
  '@draftably/markdown': {
    manifest: 'packages/markdown/package.json',
    paths: [/^packages\/markdown\//, /^scripts\/build-markdown\.ts$/],
  },
  '@draftably/editor': {
    manifest: 'packages/editor/package.json',
    paths: [
      /^src\/(?:editor|state|components|model|dsl|engines|lib|workers|styles)\//,
      /^packages\/editor\//,
      /^scripts\/build-editor\.ts$/,
      /^tsconfig\.editor\.json$/,
    ],
  },
  '@draftably/react': {
    manifest: 'packages/react/package.json',
    paths: [/^packages\/react\//],
  },
  '@draftably/solid': {
    manifest: 'packages/solid/package.json',
    // ./host is built from src/host.ts and the compiler and scene it loads.
    paths: [
      /^packages\/solid\//,
      /^src\/(?:host\.ts$|dsl\/|model\/|engines\/|components\/scene\/|runtime\/svg-renderer\.ts$)/,
      /^scripts\/build-frameworks\.ts$/,
      /^tsconfig\.host\.json$/,
    ],
  },
  '@draftably/vue': {
    manifest: 'packages/vue/package.json',
    paths: [/^packages\/vue\//],
  },
  '@draftably/svelte': {
    manifest: 'packages/svelte/package.json',
    paths: [/^packages\/svelte\//],
  },
  '@draftably/mermaid': {
    manifest: 'packages/mermaid/package.json',
    paths: [
      /^packages\/mermaid\//,
      /^src\/import\/(?:mermaid-|import-core)/,
      /^scripts\/build-mermaid\.ts$/,
      /^tsconfig\.mermaid\.json$/,
    ],
  },
};
/** Release bookkeeping, written by the Version Packages pull request. */
const BOOKKEEPING = [/^packages\/[^/]+\/CHANGELOG\.md$/];

const base = process.argv[2] ?? 'origin/main';
const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
const lines = (text: string) => text.split('\n').filter(Boolean);

const changed = lines(git('diff', '--name-only', `${base}...HEAD`));
const affected = Object.entries(PACKAGES)
  .filter(
    ([, pkg]) =>
      existsSync(pkg.manifest) &&
      changed.some(f => pkg.paths.some(p => p.test(f)) && !BOOKKEEPING.some(p => p.test(f))),
  )
  .map(([name]) => name);
const added = lines(git('diff', '--name-only', '--diff-filter=A', `${base}...HEAD`)).filter(
  f => /^\.changeset\/.+\.md$/.test(f) && !f.endsWith('README.md'),
);

const headers = added.map(
  file => /^---\s*\n([\s\S]*?)\n---/.exec(readFileSync(file, 'utf8'))?.[1] ?? '',
);
const released = new Set(
  headers.flatMap(header =>
    [...header.matchAll(/^['"]?([^'"\s:]+)['"]?:\s*(?:patch|minor|major)\s*$/gm)].map(
      match => match[1],
    ),
  ),
);
const empty = added.length > 0 && headers.some(header => !header.trim());
const missing = affected.filter(name => !released.has(name));

if (!affected.length) {
  console.log('No shipped files changed; no changeset needed.');
} else if (empty || !missing.length) {
  console.log(`Changeset found: ${added.join(', ')}`);
} else {
  console.error(`These packages have shipped changes without a matching changeset:
${missing.map(name => `  ${name}`).join('\n')}

Add one with:  pnpm changeset:add <patch|minor|major> "Release note" --package <name>
If the change needs no release (a refactor or internal tooling), add an empty one with:
  pnpm changeset add --empty`);
  process.exitCode = 1;
}
