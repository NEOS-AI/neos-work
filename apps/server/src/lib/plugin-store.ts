/**
 * Plugin store — scans skill directories for open-design.json sidecar files
 * Skills directory: ~/.config/neos-work/skills/<plugin-name>/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'neos-work', 'skills');

export type PipelineStageKind =
  | 'discovery'
  | 'plan'
  | 'execute'
  | 'critique'
  | 'form'
  | 'choice';

const PIPELINE_STAGE_KINDS = new Set<string>([
  'discovery',
  'plan',
  'execute',
  'critique',
  'form',
  'choice',
]);

export interface PipelineStage {
  id: string;
  name: string;
  kind: PipelineStageKind;
  prompt?: string;
  outputKey?: string;
  humanInLoop?: boolean;
  schema?: unknown;
}

/** Normalize pipeline stage kind (unknown → execute). */
export function normalizePipelineStageKind(raw: unknown): PipelineStageKind {
  const k = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return PIPELINE_STAGE_KINDS.has(k) ? (k as PipelineStageKind) : 'execute';
}

function normalizePipelineStages(raw: unknown): PipelineStage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stages: PipelineStage[] = [];
  for (const s of raw) {
    if (!s || typeof s !== 'object') continue;
    const stage = s as Partial<PipelineStage>;
    const id = typeof stage.id === 'string' ? stage.id.trim() : '';
    if (!id) continue;
    const name =
      typeof stage.name === 'string' ? stage.name.trim() || id : id;
    const kind = normalizePipelineStageKind(stage.kind);
    const outputKey =
      typeof stage.outputKey === 'string'
        ? stage.outputKey.trim() || undefined
        : undefined;
    const prompt =
      typeof stage.prompt === 'string' ? stage.prompt.trim() || undefined : undefined;
    stages.push({
      id,
      name,
      kind,
      prompt,
      outputKey,
      humanInLoop: Boolean(stage.humanInLoop),
      schema: stage.schema,
    });
  }
  return stages.length > 0 ? stages : undefined;
}

export interface PluginManifest {
  schemaVersion: 'od-plugin/v1';
  id: string;
  name: string;
  description?: string;
  version: string;
  pipeline?: PipelineStage[];
  inputFields?: { key: string; label: string; type: string; placeholder?: string }[];
  capabilityGates?: string[];
  /** skill content from SKILL.md */
  skillContent?: string;
  /** directory where the plugin lives */
  dir?: string;
}

export async function listPlugins(): Promise<PluginManifest[]> {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const plugins: PluginManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden skill directories
      if (!entry.name || entry.name.startsWith('.')) continue;
      const dir = path.join(SKILLS_DIR, entry.name);
      const manifestPath = path.join(dir, 'open-design.json');
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw) as PluginManifest;
        if (manifest.schemaVersion !== 'od-plugin/v1') continue;
        // Normalize identity fields (dir name fallback when id blank)
        const id =
          typeof manifest.id === 'string' && manifest.id.trim()
            ? manifest.id.trim()
            : entry.name.trim();
        if (!id) continue;
        manifest.id = id;
        if (typeof manifest.name === 'string') {
          manifest.name = manifest.name.trim() || id;
        } else {
          manifest.name = id;
        }
        if (typeof manifest.description === 'string') {
          manifest.description = manifest.description.trim() || undefined;
        }
        if (typeof manifest.version === 'string') {
          manifest.version = manifest.version.trim() || '0.0.0';
        }
        // Normalize pipeline stages (kind allow-list, trim ids/names)
        if (manifest.pipeline !== undefined) {
          const stages = normalizePipelineStages(manifest.pipeline);
          if (stages) manifest.pipeline = stages;
          else delete manifest.pipeline;
        }
        // Optionally load SKILL.md content (whitespace-only → omit)
        const skillPath = path.join(dir, 'SKILL.md');
        try {
          const skillBody = await fs.readFile(skillPath, 'utf-8');
          const trimmedSkill = skillBody.trim();
          if (trimmedSkill) manifest.skillContent = skillBody;
        } catch {
          // No SKILL.md — ok
        }
        manifest.dir = dir;
        plugins.push(manifest);
      } catch {
        // No open-design.json or invalid JSON — skip
      }
    }
    return plugins;
  } catch {
    return [];
  }
}

export async function getPlugin(id: string): Promise<PluginManifest | null> {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return null;
  const plugins = await listPlugins();
  return plugins.find((p) => p.id === trimmed) ?? null;
}

/**
 * Upgrade a skill directory to a plugin by writing open-design.json sidecar
 * (MVP 4-step pipeline: discovery → plan → execute → critique).
 */
export async function upgradeSkillToPlugin(options: {
  skillDirName: string;
  name?: string;
  description?: string;
}): Promise<PluginManifest> {
  const trimmed =
    typeof options.skillDirName === 'string' ? options.skillDirName.trim() : '';
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  if (!safe) throw new Error('Invalid skill directory name');
  const dir = path.join(SKILLS_DIR, safe);
  const skillPath = path.join(dir, 'SKILL.md');
  try {
    await fs.access(skillPath);
  } catch {
    throw new Error(`Skill directory not found: ${safe}`);
  }

  const manifestPath = path.join(dir, 'open-design.json');
  try {
    await fs.access(manifestPath);
    // Already a plugin — return existing
    const existing = await getPlugin(safe);
    if (existing) return existing;
  } catch {
    // create
  }

  let skillBody = '';
  try {
    skillBody = await fs.readFile(skillPath, 'utf-8');
  } catch {
    // ignore
  }
  const firstLine = skillBody.split('\n').find((l) => l.trim() && !l.startsWith('---') && !l.startsWith('name:')) ?? '';
  const title =
    (typeof options.name === 'string' ? options.name.trim() : '') || safe;
  const description =
    (typeof options.description === 'string' ? options.description.trim() : '')
    || (firstLine.replace(/^#+\s*/, '').slice(0, 200) || `Plugin upgraded from skill ${safe}`);

  const manifest: PluginManifest = {
    schemaVersion: 'od-plugin/v1',
    id: safe,
    name: title,
    description,
    version: '0.1.0',
    pipeline: [
      {
        id: 'discovery',
        name: 'Discovery',
        kind: 'discovery',
        prompt: `Using the skill context, analyze the user request and list constraints.\n\nSkill:\n{{skill}}\n\nInputs:\n{{inputs}}`,
        outputKey: 'discovery',
      },
      {
        id: 'plan',
        name: 'Plan',
        kind: 'plan',
        prompt: `Create a short plan based on discovery.\n\nDiscovery:\n{{discovery}}`,
        outputKey: 'plan',
      },
      {
        id: 'execute',
        name: 'Execute',
        kind: 'execute',
        prompt: `Execute the plan and produce the primary deliverable.\n\nPlan:\n{{plan}}`,
        outputKey: 'result',
      },
      {
        id: 'critique',
        name: 'Critique',
        kind: 'critique',
        prompt: `Review the result for quality and gaps.\n\nResult:\n{{result}}`,
        outputKey: 'critique',
      },
    ],
    inputFields: [
      { key: 'goal', label: 'Goal', type: 'textarea', placeholder: 'What should this plugin accomplish?' },
    ],
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  manifest.skillContent = skillBody;
  manifest.dir = dir;
  return manifest;
}
