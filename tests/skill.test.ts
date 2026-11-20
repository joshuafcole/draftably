import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compile } from '../src/dsl/compile';
import { COLORS, DSL_SHAPES, ENGINE_PARAMS, ENGINES, ROUTING_PARAMS } from '../src/dsl/syntax';
import { installSkill, skillSource, staleSkills } from '../src/cli/skill';

const dirs: string[] = [];
const temp = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-skill-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('agent skill', () => {
  const skill = fs.readFileSync(path.join(skillSource(), 'SKILL.md'), 'utf8');

  it('has the frontmatter `npx skills` reads', () => {
    expect(skill).toMatch(/^---\nname: draftably\ndescription: .+\n---\n/);
  });

  it('teaches source that compiles without errors', async () => {
    const examples = [...skill.matchAll(/```text\n([\s\S]*?)```/g)].map(m => m[1]);
    expect(examples.length).toBeGreaterThan(0);
    for (const source of examples) {
      const scene = await compile(source);
      expect(scene.diagnostics.filter(d => d.level === 'error')).toEqual([]);
    }
  });

  // The skill is a second language guide. When the parser learns a word, the skill must too.
  it('names every statement, color, shape and engine the parser accepts', () => {
    const parser = fs.readFileSync(path.join(__dirname, '../src/dsl/syntax.ts'), 'utf8');
    const statements = [...parser.matchAll(/^\s*case '([a-z]+)':/gm)].map(m => m[1]);
    expect(statements).toContain('edge');
    const words = [...statements, ...COLORS, ...DSL_SHAPES, ...ENGINES];
    // Words sit in code spans, after `=`, or between `|` (escaped as `\|` in tables).
    const missing = words.filter(w => !new RegExp(`[\`|=\\s]${w}[\`|\\\\\\s]`).test(skill));
    expect(missing, 'Add these to skills/draftably/SKILL.md').toEqual([]);
  });

  it('only uses settings the parser accepts', () => {
    const known = new Set(Object.keys({ ...ENGINE_PARAMS, ...ROUTING_PARAMS }));
    const used = [...skill.matchAll(/`(?:layout|routing)[^`]*`/g)].flatMap(m =>
      [...m[0].matchAll(/([a-z-]+)=/g)].map(s => s[1]),
    );
    const common = ['engine', 'gap', 'direction', 'min-width', 'min-height', 'activations'];
    expect(used.filter(s => !known.has(s) && !common.includes(s))).toEqual([]);
  });

  it('installs into .claude/skills, a home folder, or a chosen folder', () => {
    const cwd = temp();
    const home = temp();
    const local = installSkill({ cwd });
    expect(local).toBe(path.join(cwd, '.claude/skills/draftably'));
    expect(fs.readFileSync(path.join(local, 'SKILL.md'), 'utf8')).toBe(skill);
    expect(installSkill({ cwd, global: true, home })).toBe(
      path.join(home, '.claude/skills/draftably'),
    );
    expect(installSkill({ cwd, dir: '.agents/skills' })).toBe(
      path.join(cwd, '.agents/skills/draftably'),
    );
  });

  it('replaces an existing copy only with force', () => {
    const cwd = temp();
    const target = installSkill({ cwd });
    fs.writeFileSync(path.join(target, 'SKILL.md'), 'stale');
    expect(() => installSkill({ cwd })).toThrow(/--force/);
    installSkill({ cwd, force: true });
    expect(fs.readFileSync(path.join(target, 'SKILL.md'), 'utf8')).toBe(skill);
  });
});

describe('stale skill', () => {
  it('names an installed copy that differs from the bundled skill, with the command to update it', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-stale-')),
      home = fs.mkdtempSync(path.join(os.tmpdir(), 'draftably-home-'));
    installSkill({ cwd });
    installSkill({ cwd, global: true, home });
    expect(staleSkills(cwd, home)).toEqual([]);
    fs.writeFileSync(path.join(home, '.claude/skills/draftably/SKILL.md'), 'old copy');
    expect(staleSkills(cwd, home)).toEqual([
      {
        path: path.join(home, '.claude/skills/draftably'),
        fix: 'draftably skill install --global --force',
      },
    ]);
  });
});
