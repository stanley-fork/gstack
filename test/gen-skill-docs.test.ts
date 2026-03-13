import { describe, test, expect } from 'bun:test';
import { COMMAND_DESCRIPTIONS } from '../browse/src/commands';
import { SNAPSHOT_FLAGS } from '../browse/src/snapshot';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

describe('gen-skill-docs', () => {
  test('generated SKILL.md contains all command categories', () => {
    const content = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
    const categories = new Set(Object.values(COMMAND_DESCRIPTIONS).map(d => d.category));
    for (const cat of categories) {
      expect(content).toContain(`### ${cat}`);
    }
  });

  test('generated SKILL.md contains all commands', () => {
    const content = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
    for (const [cmd, meta] of Object.entries(COMMAND_DESCRIPTIONS)) {
      const display = meta.usage || cmd;
      expect(content).toContain(display);
    }
  });

  test('command table is sorted alphabetically within categories', () => {
    const content = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
    // Extract command names from the Navigation section as a test
    const navSection = content.match(/### Navigation\n\|.*\n\|.*\n([\s\S]*?)(?=\n###|\n## )/);
    expect(navSection).not.toBeNull();
    const rows = navSection![1].trim().split('\n');
    const commands = rows.map(r => {
      const match = r.match(/\| `(\w+)/);
      return match ? match[1] : '';
    }).filter(Boolean);
    const sorted = [...commands].sort();
    expect(commands).toEqual(sorted);
  });

  test('generated header is present in SKILL.md', () => {
    const content = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
    expect(content).toContain('AUTO-GENERATED from SKILL.md.tmpl');
    expect(content).toContain('Regenerate: bun run gen:skill-docs');
  });

  test('generated header is present in browse/SKILL.md', () => {
    const content = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    expect(content).toContain('AUTO-GENERATED from SKILL.md.tmpl');
  });

  test('snapshot flags section contains all flags', () => {
    const content = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf-8');
    for (const flag of SNAPSHOT_FLAGS) {
      expect(content).toContain(flag.short);
      expect(content).toContain(flag.description);
    }
  });

  test('template files exist for generated SKILL.md files', () => {
    expect(fs.existsSync(path.join(ROOT, 'SKILL.md.tmpl'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'browse', 'SKILL.md.tmpl'))).toBe(true);
  });

  test('templates contain placeholders', () => {
    const rootTmpl = fs.readFileSync(path.join(ROOT, 'SKILL.md.tmpl'), 'utf-8');
    expect(rootTmpl).toContain('{{COMMAND_REFERENCE}}');
    expect(rootTmpl).toContain('{{SNAPSHOT_FLAGS}}');

    const browseTmpl = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md.tmpl'), 'utf-8');
    expect(browseTmpl).toContain('{{COMMAND_REFERENCE}}');
    expect(browseTmpl).toContain('{{SNAPSHOT_FLAGS}}');
  });
});
