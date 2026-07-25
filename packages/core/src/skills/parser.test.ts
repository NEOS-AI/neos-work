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
});
