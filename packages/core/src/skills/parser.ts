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

export function parseSkillFile(
  content: string,
  filePath: string,
  source: 'local' | 'global',
): Skill | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const raw = parseSimpleYaml(frontmatter);

  if (!raw.name) return null;

  const manifest: SkillManifest = {
    name: raw.name,
    description: raw.description ?? '',
    license: raw.license,
    compatibility: raw.compatibility,
  };

  return {
    manifest,
    content: body.trim(),
    path: filePath,
    source,
  };
}
