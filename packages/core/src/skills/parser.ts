/**
 * Skill parser — parses SKILL.md files with YAML frontmatter.
 * Compatible with OpenCode SKILL.md format.
 */

import type { Skill, SkillManifest, SkillSource } from '@neos-work/shared';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const LIST_ITEM_RE = /^(\s*)-\s+(.*)$/;
const KEY_RE = /^(\s*)([^:#\s][^:]*)\s*:\s*(.*)$/;

type ParsedFrontmatter = {
  fields: Record<string, string>;
  metadata?: Record<string, string>;
  triggersList?: string[];
};

function indentOf(line: string): number {
  let n = 0;
  for (const ch of line) {
    if (ch === ' ') n += 1;
    else if (ch === '\t') n += 2;
    else break;
  }
  return n;
}

function isListItem(line: string): boolean {
  return LIST_ITEM_RE.test(line);
}

function isKey(line: string): boolean {
  return KEY_RE.test(line);
}

function keyParts(line: string): { key: string; value: string } | null {
  const m = KEY_RE.exec(line);
  if (!m) return null;
  const keyRaw = m[2] ?? '';
  // Control-char keys dropped (do not strip)
  if (/[\0\r\n]/.test(keyRaw)) return null;
  const key = keyRaw.trim();
  if (!key || key.length > 100) return null;
  return { key, value: m[3] ?? '' };
}

function unquote(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '');
}

function stringifyScalar(v: string): string {
  let s = v.trim();
  if (
    s.length >= 2 &&
    ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))
  ) {
    s = s.slice(1, -1);
  }
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === 'yes' || lower === 'on') return 'true';
  if (lower === 'false' || lower === 'no' || lower === 'off') return 'false';
  return s;
}

function skipDeeper(lines: string[], start: number, parentIndent: number): number {
  let i = start;
  while (i < lines.length && indentOf(lines[i]!) > parentIndent) i += 1;
  return i;
}

function parseSkillFrontmatter(yaml: string): ParsedFrontmatter | null {
  const lines = yaml.split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  const fields: Record<string, string> = {};
  let metadata: Record<string, string> | undefined;
  let triggersList: string[] | undefined;
  let i = 0;
  while (i < lines.length) {
    const raw = lines[i]!;
    if (/\0/.test(raw)) return null;
    if (isKey(raw) && indentOf(raw) === 0) {
      const parts = keyParts(raw);
      if (!parts) {
        i += 1;
        continue;
      }
      const { key, value } = parts;
      const next = i + 1 < lines.length ? lines[i + 1]! : undefined;
      const nextIndent = next !== undefined ? indentOf(next) : 0;

      if (key === 'metadata' && value === '') {
        const meta: Record<string, string> = {};
        i += 1;
        while (i < lines.length && indentOf(lines[i]!) > 0) {
          const childLine = lines[i]!;
          if (/\0/.test(childLine)) return null;
          const childIndent = indentOf(childLine);
          if (isKey(childLine)) {
            const child = keyParts(childLine);
            if (!child) {
              i += 1;
              continue;
            }
            const deeper = i + 1 < lines.length && indentOf(lines[i + 1]!) > childIndent;
            if (child.value === '' && deeper) {
              i = skipDeeper(lines, i + 1, childIndent);
              continue;
            }
            meta[child.key] = stringifyScalar(child.value);
            i += 1;
            continue;
          }
          i += 1;
        }
        metadata = meta;
        continue;
      }

      if (key === 'triggers' && value === '') {
        const list: string[] = [];
        i += 1;
        while (i < lines.length && isListItem(lines[i]!) && indentOf(lines[i]!) > 0) {
          const item = LIST_ITEM_RE.exec(lines[i]!)?.[2] ?? '';
          list.push(item.trim());
          i += 1;
        }
        triggersList = list;
        continue;
      }

      if (value === '' && next !== undefined && nextIndent > 0) {
        i = skipDeeper(lines, i + 1, 0);
        continue;
      }
      fields[key] = unquote(value);
    }
    i += 1;
  }
  const out: ParsedFrontmatter = { fields };
  if (metadata) out.metadata = metadata;
  if (triggersList) out.triggersList = triggersList;
  return out;
}

function optionalTrim(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  // Drop control-char optional fields rather than strip them (check before trim)
  if (/[\0\r\n]/.test(raw)) return undefined;
  const t = raw.trim();
  return t.length > 0 ? t : undefined;
}

function normalizeTriggers(tokens: string[]): string[] | undefined {
  const triggers = tokens
    .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
    .map((s) => s.trim())
    .filter((t) => t.length > 0 && t.length <= 100)
    .slice(0, SKILL_TRIGGERS_MAX);
  return triggers.length > 0 ? triggers : undefined;
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
  const parsed = parseSkillFrontmatter(frontmatter ?? '');
  if (!parsed) return null;
  const raw = parsed.fields;

  const nameRaw = typeof raw.name === 'string' ? raw.name : '';
  // Control-char check before trim
  if (!nameRaw || /[\0\r\n]/.test(nameRaw)) return null;
  let name = nameRaw.trim();
  if (!name) return null;
  if (name.length > SKILL_NAME_MAX) name = name.slice(0, SKILL_NAME_MAX);

  const sourceNorm: SkillSource =
    source === 'global' ||
    source === 'local' ||
    source === 'bundled' ||
    source === 'opencode' ||
    source === 'remote'
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

  const triggerTokens = parsed.triggersList ?? (raw.triggers ? raw.triggers.split(',') : undefined);
  const triggers = triggerTokens ? normalizeTriggers(triggerTokens) : undefined;

  let metadata = parsed.metadata;
  if (metadata && Object.keys(metadata).length === 0) metadata = undefined;

  const manifest: SkillManifest = {
    name,
    description,
    version: optionalTrim(raw.version)?.slice(0, 64),
    license: optionalTrim(raw.license)?.slice(0, 100),
    compatibility: optionalTrim(raw.compatibility)?.slice(0, 200),
    metadata,
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
  const pathRaw = typeof filePath === 'string' ? filePath : String(filePath ?? '');
  if (/[\0\r\n]/.test(pathRaw)) return null;
  const pathVal = pathRaw.trim() || pathRaw;

  return {
    manifest,
    content: skillBody,
    path: pathVal,
    source: sourceNorm,
  };
}
