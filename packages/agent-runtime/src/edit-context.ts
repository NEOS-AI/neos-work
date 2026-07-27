/**
 * Assemble editContext into a prompt fragment (Task 3 / Q10 patch-first).
 */

import {
  normalizeEditContext,
  type EditContext,
} from '@neos-work/shared';

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
