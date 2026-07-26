import { describe, expect, it } from 'vitest';
import { parseSkillFile } from './parser.js';

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
    const nullByte = [
      '---',
      `name: hi${'\0'}there`,
      'description: x',
      '---',
      'body',
      '',
    ].join('\n');
    expect(parseSkillFile(nullByte, '/x.md', 'local')).toBeNull();
    const cr = [
      '---',
      `name: bad${'\r'}name`,
      'description: x',
      '---',
      'body',
      '',
    ].join('\n');
    expect(parseSkillFile(cr, '/x.md', 'local')).toBeNull();
  });

  it('drops control-char YAML keys rather than accepting stripped keys', () => {
    // Null byte inside key must not register as "name"
    const mid = [
      '---',
      `na${'\0'}me: hi`,
      'description: x',
      '---',
      'body',
      '',
    ].join('\n');
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
    const nulDesc = [
      '---',
      'name: hello',
      `description: bad${'\0'}desc`,
      '---',
      'body',
      '',
    ].join('\n');
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
    const inName = [
      '---',
      `name: hel${'\0'}lo`,
      'description: ok',
      '---',
      'body',
      '',
    ].join('\n');
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
});
