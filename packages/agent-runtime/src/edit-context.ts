/**
 * Assemble editContext + preview comments into a prompt fragment (Task 3 / 1c).
 */

import {
  normalizeEditContext,
  type EditContext,
} from '@neos-work/shared';

export interface PreviewCommentFragment {
  filePath: string;
  selector: string;
  body: string;
}

export function assembleEditContextPrompt(
  basePrompt: string,
  editContextRaw: unknown,
): { prompt: string; editContext: EditContext | null } {
  const base = typeof basePrompt === 'string' ? basePrompt : '';
  const editContext = normalizeEditContext(editContextRaw);
  if (!editContext) {
    return { prompt: base, editContext: null };
  }

  const parts: string[] = [base.trim()];
  parts.push('');
  parts.push('## Edit context (Design Editor)');
  parts.push(`- File: ${editContext.filePath}`);
  parts.push(`- Mode: ${editContext.mode}`);
  if (editContext.selection) {
    if ('selector' in editContext.selection) {
      parts.push(`- Selection selector: ${editContext.selection.selector}`);
    } else {
      parts.push(
        `- Selection lines: ${editContext.selection.startLine}-${editContext.selection.endLine}`,
      );
    }
  }
  if (editContext.snippet) {
    parts.push('');
    parts.push('### Selected snippet');
    parts.push('```');
    parts.push(editContext.snippet.slice(0, 64 * 1024));
    parts.push('```');
  }
  if (editContext.mode === 'replace-file') {
    parts.push('');
    parts.push(
      'NOTE: User confirmed full-file replace. Rewrite the entire file when applying changes.',
    );
  } else {
    parts.push('');
    parts.push(
      'Prefer a minimal patch or selection-scoped replace. Do not overwrite unrelated manual edits.',
    );
  }

  return { prompt: parts.join('\n'), editContext };
}

/**
 * Append preview annotation comments for the open project (Task 1c).
 * Caps total size; skips empty/invalid entries.
 */
export function assemblePreviewCommentsPrompt(
  basePrompt: string,
  comments: PreviewCommentFragment[],
  opts?: { maxComments?: number; maxBodyChars?: number },
): string {
  const base = typeof basePrompt === 'string' ? basePrompt : '';
  if (!Array.isArray(comments) || comments.length === 0) return base;

  const maxComments = opts?.maxComments ?? 40;
  const maxBody = opts?.maxBodyChars ?? 500;
  const lines: string[] = [base.trim(), '', '## Preview comments (user annotations)'];
  let n = 0;
  for (const c of comments) {
    if (n >= maxComments) break;
    if (!c || typeof c !== 'object') continue;
    const filePath = typeof c.filePath === 'string' ? c.filePath.trim() : '';
    const selector = typeof c.selector === 'string' ? c.selector.trim() : '';
    const body = typeof c.body === 'string' ? c.body.trim() : '';
    if (!filePath || !selector || !body) continue;
    if (/[\0\r\n]/.test(filePath) || /[\0\r\n]/.test(selector)) continue;
    if (/\0/.test(body)) continue;
    n += 1;
    lines.push(
      `${n}. \`${filePath}\` · \`${selector.slice(0, 200)}\`: ${body.slice(0, maxBody)}`,
    );
  }
  if (n === 0) return base;
  lines.push('');
  lines.push('Address these annotations when editing unless the user prompt says otherwise.');
  return lines.join('\n');
}

export interface DesignContextFragment {
  name?: string;
  designMd: string;
  rulesMd?: string | null;
  tokensCss?: string | null;
}

export const DESIGN_MD_INJECT_MAX = 32_000;
export const RULES_MD_INJECT_MAX = 16_000;
export const RULES_MD_INJECT_HEAD = 8_000;
export const RULES_MD_INJECT_TAIL = 8_000;
export const TOKENS_INJECT_MAX = 8_000;
export { DESIGN_HARNESS_WRAP_MAX } from '@neos-work/shared';

const CORRECTIONS_HEADING_RE = /^\s*##\s+corrections\s*$/im;
const NEXT_ATX_HEADING_RE = /^\s*#{1,6}\s+/m;
const CORRECTION_BULLET_RE = /^\s*-\s+(\d{4}-\d{2}-\d{2}):\s*(.*)$/;

function formatRulesInject(rulesMd: string | null | undefined): string {
  if (typeof rulesMd !== 'string' || /\0/.test(rulesMd)) return '';
  const text = rulesMd.trim();
  if (!text) return '';

  CORRECTIONS_HEADING_RE.lastIndex = 0;
  const match = CORRECTIONS_HEADING_RE.exec(text);
  if (!match) {
    if (text.length > RULES_MD_INJECT_MAX) {
      return text.slice(0, RULES_MD_INJECT_MAX) + '\n\n…[rules truncated]';
    }
    return text;
  }

  let head = text.slice(0, match.index);
  if (head.length > RULES_MD_INJECT_HEAD) {
    head = head.slice(0, RULES_MD_INJECT_HEAD) + '\n\n…[rules truncated]';
  }

  const lineEnd = text.indexOf('\n', match.index + match[0].length);
  const afterStart = lineEnd === -1 ? text.length : lineEnd + 1;
  const afterHeading = text.slice(afterStart);
  NEXT_ATX_HEADING_RE.lastIndex = 0;
  const next = NEXT_ATX_HEADING_RE.exec(afterHeading);
  const body = next ? afterHeading.slice(0, next.index) : afterHeading;

  const bullets: string[] = [];
  for (const line of body.split('\n')) {
    if (/^\s*<!--\s*source:/.test(line)) continue;
    if (CORRECTION_BULLET_RE.test(line)) bullets.push(line.replace(/\s+$/, ''));
  }

  const selected: string[] = [];
  for (let i = bullets.length - 1; i >= 0; i -= 1) {
    const candidate = [bullets[i], ...selected].join('\n');
    if (selected.length > 0 && candidate.length > RULES_MD_INJECT_TAIL) break;
    selected.unshift(bullets[i]!);
  }

  return `${head}\n## Corrections\n${selected.join('\n')}`;
}

/** Marker-free inner. Empty/null-byte DESIGN.md skips the entire block. */
export function formatDesignHarnessInner(fragment: DesignContextFragment): string {
  if (!fragment || typeof fragment.designMd !== 'string') return '';
  if (/\0/.test(fragment.designMd)) return '';
  let designMd = fragment.designMd.trim();
  if (!designMd) return '';
  if (designMd.length > DESIGN_MD_INJECT_MAX) {
    designMd = designMd.slice(0, DESIGN_MD_INJECT_MAX) + '\n\n…[design system truncated]';
  }

  const parts: string[] = [];
  if (fragment.name && typeof fragment.name === 'string' && !/[\0\r\n]/.test(fragment.name)) {
    const n = fragment.name.trim().slice(0, 100);
    if (n) parts.push(`Design system: ${n}`);
  }
  parts.push(designMd);

  const rules = formatRulesInject(fragment.rulesMd);
  if (rules) {
    parts.push('');
    parts.push('### RULES.md');
    parts.push(rules);
  }

  if (typeof fragment.tokensCss === 'string' && !/\0/.test(fragment.tokensCss)) {
    let tokens = fragment.tokensCss.trim();
    if (tokens) {
      if (tokens.length > TOKENS_INJECT_MAX) {
        tokens = tokens.slice(0, TOKENS_INJECT_MAX) + '\n/* …tokens truncated */';
      }
      parts.push('');
      parts.push('### tokens.css');
      parts.push('```css');
      parts.push(tokens);
      parts.push('```');
    }
  }

  return parts.join('\n');
}

/**
 * MUST call formatDesignHarnessInner, then wrap DESIGN CONTEXT markers.
 */
export function assembleDesignContextPrompt(
  basePrompt: string,
  fragment: DesignContextFragment | null | undefined,
): string {
  const base = typeof basePrompt === 'string' ? basePrompt : '';
  const inner = formatDesignHarnessInner(fragment ?? { designMd: '' });
  if (!inner) return base;
  return `<!-- DESIGN CONTEXT -->\n${inner}\n<!-- /DESIGN CONTEXT -->\n\n${base.trim()}`;
}
