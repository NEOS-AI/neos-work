/**
 * Skill parser — parses SKILL.md files with YAML frontmatter.
 * Compatible with OpenCode SKILL.md format.
 */

import type { SkillManifest, Skill, SkillSource } from '@neos-work/shared';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/** Parse a simple YAML frontmatter block (key: value pairs only, no nesting). */
function parseSimpleYaml(yaml: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of yaml.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx < 1) continue;
    const keyRaw = line.slice(0, colonIdx);
    // Control-char keys dropped (check before trim)
    if (/[\0\r\n]/.test(keyRaw)) continue;
    const key = keyRaw.trim();
    if (!key || key.length > 100) continue;
    // Value: keep raw for field-level hygiene (name/description handle control later)
    const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '');
    result[key] = value;
  }
  return result;
}

function optionalTrim(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // Drop control-char optional fields rather than strip them (check before trim)
  if (/[\0\r\n]/.test(raw)) return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

/** Cap SKILL.md parsed fields (discovery hygiene). */
const SKILL_NAME_MAX = 200;
const SKILL_DESCRIPTION_MAX = 4_000;
const SKILL_BODY_MAX = 500_000;
const SKILL_EXAMPLE_PROMPT_MAX = 4_000;
const SKILL_TRIGGERS_MAX = 50;

export function parseSkillFile(
  content: string,
  filePath: string,
  source: SkillSource,
): Skill | null {
  const text = typeof content === 'string' ? content : String(content ?? '');
  // Null-byte skill files rejected entirely (frontmatter + body)
  if (/\0/.test(text)) return null;
  if (!text.trim()) return null;
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return null;

  const [, frontmatter, body] = match;
  const raw = parseSimpleYaml(frontmatter ?? '');

  const nameRaw = typeof raw.name === 'string' ? raw.name : '';
  // Control-char check before trim
  if (!nameRaw || /[\0\r\n]/.test(nameRaw)) return null;
  let name = nameRaw.trim();
  if (!name) return null;
  if (name.length > SKILL_NAME_MAX) name = name.slice(0, SKILL_NAME_MAX);

  const sourceNorm: SkillSource =
    source === 'global' || source === 'local' || source === 'bundled' || source === 'opencode'
      ? source
      : 'local';

  const modeRaw = optionalTrim(raw.mode);
  const categoryRaw = optionalTrim(raw.category);

  // Description: multi-line OK in YAML values is rare; reject null-byte / CR-LF line injection
  let description = '';
  if (typeof raw.description === 'string') {
    if (/\0/.test(raw.description)) return null;
    // Collapse embedded newlines for single-line manifest field hygiene
    description = raw.description.replace(/[\r\n]+/g, ' ').trim();
  }
  if (description.length > SKILL_DESCRIPTION_MAX) {
    description = description.slice(0, SKILL_DESCRIPTION_MAX);
  }

  let examplePrompt = optionalTrim(raw.examplePrompt ?? raw['example-prompt']);
  if (examplePrompt && examplePrompt.length > SKILL_EXAMPLE_PROMPT_MAX) {
    examplePrompt = examplePrompt.slice(0, SKILL_EXAMPLE_PROMPT_MAX);
  }

  let triggers = raw.triggers
    ? raw.triggers
        .split(',')
        // Control-char check before trim so leading \n cannot strip to a valid trigger
        .map((s) => s)
        .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
        .map((s) => s.trim())
        .filter((t) => t.length > 0 && t.length <= 100)
        .slice(0, SKILL_TRIGGERS_MAX)
    : undefined;
  if (triggers && triggers.length === 0) triggers = undefined;

  const manifest: SkillManifest = {
    name,
    description,
    version: optionalTrim(raw.version)?.slice(0, 64),
    license: optionalTrim(raw.license)?.slice(0, 100),
    compatibility: optionalTrim(raw.compatibility)?.slice(0, 200),
    mode: modeRaw ? modeRaw.toLowerCase().slice(0, 50) : undefined,
    platform: optionalTrim(raw.platform)?.slice(0, 50),
    category: categoryRaw ? categoryRaw.toLowerCase().slice(0, 50) : undefined,
    featured: raw.featured === 'true',
    examplePrompt,
    triggers,
    designSystemRequired:
      raw.designSystemRequired === 'true' || raw['design-system-required'] === 'true',
    fidelity: optionalTrim(raw.fidelity)?.slice(0, 50),
  };

  let skillBody = (body ?? '').trim();
  if (skillBody.length > SKILL_BODY_MAX) {
    skillBody = skillBody.slice(0, SKILL_BODY_MAX) + '\n…[skill truncated]';
  }

  // Control-char path before trim
  const pathRaw =
    typeof filePath === 'string' ? filePath : String(filePath ?? '');
  if (/[\0\r\n]/.test(pathRaw)) return null;
  const pathVal = pathRaw.trim() || pathRaw;

  return {
    manifest,
    content: skillBody,
    path: pathVal,
    source: sourceNorm,
  };
}
