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
