/**
 * Built-in atom catalog (≥12 priority atoms for OD plugin pipeline).
 */

import type { PluginAtom } from './types.js';

/** Official priority atom set (Task 6 — representative ≥ 12). */
export const BUILTIN_ATOMS: readonly PluginAtom[] = [
  {
    id: 'prompt.system',
    name: 'System prompt fragment',
    kind: 'prompt',
    description: 'Inject a system-level prompt fragment into the agent context.',
    capabilities: ['prompt.write'],
    trust: 'builtin',
  },
  {
    id: 'prompt.user',
    name: 'User prompt fragment',
    kind: 'prompt',
    description: 'Inject a user-turn prompt fragment.',
    capabilities: ['prompt.write'],
    trust: 'builtin',
  },
  {
    id: 'tool.shell',
    name: 'Shell tool gate',
    kind: 'tool',
    description: 'Allow or deny shell tool use for a pipeline stage.',
    capabilities: ['tool.shell'],
    trust: 'builtin',
  },
  {
    id: 'tool.filesystem',
    name: 'Filesystem tool gate',
    kind: 'tool',
    description: 'Allow or deny filesystem read/write tools.',
    capabilities: ['tool.fs'],
    trust: 'builtin',
  },
  {
    id: 'tool.web_search',
    name: 'Web search tool gate',
    kind: 'tool',
    description: 'Allow or deny web_search tool.',
    capabilities: ['tool.web'],
    trust: 'builtin',
  },
  {
    id: 'transform.json_parse',
    name: 'JSON parse transform',
    kind: 'transform',
    description: 'Parse model output as JSON for downstream stages.',
    capabilities: ['transform'],
    trust: 'builtin',
  },
  {
    id: 'transform.markdown_extract',
    name: 'Markdown extract',
    kind: 'transform',
    description: 'Extract fenced code or sections from markdown.',
    capabilities: ['transform'],
    trust: 'builtin',
  },
  {
    id: 'gate.capability',
    name: 'Capability gate',
    kind: 'gate',
    description: 'Deny stage when required capabilities are missing.',
    capabilities: ['gate'],
    trust: 'builtin',
  },
  {
    id: 'gate.hitl',
    name: 'Human-in-the-loop gate',
    kind: 'gate',
    description: 'Pause pipeline until user confirms (HITL resume).',
    capabilities: ['gate.hitl'],
    trust: 'builtin',
  },
  {
    id: 'genui.form',
    name: 'GenUI form',
    kind: 'genui',
    description: 'Present a form surface and collect structured input.',
    capabilities: ['genui'],
    trust: 'builtin',
  },
  {
    id: 'genui.choice',
    name: 'GenUI choice',
    kind: 'genui',
    description: 'Present multi-choice selection to the user.',
    capabilities: ['genui'],
    trust: 'builtin',
  },
  {
    id: 'genui.confirm',
    name: 'GenUI confirmation',
    kind: 'genui',
    description: 'Yes/no confirmation dialog.',
    capabilities: ['genui'],
    trust: 'builtin',
  },
  {
    id: 'editor.apply_patch',
    name: 'Editor apply patch',
    kind: 'editor',
    description: 'Apply a selection-scoped or file patch via project files API.',
    capabilities: ['editor.write', 'project.files'],
    trust: 'builtin',
  },
  {
    id: 'media.generate_image',
    name: 'Generate image',
    kind: 'media',
    description: 'Request image generation through media providers.',
    capabilities: ['media.image'],
    trust: 'builtin',
  },
  {
    id: 'deploy.preflight',
    name: 'Deploy preflight',
    kind: 'deploy',
    description: 'Run deploy preflight checks for project-scoped deploys.',
    capabilities: ['deploy'],
    trust: 'builtin',
  },
] as const;

export function listBuiltinAtomIds(): string[] {
  return BUILTIN_ATOMS.map((a) => a.id);
}
