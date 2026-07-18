/**
 * Plugin store — scans skill directories for open-design.json sidecar files
 * Skills directory: ~/.config/neos-work/skills/<plugin-name>/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const SKILLS_DIR = path.join(os.homedir(), '.config', 'neos-work', 'skills');

export interface PipelineStage {
  id: string;
  name: string;
  kind: 'discovery' | 'plan' | 'execute' | 'critique' | 'form' | 'choice';
  prompt?: string;
  outputKey?: string;
  humanInLoop?: boolean;
  schema?: unknown;
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
      const dir = path.join(SKILLS_DIR, entry.name);
      const manifestPath = path.join(dir, 'open-design.json');
      try {
        const raw = await fs.readFile(manifestPath, 'utf-8');
        const manifest = JSON.parse(raw) as PluginManifest;
        if (manifest.schemaVersion !== 'od-plugin/v1') continue;
        // Optionally load SKILL.md content
        const skillPath = path.join(dir, 'SKILL.md');
        try {
          manifest.skillContent = await fs.readFile(skillPath, 'utf-8');
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
  const plugins = await listPlugins();
  return plugins.find((p) => p.id === id) ?? null;
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
  const safe = options.skillDirName.replace(/[^a-zA-Z0-9_-]/g, '_');
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
  const title = options.name ?? safe;
  const description =
    options.description
    ?? (firstLine.replace(/^#+\s*/, '').slice(0, 200) || `Plugin upgraded from skill ${safe}`);

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
