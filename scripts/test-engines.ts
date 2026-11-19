/**
 * Run the engine suites side by side: the layout and routing regressions, the brush regressions,
 * and parity with the original release in shares (`tests/engine-parity.ts --shard i/n`). The
 * comparisons are the ones the suites make when they run one after another; only the order
 * differs. Each process prints its output whole when it ends.
 *
 *   node scripts/test-engines.ts [--jobs N]   (default: one parity share per core)
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'tmp/verification-current');
const flag = process.argv.indexOf('--jobs');
const jobs = flag > 0 ? Number(process.argv[flag + 1]) : os.availableParallelism();
if (!Number.isInteger(jobs) || jobs < 1) throw Error('--jobs needs a whole number above 0.');
// Parity takes nearly all of the time, so it gets every core; the two short suites run beside it.
const shares = Math.min(jobs, 16);
const shareFile = (i: number) => path.join(outDir, `engine-parity-results-${i}.json`);

interface Suite {
  name: string;
  args: string[];
}
const suites: Suite[] = [
  { name: 'layout and routing', args: ['tests/engine-layout.mjs'] },
  { name: 'brush', args: ['tests/engine-sculpt.mjs'] },
  ...Array.from({ length: shares }, (_, i) => ({
    name: `parity share ${i + 1} of ${shares}`,
    args: ['tests/engine-parity.ts', ...(shares > 1 ? ['--shard', `${i}/${shares}`] : [])],
  })),
];

function run(suite: Suite) {
  return new Promise<boolean>(resolve => {
    const child = spawn(process.execPath, suite.args, { cwd: root });
    const chunks: Buffer[] = [];
    child.stdout.on('data', chunk => chunks.push(chunk));
    child.stderr.on('data', chunk => chunks.push(chunk));
    child.on('close', code => {
      process.stdout.write(Buffer.concat(chunks));
      if (code !== 0) console.error(`[engines] FAIL ${suite.name}: exit code ${code}`);
      resolve(code === 0);
    });
  });
}

interface ShareReport {
  fixtureCount: number;
  layoutAlgorithms: number;
  checks: number;
  groups: number;
  results: Array<{ name: string; status: string; group: number }>;
}
/** One report from the shares, in the order one process gives. Fails when a group is missing. */
function merge() {
  const parts = Array.from(
    { length: shares },
    (_, i) => JSON.parse(fs.readFileSync(shareFile(i), 'utf8')) as ShareReport,
  );
  const results = parts.flatMap(p => p.results).sort((a, b) => a.group - b.group),
    done = new Set(results.map(r => r.group)),
    groups = parts[0].groups;
  if (parts.some(p => p.groups !== groups) || done.size !== groups)
    throw Error(`Parity ran ${done.size} of ${groups} comparison groups.`);
  const checks = parts.reduce((n, p) => n + p.checks, 0),
    { fixtureCount, layoutAlgorithms } = parts[0];
  fs.writeFileSync(
    path.join(outDir, 'engine-parity-results.json'),
    JSON.stringify({ fixtureCount, layoutAlgorithms, checks, results }, null, 2),
  );
  for (let i = 0; i < shares; i++) fs.rmSync(shareFile(i));
  console.log(
    `[engine parity] PASS ${checks} parity comparisons across ${fixtureCount} fixtures and ${layoutAlgorithms} algorithms`,
  );
}

fs.mkdirSync(outDir, { recursive: true });
// A share's report left by an earlier run must not stand in for one that fails now.
for (const file of fs.readdirSync(outDir))
  if (/^engine-parity-results-\d+\.json$/.test(file)) fs.rmSync(path.join(outDir, file));
const started = Date.now();
const passed = await Promise.all(suites.map(run));
if (!passed.every(Boolean)) process.exitCode = 1;
else {
  if (shares > 1) merge();
  console.log(
    `[engines] PASS ${suites.length} processes in ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
}
