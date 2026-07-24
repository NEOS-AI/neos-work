/**
 * Skill parser — parses SKILL.md files with YAML frontmatter.
 * Compatible with OpenCode SKILL.md format.
 */

import type { SkillManifest, Skill } from '@neos-work/shared';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse a simple YAML frontmatter block (key: value pairs only, no nesting). */
function parseSimpleYaml(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) result[key] = value;
  }
  return result;
}

function optionalTrim(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

export function parseSkillFile(
  content: string,
  filePath: string,
  source: 'local' | 'global',
): Skill | null {
  const text = typeof content === 'string' ? content : String(content ?? '');
  if (!text.trim()) return null;
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const raw = parseSimpleYaml(frontmatter ?? '');

  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const sourceNorm =
    source === 'global' || source === 'local' ? source : 'local';

  const modeRaw = optionalTrim(raw.mode);
  const categoryRaw = optionalTrim(raw.category);

  const manifest: SkillManifest = {
    name,
    description: typeof raw.description === 'string' ? raw.description.trim() : '',
    version: optionalTrim(raw.version),
    license: optionalTrim(raw.license),
    compatibility: optionalTrim(raw.compatibility),
    mode: modeRaw ? modeRaw.toLowerCase() : undefined,
    platform: optionalTrim(raw.platform),
    category: categoryRaw ? categoryRaw.toLowerCase() : undefined,
    featured: raw.featured === 'true',
    examplePrompt: optionalTrim(raw.examplePrompt ?? raw['example-prompt']),
    triggers: raw.triggers
      ? raw.triggers.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined,
    designSystemRequired:
      raw.designSystemRequired === 'true' || raw['design-system-required'] === 'true',
    fidelity: optionalTrim(raw.fidelity),
  };

  return {
    manifest,
    content: (body ?? '').trim(),
    path: typeof filePath === 'string' ? filePath.trim() || filePath : String(filePath ?? ''),
    source: sourceNorm,
  };
}
