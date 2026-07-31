/**
 * Map pipeline stage kinds → default atom ids for snapshot / capability checks.
 */

import type { AtomKind } from './types.js';

const STAGE_KIND_ATOMS: Record<string, string[]> = {
  discovery: ['prompt.user', 'genui.form'],
  plan: ['prompt.system', 'prompt.user'],
  execute: ['prompt.user', 'tool.filesystem', 'editor.apply_patch'],
  critique: ['prompt.user'],
  form: ['genui.form', 'gate.hitl'],
  choice: ['genui.choice', 'gate.hitl'],
};

/** Resolve atom ids for a pipeline stage kind (unknown → execute defaults). */
export function atomIdsForStageKind(kind: unknown): string[] {
  if (typeof kind !== 'string' || /[\0\r\n]/.test(kind)) {
    return [...STAGE_KIND_ATOMS.execute];
  }
  const k = kind.trim().toLowerCase();
  return [...(STAGE_KIND_ATOMS[k] ?? STAGE_KIND_ATOMS.execute)];
}

/** Collect unique atom ids for a list of stage kinds. */
export function collectAtomIdsForPipeline(
  stages: Array<{ kind?: unknown } | null | undefined>,
): string[] {
  const set = new Set<string>();
  if (!Array.isArray(stages)) return [];
  for (const s of stages.slice(0, 50)) {
    if (!s) continue;
    for (const id of atomIdsForStageKind(s.kind)) set.add(id);
  }
  // Always include capability + HITL gates for plugin pipelines
  set.add('gate.capability');
  return [...set].sort();
}

export function stageKindToAtomKind(kind: unknown): AtomKind {
  if (typeof kind !== 'string') return 'prompt';
  const k = kind.trim().toLowerCase();
  if (k === 'form' || k === 'choice') return 'genui';
  if (k === 'execute') return 'tool';
  return 'prompt';
}
