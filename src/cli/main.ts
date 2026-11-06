/**
 * draftably command line: check, format and inspect `.draft` files, or edit them in the viewer.
 * Built with `vite build --ssr` so it shares the editor's model code; run it with `pnpm draftably`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { isMainThread, workerData } from 'node:worker_threads';
import { compile, type Diagnostic } from '../dsl/compile';
import { compareDetailed } from '../dsl/compare';
import { checkScene } from '../dsl/check';
import { hintMoves, sceneConflicts } from '../dsl/conflicts';
import { statusLabel, usedStatuses, withState } from '../model/status';
import type { Diagram } from '../model/types';
import { canonicalGeometry, projectScene } from '../dsl/project';
import { DslError, formatSource } from '../dsl/syntax';
import { embedSvgSource, isImageName, readImageSource } from '../model/embed';
import { renderSvg } from './svg';
import { draw, FITS, type Fit, type Metrics } from './variants';
import { cliVersion, staleSkills } from './skill';
import { svgSize } from './png';
import { linkNotes, svgHref } from './links';
import { updateNotice } from './update';

const USAGE = `Usage: draftably <command> <file.draft> [options]

Any <file> may also be a PNG, SVG or PDF that draftably exported: its embedded source is read.
A PDF holds several; name one as diagrams.pdf#name.draft, or check reads them all.

Commands:
  import <file> [--output <new.draft>] [--from dot|mermaid|d2] [--accept-lossy]
                            Convert a text diagram to a new .draft file, or print native source.
                            Warnings require --accept-lossy. The input stays unchanged.
  migrate <file|folder|glob>…
       [--write]            Rewrite \`\`\`mermaid fences that hold a flowchart or sequence diagram
       [--accept-lossy]     in Markdown files as \`\`\`draft fences. Other Mermaid charts stay. Prints
                            each file's fences and the importer's warnings without changing
                            anything; --write rewrites the files. A fence with warnings stays
                            Mermaid unless --accept-lossy. A folder searches its .md and .mdx files.
  check <file>…             Report source errors, layout diagnostics and drawing conflicts
       [--hints]            (a line through a box, overlapping boxes or labels). Exits 1 on
       [--quiet]            errors. Several files or a folder check each .draft in turn.
       [--metrics]          --metrics also measures the drawing as vary does (size, aspect,
       [--fit <shape>]      crossings, bends, line length) and warns on crossings, detours,
                            stranded nodes and an extreme aspect, or one far from --fit.
                            --hints adds how far each refinement moved its target; --quiet
                            leaves out info notes.
  format <file> [--write]   Print the formatted source, or rewrite the file in place.
       [--drop-stale]       Also remove refinements that no longer hold: ones check warns gave
                            way, and stays the arrangement outgrew. Lists them on stderr.
  inspect <file> [--json]   Print canonical node and route geometry. --json prints it on one
       [--hints]            line; with --hints it adds the unrefined position (raw) of every
       [--metrics]          node a refinement moved. --metrics adds a metrics object with
                            what vary measures: size, crossings, bends, length, warnings, and
                            a findings list of what check --metrics reports.
  inspect <file> --svg      Print a plain SVG drawing of the compiled diagram.
       [--state <id>]       Draw it in one emphasis state (also with --png).
       [--states]           Draw every emphasis state as its own aligned panel.
  inspect <file> --png <out.png> [--scale 2] [--max-width <px>]
                            Save the drawing as a PNG (needs Chrome or Chromium). --max-width
                            lowers the scale so the image is at most that many pixels wide.
                            PNG and SVG output embed the source; --no-source leaves it out.
  inspect <file> --clipboard [--scale 2]
                            Put the drawing on the macOS clipboard: a PNG with its source, and
                            the SVG as text.
  pdf <file|folder>… -o <out.pdf>
                            Save the diagrams as one vector PDF, one per page, each with its
       [--order <how>]      heading and key (needs Chrome or Chromium). --order: given (default;
                            a folder's files by name), name or title. --page: fit (default,
       [--page <size>]      each page the diagram's size), letter, a4 or slide; a fixed size
                            scales the drawing to fit. --title adds a cover and contents.
       [--title "…"]        --states prints a page per emphasis state. Each file's source is
       [--states]           attached (--no-source leaves it out). Stops on a file with errors.
  compare <before> <after>  Print one file holding both versions, with + - ~ change marks.
       [--write <file>]     Save it instead of printing it.
       [--svg]              Print it as an SVG drawing instead.
       [--png <out.png>]    Save it as a PNG instead; --scale as for inspect.
  vary <file>               Try layout variants, measure each one and rank them against the
       [--out <folder>]     file as it is. Writes contact-sheet.png, v0.png (current), v1.png …
       [--limit N]          and variants.json to <name>.vary/ beside the file (or --out), and
       [--json]             prints a table; --json prints variants.json instead. Keeps the
                            best 4 that differ unless --limit is given (1 to 12).
       [--try key=a,b]      Try exactly these values, in order; a second --try makes a grid
                            (12 at most). --try key alone uses the viewer Compare's steps.
                            Keys: engine, direction, layout engine and routing settings.
       [--grid]             Try layered, compound-flow, flow (and tree) reading right, down.
       [--scope <group>]    Vary that group's layout line instead of the root's.
       [--fit <shape>]      Aim for a shape: wide, slide, square, page or tall. Changes what
                            is tried and what ranks first.
       [--prefer <goal>]    Break ties toward fewer-crossings (default), compact or stable
                            (least movement from the current drawing).
       [--from <id>]        Search around a variant of the last run: its other direction,
                            ordering, folding, gap steps and router settings.
       [--budget <time>]    Stop trying new variants after this long (60s, 2m) and rank the
                            ones found. Each variant prints a line to stderr as it finishes.
                            A lanes root stays as v0; --grid and --try engine try engines.
  vary <file> --apply <id>  Write variant <id> from the last run (or best) into the file,
                            print the lines it changed, then check the file.
  set <file> <id> key=value…  Change a declaration: label="…" replaces its label, color=teal
                            sets an attribute, color= removes it. <id> may be node.x,
                            group.x or edge.x when a bare id is ambiguous.
  rm <file> <id>…           Remove nodes, groups or edges, with their edges, refinements and
                            state mentions; a group's members move to its container.
  mv <file> <old> <new>     Rename an id everywhere it is used.
                            set, rm and mv rewrite the file through the formatter, then check it.
  extract <image>           Print the .draft source embedded in a PNG, SVG or PDF export.
       [--write <file>]     Save it instead of printing it.
  open [file|folder]        Edit diagrams in the viewer; saves go back to the file.
       [--port N]           Without a file, start on a picker for the folder's diagrams,
                            a new diagram, or an example. --no-open skips the browser.
                            Uses the first free port from 5180 unless --port is given;
                            --port 0 picks any free port. The Viewer line has the URL.
       [--replace]          Without --port, a viewer already serving the folder is reused;
       [--status]           --replace stops it and starts this version. --status lists the
                            running viewers: URL, folder, version and pid. A viewer stops
                            after 2 hours with no open tab, or when its folder is deleted.
  docs [topic]              Print the language guide (DSL.md) for this version: its contents,
                            the sections whose heading matches topic (docs legend, docs
                            count), or all of it with docs all.
  skill install             Install the agent skill for writing .draft files into
       [--global]           ./.claude/skills/draftably, or ~/.claude/skills with --global.
       [--dir <folder>]     --dir picks another skills folder (e.g. .agents/skills);
       [--force]            --force replaces an existing copy.
  skill print               Print the skill's SKILL.md.
  --version                 Print the installed version.

Any command with --help prints its own part of this text. Once a day the CLI checks npm for a
newer version and notes it on stderr; set DRAFTABLY_NO_UPDATE_CHECK=1 to skip that.
`;

/** The usage lines for `command`, or all of them. */
export function usage(command?: string) {
  const blocks = USAGE.split(/\n(?= {2}[a-z])/).filter(b => b.startsWith(`  ${command} `));
  return blocks.length ? `Usage:\n${blocks.join('\n')}` : USAGE;
}

const describe = (d: Diagnostic) =>
  `${d.level.padEnd(7)} ${d.line ? `line ${d.line}: ` : ''}${d.message}${d.level === 'warning' ? ` [${d.code}]` : ''}`;

/** `check --hints`: one row per refinement target, then objects pushed by them. */
function hintTable({ rows, pushed }: Awaited<ReturnType<typeof hintMoves>>) {
  if (!rows.length) return 'No refinements.';
  const xy = (p: { x: number; y: number }) => `${Math.round(p.x)},${Math.round(p.y)}`;
  const table = [
    ['id', 'refinement', 'raw x,y', 'final x,y', 'delta'],
    ...rows.map(r => [r.id, `${r.hint} line ${r.line}`, xy(r.raw), xy(r.final), `${r.delta}px`]),
  ];
  const widths = table[0].map((_, i) => Math.max(...table.map(row => row[i].length)));
  const lines = table.map(row =>
    row
      .map((c, i) => c.padEnd(widths[i]))
      .join('  ')
      .trimEnd(),
  );
  if (pushed.length)
    lines.push(`Also moved by refinements: ${pushed.map(p => `${p.id} ${p.delta}px`).join(', ')}.`);
  return lines.join('\n');
}

/** A file's source; a PNG, SVG or PDF export gives the source embedded in it. */
async function read(file: string | undefined) {
  if (!file) throw new UsageError('A .draft file is required.');
  const pdf = /^(.*\.pdf)(?:#(.+))?$/i.exec(file);
  if (pdf) {
    const sources = await pdfSources(pdf[1]),
      picked = pdf[2] ? sources.filter(s => s.name === pdf[2]) : sources;
    if (picked.length === 1) return picked[0].source;
    throw Error(
      picked.length
        ? `${pdf[1]} holds ${sources.length} diagrams; name one as ${pdf[1]}#<name>: ${sources.map(s => s.name).join(', ')}.`
        : `${pdf[1]} has no diagram ${pdf[2]}. It holds: ${sources.map(s => s.name).join(', ')}.`,
    );
  }
  if (!isImageName(file)) return fs.readFileSync(path.resolve(file), 'utf8');
  const source = await readImageSource(fs.readFileSync(path.resolve(file)));
  if (source === null)
    throw Error(
      `${file} has no embedded draftably source. It was exported with --no-source, by another tool, or recompressed by a host.`,
    );
  return source;
}

class UsageError extends Error {}

/** The sources attached to a PDF export; throws when it has none. */
async function pdfSources(file: string) {
  const { readPdfSources } = await import('./pdf');
  const sources = await readPdfSources(fs.readFileSync(path.resolve(file)));
  if (!sources.length)
    throw Error(
      `${file} has no embedded draftably source. It was exported with --no-source or by another tool.`,
    );
  return sources;
}

/** Every value given for a repeatable option, such as `--try a --try b`. */
function options(args: string[], name: string) {
  return args.flatMap((a, i) => {
    if (a !== name) return [];
    const value = args[i + 1];
    if (!value || value.startsWith('--')) throw new UsageError(`${name} needs a value.`);
    return [value];
  });
}

/** The value after `name` in `args`, if the option is given. */
function option(args: string[], name: string) {
  const at = args.indexOf(name);
  if (at < 0) return undefined;
  const value = args[at + 1];
  if (!value || value.startsWith('--')) throw new UsageError(`${name} needs a value.`);
  return value;
}

/** `--budget 90s`, `2m` or `5000ms` in milliseconds; a bare number is seconds. */
function parseBudget(value: string | undefined) {
  if (value === undefined) return undefined;
  const m = /^(\d+(?:\.\d+)?)(ms|s|m)?$/.exec(value);
  if (!m) throw new UsageError('--budget must be a time such as 60s, 2m or 5000ms.');
  return Number(m[1]) * { ms: 1, s: 1000, m: 60_000 }[m[2] ?? 's']!;
}

/** `--fit <shape>`, checked. */
function fitOption(args: string[]) {
  const fit = option(args, '--fit');
  if (fit !== undefined && !(fit in FITS))
    throw new UsageError(`--fit must be ${Object.keys(FITS).join(', ')}.`);
  return fit as Fit | undefined;
}

const counted = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** One line of what `vary` measures: size and aspect, crossings, bends, line length, warnings. */
const metricsLine = (m: Omit<Metrics, 'moved'>) =>
  `Metrics: ${m.width}×${m.height} (aspect ${(m.width / m.height).toFixed(2)}), ${counted(m.crossings, 'crossing')}, ${counted(m.bends, 'bend')}, ${m.length}px of lines, ${counted(m.warnings, 'warning')}.`;

/** The document in emphasis state `id`, or as it is without one. */
function drawnState(doc: Diagram, id: string | undefined) {
  if (id === undefined) return doc;
  const ids = doc.appearance.states?.map(s => s.id) ?? [];
  if (!ids.includes(id))
    throw new UsageError(
      ids.length ? `No state ${id}. States: ${ids.join(', ')}.` : 'The file has no state lines.',
    );
  return withState(doc, id);
}

/** Save `svg` as a PNG when `--png` is given, with `source` in it; true if it was. */
async function maybePng(svg: () => string | Promise<string>, args: string[], source?: string) {
  const out = option(args, '--png');
  if (!out) return false;
  let scale = Number(option(args, '--scale') ?? 2);
  if (!(scale > 0 && scale <= 8)) throw new UsageError('--scale must be from 0 to 8.');
  const maxWidth = option(args, '--max-width');
  if (maxWidth !== undefined && !(Number(maxWidth) >= 1))
    throw new UsageError('--max-width must be a number of pixels.');
  const drawing = await svg();
  if (maxWidth !== undefined) scale = Math.min(scale, Number(maxWidth) / svgSize(drawing).w);
  const { writePng } = await import('./png');
  const { w, h } = await writePng(drawing, out, scale, source);
  console.log(`Wrote ${out} (${w}×${h}).`);
  return true;
}

/** Check one file and print its notes, each prefixed by `tag`; 1 if it has errors. */
/** `check --metrics`: what to measure, and the image shape to hold it to. */
interface MetricsOption {
  fit?: Fit;
}

async function checkFile(
  file: string,
  tag: string,
  hints: boolean,
  quiet: boolean,
  metrics?: MetricsOption,
) {
  const source = await read(file),
    scene = await compile(source);
  // The drawing is measured only for a file that compiles cleanly; errors come first.
  const { diagnostics, metrics: measured } = checkScene(scene, {
    metrics: !!metrics,
    fit: metrics?.fit,
    notes: linkNotes(scene, file),
  });
  const errors = diagnostics.filter(d => d.level === 'error'),
    warnings = diagnostics.filter(d => d.level === 'warning');
  for (const d of diagnostics) if (!quiet || d.level !== 'info') console.log(tag + describe(d));
  if (hints) console.log(hintTable(await hintMoves(source, scene)));
  if (measured) console.log(tag + metricsLine(measured));
  const nodes = scene.objects.filter(o => o.type === 'node').length;
  console.log(
    `${tag}${errors.length ? 'Problems' : warnings.length ? 'Warnings' : 'OK'}: ${counted(nodes, 'node')}, ${counted(scene.objects.length - nodes, 'group')}, ${counted(scene.edges.length, 'connection')}.`,
  );
  return errors.length ? 1 : 0;
}

export async function main(argv: string[]): Promise<number> {
  const [command, file, ...rest] = argv;
  if (['--version', '-v', 'version'].includes(command)) {
    console.log(cliVersion());
    return 0;
  }
  // Before anything runs: `open --help` must not start a server, `vary --help` is not a file.
  if (argv.includes('--help') || argv.includes('-h') || command === 'help') {
    console.log(usage(command === 'help' ? file : command));
    return 0;
  }
  const flag = (name: string) => rest.includes(name);
  /** The source to embed in an exported image, unless `--no-source` is given. */
  const embed = (source: string) => (flag('--no-source') ? undefined : formatSource(source));
  const withSource = (svg: string, source: string) => {
    const kept = embed(source);
    return kept === undefined ? svg : embedSvgSource(svg, kept);
  };
  try {
    switch (command) {
      case 'import': {
        if (!file || file.startsWith('--'))
          throw new UsageError('import needs a foreign diagram file.');
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === '--accept-lossy') continue;
          if (rest[i] === '--from' || rest[i] === '--output') {
            if (!rest[i + 1] || rest[i + 1].startsWith('--'))
              throw new UsageError(`${rest[i]} needs a value.`);
            i++;
          } else throw new UsageError(`Unknown import option: ${rest[i]}`);
        }
        const { importFile } = await import('./import');
        return await importFile(
          file,
          {
            from: option(rest, '--from'),
            output: option(rest, '--output'),
            acceptLossy: flag('--accept-lossy'),
          },
          new URL('./main.js', import.meta.url),
        );
      }
      case 'migrate': {
        const args = [file, ...rest].filter((a): a is string => !!a);
        const unknown = args.find(
          a => a.startsWith('--') && !['--write', '--accept-lossy'].includes(a),
        );
        if (unknown) throw new UsageError(`Unknown migrate option: ${unknown}`);
        const patterns = args.filter(a => !a.startsWith('--'));
        if (!patterns.length) throw new UsageError('migrate needs Markdown files or a folder.');
        const { migrateFiles } = await import('./migrate');
        return await migrateFiles(
          patterns,
          { write: flag('--write'), acceptLossy: flag('--accept-lossy') },
          new URL('./main.js', import.meta.url),
        );
      }
      case 'check': {
        const args = [file, ...rest],
          files = args.filter(
            (a, i): a is string => !!a && !a.startsWith('--') && args[i - 1] !== '--fit',
          );
        if (!files.length) throw new UsageError('A .draft file is required.');
        const all = files.flatMap(f =>
          fs.statSync(path.resolve(f), { throwIfNoEntry: false })?.isDirectory()
            ? fs
                .readdirSync(path.resolve(f))
                .filter(n => n.endsWith('.draft'))
                .sort()
                .map(n => path.join(f, n))
            : [f],
        );
        // A PDF export checks each diagram it holds.
        for (let i = all.length - 1; i >= 0; i--)
          if (/\.pdf$/i.test(all[i]))
            all.splice(i, 1, ...(await pdfSources(all[i])).map(s => `${all[i]}#${s.name}`));
        if (!all.length) throw new UsageError(`No .draft files in ${files.join(', ')}.`);
        let failed = 0;
        for (const f of all) {
          // With several files each line names its file, so a loop can't mistake one for all.
          const tag = all.length > 1 || files[0] !== all[0] ? `${f}: ` : '';
          try {
            failed += await checkFile(
              f,
              tag,
              flag('--hints'),
              flag('--quiet'),
              flag('--metrics') ? { fit: fitOption(rest) } : undefined,
            );
          } catch (error) {
            if (!tag) throw error;
            const message = error instanceof Error ? error.message : String(error);
            console.log(`${tag}error   ${message}`);
            failed++;
          }
        }
        // On stderr, so a script reading the results is unaffected.
        for (const stale of staleSkills(process.cwd()))
          console.error(
            `note    The draftably skill in ${stale.path} differs from this version (${cliVersion()}). Update it: ${stale.fix}`,
          );
        if (all.length > 1)
          console.log(
            `${failed ? `${failed} of ${all.length}` : `All ${all.length}`} files ${failed ? 'have errors' : 'passed'}.`,
          );
        return failed ? 1 : 0;
      }
      case 'format': {
        let source = await read(file);
        if (flag('--drop-stale')) {
          const scene = await compile(source),
            stays = scene.model.hints.filter(h => h.type === 'stay');
          // Refinements that gave way past the warning, and stays the arrangement outgrew.
          const lines = new Set(
            scene.diagnostics.flatMap(d =>
              d.code === 'relaxed' && d.level === 'warning' && d.line
                ? [d.line]
                : d.code === 'stale-stay'
                  ? stays.filter(h => d.ids.includes(h.id)).map(h => h.line)
                  : [],
            ),
          );
          const all = source.split('\n');
          for (const n of [...lines].sort((a, b) => a - b))
            console.error(`Dropped line ${n}: ${all[n - 1].trim()}`);
          if (!lines.size) console.error('No stale refinements.');
          source = all.filter((_, i) => !lines.has(i + 1)).join('\n');
        }
        const formatted = formatSource(source);
        if (flag('--write')) {
          if (isImageName(file!))
            throw new UsageError('format --write rewrites a .draft file only.');
          fs.writeFileSync(path.resolve(file), formatted);
          console.log(`Formatted ${file}.`);
        } else process.stdout.write(formatted);
        return 0;
      }
      case 'inspect': {
        const source = await read(file),
          scene = await compile(source),
          doc = drawnState(projectScene(scene), option(rest, '--state')),
          opts = { href: svgHref(scene, file), states: flag('--states') };
        if (opts.states) {
          if (!doc.appearance.states?.length) throw new UsageError('The file has no state lines.');
          if (doc.appearance.compare)
            throw new UsageError('--states draws panels, and so does compare; use one at a time.');
        }
        if (flag('--clipboard')) {
          const scale = Number(option(rest, '--scale') ?? 2);
          if (!(scale > 0 && scale <= 8)) throw new UsageError('--scale must be from 0 to 8.');
          const { copyToClipboard } = await import('./png');
          const svg = renderSvg(doc, opts),
            { w, h } = await copyToClipboard(svg, withSource(svg, source), scale, embed(source));
          console.log(`Copied the drawing as a PNG (${w}×${h}) and SVG text.`);
          return 0;
        }
        if (await maybePng(() => renderSvg(doc, opts), rest, embed(source))) return 0;
        if (flag('--svg')) process.stdout.write(withSource(renderSvg(doc, opts), source));
        else if (flag('--json') && flag('--hints')) {
          const geometry = canonicalGeometry(doc),
            { rows, pushed } = await hintMoves(source, scene);
          const raw = new Map([...rows, ...pushed].filter(r => r.delta).map(r => [r.id, r.raw]));
          for (const n of geometry.nodes)
            if (raw.has(n.id)) Object.assign(n, { raw: raw.get(n.id) });
          console.log(JSON.stringify(geometry));
        } else {
          // With --metrics, the findings `check --metrics` prints, beside what vary measures.
          const geometry = flag('--metrics')
            ? {
                ...canonicalGeometry(doc),
                metrics: (await draw(source)).metrics,
                findings: checkScene(scene, { metrics: true, fit: fitOption(rest) }).diagnostics,
              }
            : canonicalGeometry(doc);
          console.log(JSON.stringify(geometry, null, flag('--json') ? 0 : 2));
        }
        return 0;
      }
      case 'compare': {
        const { merged, moved, reordered, unshown } = compareDetailed(
          await read(file),
          await read(rest[0]),
        );
        const doc = projectScene(await compile(merged)),
          draw = async () => renderSvg(doc);
        const out = option(rest, '--write');
        // The size of the change goes to stderr, so stdout stays a clean file or drawing.
        const sizes = usedStatuses(doc)
          .filter(s => s.status !== 'context')
          .map(statusLabel)
          .concat(reordered ? ['message order changed'] : []);
        if (sizes.length || !unshown.length)
          console.error(sizes.length ? sizes.join(', ') + '.' : 'No changes.');
        if (unshown.length)
          console.error(
            `Changes with no old version to draw: ${unshown.join(', ')}. Both panels draw the new version.`,
          );
        if (moved.length)
          console.error(
            `Groups moved to another container: ${moved.join(', ')}. Both panels draw them where they are now.`,
          );
        // A picture leaves stderr behind, so panels carry the same list beside the older label.
        if (unshown.length && doc.appearance.compare)
          doc.appearance.compare.undrawn = unshown.join(', ');
        if (await maybePng(draw, rest, embed(merged))) return 0;
        if (out) {
          fs.writeFileSync(path.resolve(out), merged);
          console.log(`Wrote ${out}.`);
        } else if (flag('--svg')) process.stdout.write(withSource(await draw(), merged));
        else process.stdout.write(merged);
        return 0;
      }
      case 'vary': {
        const source = await read(file),
          out = option(rest, '--out'),
          pick = option(rest, '--apply');
        const { applyVariant, runVary, savedVariant } = await import('./vary');
        const { FITS, parseTry } = await import('./variants');
        if (pick) {
          if (isImageName(file!)) throw new UsageError('vary --apply rewrites a .draft file only.');
          const done = applyVariant(file!, source, pick, out);
          console.log(done.changes.length ? `Applied ${done.id}:\n${done.text}` : done.text);
          if (!done.changes.length) return 0;
          const scene = await compile(fs.readFileSync(path.resolve(file!), 'utf8'));
          const notes = [...scene.diagnostics, ...sceneConflicts(scene)];
          for (const d of notes)
            if (!flag('--quiet') || d.level !== 'info') console.log(describe(d));
          const errors = notes.filter(d => d.level === 'error').length,
            warnings = notes.filter(d => d.level === 'warning').length;
          console.log(`Check: ${errors ? 'Problems' : warnings ? 'Warnings' : 'OK'}.`);
          return errors ? 1 : 0;
        }
        const limit = option(rest, '--limit'),
          axes = options(rest, '--try').map(parseTry);
        const fit = option(rest, '--fit'),
          prefer = option(rest, '--prefer'),
          from = option(rest, '--from');
        if ([axes.length > 0, flag('--grid'), !!from].filter(Boolean).length > 1)
          throw new UsageError('Use one of --try, --grid and --from.');
        if (fit !== undefined && !(fit in FITS))
          throw new UsageError(`--fit must be ${Object.keys(FITS).join(', ')}.`);
        if (prefer !== undefined && !['fewer-crossings', 'compact', 'stable'].includes(prefer))
          throw new UsageError('--prefer must be fewer-crossings, compact or stable.');
        if (
          limit !== undefined &&
          !(Number.isInteger(Number(limit)) && +limit >= 1 && +limit <= 12)
        )
          throw new UsageError('--limit must be a whole number from 1 to 12.');
        await runVary(file!, source, {
          out,
          limit: limit === undefined ? undefined : Number(limit),
          json: flag('--json'),
          noSource: flag('--no-source'),
          axes,
          grid: flag('--grid'),
          scope: option(rest, '--scope'),
          fit: fit as keyof typeof FITS | undefined,
          budget: parseBudget(option(rest, '--budget')),
          prefer: prefer as 'fewer-crossings' | 'compact' | 'stable' | undefined,
          ...(from ? { from: savedVariant(file!, source, from, out) } : {}),
        });
        return 0;
      }
      case 'set':
      case 'rm':
      case 'mv': {
        if (!file || isImageName(file)) throw new UsageError(`${command} rewrites a .draft file.`);
        const { removeIds, renameId, setFields } = await import('./edit');
        const source = await read(file),
          args = rest.filter(a => !a.startsWith('--'));
        let next: string;
        if (command === 'set') next = setFields(source, args[0] ?? '', args.slice(1));
        else if (command === 'rm') next = removeIds(source, args);
        else {
          if (args.length !== 2) throw new UsageError('mv takes the old id and the new one.');
          next = renameId(source, args[0], args[1]);
        }
        fs.writeFileSync(path.resolve(file), next);
        console.log(
          command === 'set'
            ? `Set ${args.slice(1).join(' ')} on ${args[0]}.`
            : command === 'rm'
              ? `Removed ${args.join(', ')} and every line that used ${args.length > 1 ? 'them' : 'it'}.`
              : `Renamed ${args[0]} to ${args[1]}.`,
        );
        return checkFile(file, '', false, flag('--quiet'));
      }
      case 'pdf': {
        const args = [file, ...rest].filter((a): a is string => !!a),
          out = option(args, '-o') ?? option(args, '--out'),
          order = option(args, '--order') ?? 'given',
          page = option(args, '--page') ?? 'fit';
        const { buildPdf, pdfInputs, PDF_ORDERS, PDF_PAGES } = await import('./pdf');
        if (!out) throw new UsageError('pdf needs -o <out.pdf>.');
        if (!PDF_ORDERS.includes(order as never))
          throw new UsageError(`--order must be ${PDF_ORDERS.join(', ')}.`);
        if (!PDF_PAGES.includes(page as never))
          throw new UsageError(`--page must be ${PDF_PAGES.join(', ')}.`);
        const valued = new Set(['-o', '--out', '--order', '--page', '--title']),
          targets = args.filter((a, i) => !a.startsWith('-') && !valued.has(args[i - 1] ?? ''));
        if (!targets.length) throw new UsageError('pdf needs .draft files or a folder.');
        const inputs = pdfInputs(targets);
        if (!inputs.length) throw new UsageError(`No .draft files in ${targets.join(', ')}.`);
        const { bytes, pages } = await buildPdf(inputs, {
          order: order as 'given',
          page: page as 'fit',
          title: option(args, '--title'),
          states: args.includes('--states'),
          source: !args.includes('--no-source'),
        });
        fs.writeFileSync(path.resolve(out), bytes);
        const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
        console.log(`Wrote ${out} (${n(pages, 'page')}, ${n(inputs.length, 'diagram')}).`);
        return 0;
      }
      case 'extract': {
        if (!file || !(isImageName(file) || /\.pdf(#|$)/i.test(file)))
          throw new UsageError('extract needs a .png, .svg or .pdf file.');
        const source = await read(file),
          out = option(rest, '--write');
        if (out) {
          fs.writeFileSync(path.resolve(out), source);
          console.log(`Wrote ${out}.`);
        } else process.stdout.write(source);
        return 0;
      }
      case 'open': {
        const { openSession, runningViewers, servedAt, stopViewer, viewerUrl } =
          await import('./open');
        const args = [file, ...rest].filter((a): a is string => !!a);
        if (args.includes('--status')) {
          const viewers = runningViewers();
          if (!viewers.length) console.log('No viewers running.');
          for (const v of viewers)
            console.log(`${viewerUrl(v)}  ${v.root}  draftably ${v.version}  pid ${v.pid}`);
          return 0;
        }
        const at = args.indexOf('--port');
        const port = at >= 0 ? Number(args[at + 1]) : 5180;
        if (!Number.isInteger(port) || port < 0 || port > 65535)
          throw new UsageError('--port must be an integer from 0 to 65535.');
        let target = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--port');
        // A PDF opens as a folder of its diagrams beside it, named after the PDF.
        if (target && /\.pdf$/i.test(target)) {
          const folder = target.replace(/\.pdf$/i, '');
          fs.mkdirSync(folder, { recursive: true });
          for (const { name, source } of await pdfSources(target)) {
            const draft = path.join(folder, name);
            if (fs.existsSync(draft) && fs.readFileSync(draft, 'utf8') !== source)
              throw Error(`${draft} already exists with other content. Move it, then open again.`);
            if (!fs.existsSync(draft)) fs.writeFileSync(draft, source);
          }
          console.log(`Wrote the diagrams in ${target} to ${folder}/.`);
          target = folder;
        }
        // An image opens through a .draft beside it, since the viewer saves edits to a file.
        if (target && isImageName(target)) {
          const source = await read(target),
            draft = target.replace(/\.\w+$/, '.draft');
          if (!fs.existsSync(draft)) {
            fs.writeFileSync(draft, source);
            console.log(`Wrote ${draft} from the source in ${target}.`);
          } else if (fs.readFileSync(draft, 'utf8') !== source)
            throw Error(
              `${draft} already exists with other content. Use extract --write to pick a new name.`,
            );
          target = draft;
        }
        // Reuse a viewer that already serves this folder; replace it only when asked.
        // An explicit --port asks for a new viewer there, so only an open without one reuses.
        const served = servedAt(path.resolve(target ?? '.')),
          same = at < 0 ? runningViewers().find(v => v.root === served.root) : undefined;
        if (same && args.includes('--replace')) {
          await stopViewer(same);
          console.log(`Stopped the viewer from draftably ${same.version} (pid ${same.pid}).`);
        } else if (same) {
          const url = viewerUrl(same, served.file);
          console.log(
            same.version === cliVersion()
              ? `A viewer already serves ${same.root}.\nViewer: ${url}`
              : `A viewer from draftably ${same.version} serves ${same.root}; this is ${cliVersion()}. Run open --replace to restart it.\nViewer: ${url}`,
          );
          if (!args.includes('--no-open') && process.platform === 'darwin') {
            const { spawn } = await import('node:child_process');
            spawn('open', [url], { stdio: 'ignore' });
          }
          return 0;
        }
        await openSession(path.resolve(target ?? '.'), {
          port,
          portGiven: at >= 0,
          launch: !args.includes('--no-open'),
        });
        return -1;
      }
      case 'docs': {
        const { docs } = await import('./docs');
        console.log(docs(file).trimEnd());
        return 0;
      }
      case 'skill': {
        const { installSkill, skillSource } = await import('./skill');
        if (file === 'print') {
          process.stdout.write(fs.readFileSync(path.join(skillSource(), 'SKILL.md'), 'utf8'));
          return 0;
        }
        if (file !== 'install') throw new UsageError('Use skill install or skill print.');
        const at = rest.indexOf('--dir');
        const dir = at >= 0 ? rest[at + 1] : undefined;
        if (at >= 0 && (!dir || dir.startsWith('--')))
          throw new UsageError('--dir needs a folder.');
        const target = installSkill({
          cwd: process.cwd(),
          dir,
          global: flag('--global'),
          force: flag('--force'),
        });
        console.log(`Installed the draftably skill to ${target}.`);
        return 0;
      }
      default:
        console.log(USAGE);
        return command && command !== 'help' && command !== '--help' ? 2 : 0;
    }
  } catch (error) {
    if (error instanceof DslError) console.error(`error   ${error.message}`);
    else if (error instanceof UsageError) console.error(error.message + '\n\n' + USAGE);
    else console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

// Tests import `main` and call it themselves.
if (!isMainThread && workerData?.kind === 'foreign-import') {
  void import('./import-worker').then(module => module.runImportWorker());
} else if (!process.env.VITEST) {
  updateNotice();
  void main(process.argv.slice(2)).then(code => {
    if (code >= 0) process.exitCode = code;
  });
}
