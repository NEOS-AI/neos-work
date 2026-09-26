import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { mergeSkillsByPrecedence } from './discovery.js';
import { parseSkillFile } from './parser.js';

const REPO_SKILLS = join(process.cwd(), '..', '..', 'skills');

function bundledSkillMd(dirName: string): string {
  return join(REPO_SKILLS, dirName, 'SKILL.md');
}

const SECTION_12_FRONTMATTER = `---
name: design-harness-review
description: Suggest stale RULES.md Corrections to prune. Does not delete files.
version: 1.0.0
mode: design
category: design
featured: false
triggers: prune rules, stale design harness, corrections cleanup
example-prompt: Review RULES.md Corrections and list bullets that are stale or too specific
design-system-required: true
---`;

describe('parseSkillFile', () => {
  it('parses YAML frontmatter and body', () => {
    const content = `---
name: hello
description: Greets the user
version: 1.0.0
featured: true
triggers: hi, hello, hey
example-prompt: Say hello
design-system-required: true
---
# Hello skill

Do the thing.
`;
    const skill = parseSkillFile(content, '/skills/hello.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.name).toBe('hello');
    expect(skill!.manifest.description).toBe('Greets the user');
    expect(skill!.manifest.version).toBe('1.0.0');
    expect(skill!.manifest.featured).toBe(true);
    expect(skill!.manifest.triggers).toEqual(['hi', 'hello', 'hey']);
    expect(skill!.manifest.examplePrompt).toBe('Say hello');
    expect(skill!.manifest.designSystemRequired).toBe(true);
    expect(skill!.content).toContain('Do the thing');
    expect(skill!.path).toBe('/skills/hello.md');
    expect(skill!.source).toBe('local');
  });

  it('returns null without frontmatter', () => {
    expect(parseSkillFile('# just markdown', '/x.md', 'global')).toBeNull();
  });

  it('returns null without name field', () => {
    const content = `---
description: no name
---
body
`;
    expect(parseSkillFile(content, '/x.md', 'local')).toBeNull();
  });

  it('returns null for control-char names before trim', () => {
    // Same-line control chars survive simple YAML line parse
    const nullByte = ['---', `name: hi${'\0'}there`, 'description: x', '---', 'body', ''].join(
      '\n',
    );
    expect(parseSkillFile(nullByte, '/x.md', 'local')).toBeNull();
    const cr = ['---', `name: bad${'\r'}name`, 'description: x', '---', 'body', ''].join('\n');
    expect(parseSkillFile(cr, '/x.md', 'local')).toBeNull();
  });

  it('drops control-char YAML keys rather than accepting stripped keys', () => {
    // Null byte inside key must not register as "name"
    const mid = ['---', `na${'\0'}me: hi`, 'description: x', '---', 'body', ''].join('\n');
    expect(parseSkillFile(mid, '/x.md', 'local')).toBeNull();

    // Overlong YAML key (>100) is dropped before value association
    const longKey = 'n'.repeat(101);
    const overlong = [
      '---',
      `${longKey}: should-not-bind`,
      'name: real',
      'description: ok',
      '---',
      'body',
      '',
    ].join('\n');
    const parsed = parseSkillFile(overlong, '/x.md', 'local');
    expect(parsed?.manifest.name).toBe('real');
    expect(parsed?.manifest.description).toBe('ok');
  });

  it('returns null for control-char path and null-byte description', () => {
    const content = `---
name: hello
description: ok
---
body
`;
    expect(parseSkillFile(content, `/skills/${'\n'}hello.md`, 'local')).toBeNull();
    const nulDesc = ['---', 'name: hello', `description: bad${'\0'}desc`, '---', 'body', ''].join(
      '\n',
    );
    expect(parseSkillFile(nulDesc, '/skills/hello.md', 'local')).toBeNull();
  });

  it('returns null for null-byte skill body', () => {
    const content = [
      '---',
      'name: hello',
      'description: ok',
      '---',
      `body with${'\0'}null`,
      '',
    ].join('\n');
    expect(parseSkillFile(content, '/skills/hello.md', 'local')).toBeNull();
  });

  it('returns null for null-byte anywhere in skill file (frontmatter included)', () => {
    const inName = ['---', `name: hel${'\0'}lo`, 'description: ok', '---', 'body', ''].join('\n');
    expect(parseSkillFile(inName, '/skills/hello.md', 'local')).toBeNull();

    const inFrontmatterKey = [
      '---',
      'name: hello',
      `descrip${'\0'}tion: ok`,
      '---',
      'body',
      '',
    ].join('\n');
    expect(parseSkillFile(inFrontmatterKey, '/skills/hello.md', 'local')).toBeNull();

    // Non-string content is coerced then subject to the same null-byte gate
    const bufferish = {
      toString() {
        return ['---', 'name: hello', '---', `body${'\0'}x`, ''].join('\n');
      },
    };
    expect(parseSkillFile(bufferish as unknown as string, '/skills/hello.md', 'local')).toBeNull();
  });

  it('strips quoted values and defaults description', () => {
    const content = `---
name: "quoted"
description: 'desc'
---
`;
    const skill = parseSkillFile(content, '/q.md', 'global');
    expect(skill!.manifest.name).toBe('quoted');
    expect(skill!.manifest.description).toBe('desc');
    expect(skill!.manifest.featured).toBe(false);
    expect(skill!.manifest.designSystemRequired).toBe(false);
  });

  it('accepts camelCase examplePrompt key', () => {
    const content = `---
name: n
examplePrompt: Try me
---
x
`;
    expect(parseSkillFile(content, '/n.md', 'local')!.manifest.examplePrompt).toBe('Try me');
  });

  it('truncates oversized skill bodies and parses fidelity / designSystemRequired', () => {
    const hugeBody = 'B'.repeat(500_100);
    const content = `---
name: fat
description: big
fidelity: high
designSystemRequired: true
---
${hugeBody}
`;
    const skill = parseSkillFile(content, '/skills/fat.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.fidelity).toBe('high');
    expect(skill!.manifest.designSystemRequired).toBe(true);
    expect(skill!.content.length).toBeLessThan(hugeBody.length + 50);
    expect(skill!.content).toContain('…[skill truncated]');
  });

  it('rejects control-char file paths', () => {
    const content = `---
name: ok
description: d
---
body
`;
    expect(parseSkillFile(content, `/skills/bad${'\n'}.md`, 'local')).toBeNull();
    expect(parseSkillFile(content, `/skills/bad${'\0'}.md`, 'global')).toBeNull();
  });

  it('rejects whitespace-only name and trims fields', () => {
    const blankName = `---
name: "   "
description:  desc  
version:  1.2.3  
---
body
`;
    expect(parseSkillFile(blankName, '/x.md', 'local')).toBeNull();
    expect(parseSkillFile('   ', '/x.md', 'local')).toBeNull();

    const padded = `---
name:  hello  
description:  Greets  
mode:  Reference  
category:  Testing  
triggers:  hi ,  hello  
---
  content  
`;
    const skill = parseSkillFile(padded, '  /skills/hello.md  ', 'local');
    expect(skill!.manifest.name).toBe('hello');
    expect(skill!.manifest.description).toBe('Greets');
    expect(skill!.manifest.mode).toBe('reference');
    expect(skill!.manifest.category).toBe('testing');
    expect(skill!.manifest.triggers).toEqual(['hi', 'hello']);
    expect(skill!.content).toBe('content');
    expect(skill!.path).toBe('/skills/hello.md');
  });

  it('caps overlong description, examplePrompt, and skill body', () => {
    const content = `---
name: big
description: ${'D'.repeat(10_000)}
examplePrompt: ${'E'.repeat(6_000)}
---
${'B'.repeat(510_000)}
`;
    const skill = parseSkillFile(content, '/skills/big.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.description.length).toBe(4_000);
    expect(skill!.manifest.examplePrompt?.length).toBe(4_000);
    expect(skill!.content).toMatch(/…\[skill truncated\]$/);
    expect(skill!.content.length).toBe(500_000 + '\n…[skill truncated]'.length);
  });

  it('collapses embedded newlines in description and filters bad triggers', () => {
    // description with embedded \n after parseSimpleYaml is rare (line-based);
    // inject via a single-line value that still exercises replace on description path
    const content = `---
name: multi
description: line1\\nline2
triggers: ok, fine, ${'t'.repeat(150)}, 
---
body
`;
    const skill = parseSkillFile(content, '/skills/multi.md', 'local');
    expect(skill).not.toBeNull();
    // Overlong trigger tokens dropped; blank tokens dropped
    expect(skill!.manifest.triggers).toEqual(['ok', 'fine']);
  });

  it('handles optional field hygiene, invalid source, empty triggers, path coercion', () => {
    // YAML lines without ':' and blank keys skipped; control-char optional fields dropped
    const content = [
      '---',
      'name: edge',
      'description: d',
      'not-a-pair',
      ': orphan-value',
      `mode: bad${'\0'}mode`,
      'category:   ',
      'version:  ',
      'license: MIT',
      'compatibility: node>=20',
      'platform: darwin',
      'triggers:  ,  ,  ',
      'featured: false',
      '---',
      '',
    ].join('\n');
    // Null byte anywhere in the skill file is rejected entirely
    expect(parseSkillFile(content, '/skills/edge.md', 'local')).toBeNull();

    const clean = [
      '---',
      'name: edge',
      'description: d',
      'not-a-pair',
      ': orphan-value',
      'category:   ',
      'version:  ',
      'license: MIT',
      'compatibility: node>=20',
      'platform: darwin',
      'triggers:  ,  ,  ',
      'featured: false',
      '---',
      '',
    ].join('\n');
    const skill = parseSkillFile(clean, '/skills/edge.md', 'not-a-source' as 'local');
    expect(skill).not.toBeNull();
    expect(skill!.source).toBe('local'); // invalid source → local
    expect(skill!.manifest.category).toBeUndefined(); // whitespace-only
    expect(skill!.manifest.version).toBeUndefined();
    expect(skill!.manifest.license).toBe('MIT');
    expect(skill!.manifest.compatibility).toBe('node>=20');
    expect(skill!.manifest.platform).toBe('darwin');
    expect(skill!.manifest.triggers).toBeUndefined(); // all blank → undefined
    expect(skill!.content).toBe('');

    // Cap overlong name; coerce non-string path; whitespace-only path keeps raw
    const longName = ['---', `name: ${'N'.repeat(250)}`, 'description: x', '---', 'body', ''].join(
      '\n',
    );
    const long = parseSkillFile(longName, 42 as unknown as string, 'global');
    expect(long!.manifest.name.length).toBe(200);
    expect(long!.path).toBe('42');
    expect(long!.source).toBe('global');

    const blankPath = parseSkillFile(longName, '   ', 'local');
    expect(blankPath!.path).toBe('   '); // trim empty → keep raw

    // Nullish non-string content → empty → null
    expect(parseSkillFile(null as unknown as string, '/x.md', 'local')).toBeNull();
    expect(parseSkillFile(undefined as unknown as string, '/x.md', 'local')).toBeNull();

    // Overlong optional fields sliced
    const caps = [
      '---',
      'name: caps',
      'description: d',
      `version: ${'v'.repeat(100)}`,
      `license: ${'L'.repeat(200)}`,
      `examplePrompt: ${'E'.repeat(5_000)}`,
      '---',
      'b',
      '',
    ].join('\n');
    const capped = parseSkillFile(caps, '/c.md', 'local');
    expect(capped!.manifest.version?.length).toBe(64);
    expect(capped!.manifest.license?.length).toBe(100);
    expect(capped!.manifest.examplePrompt?.length).toBe(4_000);

    // optionalTrim drops CR control-char optional values (without null-byte file reject)
    const crMode = [
      '---',
      'name: crmode',
      'description: d',
      `mode: bad${'\r'}mode`,
      '---',
      'body',
      '',
    ].join('\n');
    const cr = parseSkillFile(crMode, '/cr.md', 'local');
    expect(cr).not.toBeNull();
    expect(cr!.manifest.mode).toBeUndefined();

    // Non-string path with nullish → String(filePath ?? '')
    const nullPath = parseSkillFile(caps, null as unknown as string, 'local');
    expect(nullPath!.path).toBe('');
  });

  it('accepts source remote without collapsing to local', () => {
    const content = `---
name: hello
description: d
---
body
`;
    expect(parseSkillFile(content, '/skills/hello.md', 'remote')!.source).toBe('remote');
  });
});

describe('parseSkillFile Appendix C golden fixtures', () => {
  it('1. flat — name/description/version/featured/comma triggers', () => {
    const content = `---
name: hello
description: Greets the user
version: 1.0.0
featured: true
triggers: hi, hello, hey
---
# Hello skill
`;
    const skill = parseSkillFile(content, '/skills/hello.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.name).toBe('hello');
    expect(skill!.manifest.description).toBe('Greets the user');
    expect(skill!.manifest.version).toBe('1.0.0');
    expect(skill!.manifest.featured).toBe(true);
    expect(skill!.manifest.triggers).toEqual(['hi', 'hello', 'hey']);
  });

  it('2. nested string metadata — version and internal stringify', () => {
    const content = `---
name: meta
description: d
metadata:
  version: "1.0.0"
  internal: true
---
body
`;
    const skill = parseSkillFile(content, '/skills/meta.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.metadata?.version).toBe('1.0.0');
    expect(skill!.manifest.metadata?.internal).toBe('true');
  });

  it('3. nested object dropped — extra omitted, version kept', () => {
    const content = `---
name: nest
description: d
metadata:
  extra:
    foo: bar
  version: 2
---
body
`;
    const skill = parseSkillFile(content, '/skills/nest.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.metadata).toEqual({ version: '2' });
    expect(skill!.manifest.metadata).not.toHaveProperty('extra');
  });

  it('4. YAML list triggers', () => {
    const content = `---
name: list
description: d
triggers:
  - hi
  - hello
---
body
`;
    const skill = parseSkillFile(content, '/skills/list.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.triggers).toEqual(['hi', 'hello']);
  });

  it('5. comma triggers unchanged', () => {
    const content = `---
name: comma
description: d
triggers: hi, hello
---
body
`;
    const skill = parseSkillFile(content, '/skills/comma.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.triggers).toEqual(['hi', 'hello']);
  });

  it('6. multiline description is installable (name kept; description not null)', () => {
    const content = `---
description: |
  line1
  line2
name: x
---
body
`;
    const skill = parseSkillFile(content, '/skills/multi.md', 'local');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.name).toBe('x');
    expect(typeof skill!.manifest.description).toBe('string');
    expect(skill!.manifest.description === '' || skill!.manifest.description === '|').toBe(true);
  });
});

describe('bundled design-harness-review', () => {
  it('parses skills/design-harness-review/SKILL.md §12 frontmatter', () => {
    const skillPath = bundledSkillMd('design-harness-review');
    expect(existsSync(skillPath)).toBe(true);
    const content = readFileSync(skillPath, 'utf8');
    expect(content.startsWith(SECTION_12_FRONTMATTER)).toBe(true);
    const closing = content.indexOf('\n---', 4);
    expect(closing).toBeGreaterThan(0);
    const yaml = content.slice(0, closing + '\n---'.length);
    expect(yaml).toBe(SECTION_12_FRONTMATTER);
    expect(yaml).not.toMatch(/^fidelity:/m);
    expect(yaml).not.toMatch(/^license:/m);
    expect(yaml).not.toMatch(/^platform:/m);

    const skill = parseSkillFile(content, skillPath, 'bundled');
    expect(skill).not.toBeNull();
    expect(skill!.manifest.name).toBe('design-harness-review');
    expect(skill!.manifest.description).toBe(
      'Suggest stale RULES.md Corrections to prune. Does not delete files.',
    );
    expect(skill!.manifest.version).toBe('1.0.0');
    expect(skill!.manifest.mode).toBe('design');
    expect(skill!.manifest.category).toBe('design');
    expect(skill!.manifest.featured).toBe(false);
    expect(skill!.manifest.triggers).toEqual([
      'prune rules',
      'stale design harness',
      'corrections cleanup',
    ]);
    expect(skill!.manifest.examplePrompt).toBe(
      'Review RULES.md Corrections and list bullets that are stale or too specific',
    );
    expect(skill!.manifest.designSystemRequired).toBe(true);
    expect(skill!.manifest.fidelity).toBeUndefined();
    expect(skill!.source).toBe('bundled');
    expect(skill!.path.endsWith('skills/design-harness-review/SKILL.md')).toBe(true);
  });

  it('body suggests prune and does not delete or critique HTML', () => {
    const skillPath = bundledSkillMd('design-harness-review');
    expect(existsSync(skillPath)).toBe(true);
    const skill = parseSkillFile(readFileSync(skillPath, 'utf8'), skillPath, 'bundled');
    expect(skill).not.toBeNull();
    const body = skill!.content;
    expect(body).toMatch(/Corrections/);
    expect(body).toMatch(/\/api\/design-systems\//);
    expect(body).toMatch(/rules\/prune/);
    expect(body).toMatch(/do(?:es)? not delete/i);
    expect(body).toMatch(/90/);
    expect(body).toMatch(/20/);
    expect(body).not.toMatch(/\bhuman-review\b/);
    expect(body).not.toMatch(/name:\s*human-review/);
    expect(body).not.toMatch(/skills\/human-review/);
    expect(body).not.toMatch(/\/api\/harness(es)?\b/);
    expect(body).not.toMatch(/\bunlink\b/i);
    expect(body).not.toMatch(/rm -rf/i);
    expect(body.replace(/do(?:es)? not delete files/gi, '')).not.toMatch(/delete files/i);
    expect(body).not.toMatch(/Visual hierarchy/);
    expect(body).not.toMatch(/WCAG/);
    expect(body).not.toMatch(/Responsive breakpoints/);
  });

  it('name does not collide with design-critique and is not human-review', () => {
    const critiquePath = bundledSkillMd('design-critique');
    const reviewPath = bundledSkillMd('design-harness-review');
    expect(existsSync(critiquePath)).toBe(true);
    expect(existsSync(reviewPath)).toBe(true);
    const critique = parseSkillFile(readFileSync(critiquePath, 'utf8'), critiquePath, 'bundled');
    const review = parseSkillFile(readFileSync(reviewPath, 'utf8'), reviewPath, 'bundled');
    expect(critique).not.toBeNull();
    expect(review).not.toBeNull();
    expect(critique!.manifest.name).toBe('design-critique');
    expect(review!.manifest.name).toBe('design-harness-review');
    expect(critique!.manifest.name).not.toBe(review!.manifest.name);
    expect(critique!.manifest.name).not.toBe('human-review');
    expect(review!.manifest.name).not.toBe('human-review');
    const merged = mergeSkillsByPrecedence([[critique!, review!]]);
    expect(merged).toHaveLength(2);
  });

  it('design-critique SKILL.md is unchanged', () => {
    const content = readFileSync(bundledSkillMd('design-critique'), 'utf8');
    expect(content).toContain('name: design-critique');
    expect(content).toContain('design-system-required: false');
    expect(content).toContain('featured: true');
    expect(content).toContain('Critique HTML/CSS');
    expect(content).not.toContain('design-harness-review');
    expect(content).not.toContain('rules/prune');
  });

  it('skills/human-review/ does not exist', () => {
    expect(existsSync(join(REPO_SKILLS, 'human-review'))).toBe(false);
    expect(existsSync(join(REPO_SKILLS, 'human-review', 'SKILL.md'))).toBe(false);
  });

  it('design-harness-review has no remote provenance sidecar', () => {
    const pkgDir = join(REPO_SKILLS, 'design-harness-review');
    expect(existsSync(pkgDir) && existsSync(join(pkgDir, 'neos-skill-source.json'))).toBe(false);
  });
});
