/**
 * Plugin store — scans skill directories for open-design.json sidecar files
 * Skills directory: ~/.config/neos-work/skills/<plugin-name>/
 */

import { existsSync, type Dirent } from 'node:fs';
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
  // Control-char check before trim so "\nplan" is not accepted as plan
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return 'execute';
  const k = raw.trim().toLowerCase();
  return PIPELINE_STAGE_KINDS.has(k) ? (k as PipelineStageKind) : 'execute';
}

/** Cap pipeline stages / stage field sizes (plugin MVP hygiene). */
const PIPELINE_STAGES_MAX = 20;
const PIPELINE_STAGE_ID_MAX = 100;
const PIPELINE_STAGE_NAME_MAX = 200;
const PIPELINE_STAGE_PROMPT_MAX = 100_000;
const PLUGIN_SKILL_CONTENT_MAX = 500_000;
const PLUGIN_DESCRIPTION_MAX = 4_000;

function normalizePipelineStages(raw: unknown): PipelineStage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const stages: PipelineStage[] = [];
  for (const s of raw) {
    if (stages.length >= PIPELINE_STAGES_MAX) break;
    if (!s || typeof s !== 'object') continue;
    const stage = s as Partial<PipelineStage>;
    const idRaw = typeof stage.id === 'string' ? stage.id : '';
    // Control-char check before trim
    if (!idRaw || /[\0\r\n]/.test(idRaw)) continue;
    const id = idRaw.trim();
    if (!id || id.length > PIPELINE_STAGE_ID_MAX) continue;
    let name = id;
    if (typeof stage.name === 'string' && !/[\0\r\n]/.test(stage.name)) {
      name = stage.name.trim() || id;
    }
    if (name.length > PIPELINE_STAGE_NAME_MAX) name = name.slice(0, PIPELINE_STAGE_NAME_MAX);
    const kind = normalizePipelineStageKind(stage.kind);
    let outputKey: string | undefined;
    if (typeof stage.outputKey === 'string' && !/[\0\r\n]/.test(stage.outputKey)) {
      const ok = stage.outputKey.trim();
      if (ok && ok.length <= PIPELINE_STAGE_ID_MAX) outputKey = ok;
    }
    let prompt: string | undefined;
    if (typeof stage.prompt === 'string' && !/\0/.test(stage.prompt)) {
      // Allow newlines inside multi-line prompts; reject null bytes
      prompt = stage.prompt.trim() || undefined;
    }
    if (prompt && prompt.length > PIPELINE_STAGE_PROMPT_MAX) {
      prompt = prompt.slice(0, PIPELINE_STAGE_PROMPT_MAX);
    }
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

/** Marketplace channel for UI filters. */
export type PluginChannel = 'user' | 'official' | 'community' | 'bundled';

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
  /** Marketplace channel (user skills vs bundled official/community). */
  channel?: PluginChannel;
}

export function resolveBundledPluginsDir(
  explicit?: string | null,
  cwd: string = process.cwd(),
): string | null {
  if (typeof explicit === 'string' && !/[\0\r\n]/.test(explicit)) {
    const t = explicit.trim();
    if (t && t.length <= 4_096 && existsSync(t)) return path.resolve(t);
  }
  const env = process.env.NEOS_BUNDLED_PLUGINS;
  if (typeof env === 'string' && !/[\0\r\n]/.test(env)) {
    const t = env.trim();
    if (t && t.length <= 4_096 && existsSync(t)) return path.resolve(t);
  }
  for (const c of [
    path.join(cwd, 'plugins'),
    path.join(cwd, '..', 'plugins'),
    path.join(cwd, '..', '..', 'plugins'),
    path.join(cwd, '..', '..', '..', 'plugins'),
  ]) {
    try {
      if (existsSync(c)) return path.resolve(c);
    } catch {
      /* ignore */
    }
  }
  return null;
}

async function loadPluginFromDir(
  dir: string,
  fallbackId: string,
  channel: PluginChannel,
): Promise<PluginManifest | null> {
  const manifestPath = path.join(dir, 'open-design.json');
  try {
    // Refuse planted symlink manifests (escape to outside content)
    try {
      const mst = await fs.lstat(manifestPath);
      if (mst.isSymbolicLink() || !mst.isFile()) return null;
    } catch {
      return null;
    }
    const raw = await fs.readFile(manifestPath, 'utf-8');
    const manifest = JSON.parse(raw) as PluginManifest & { channel?: PluginChannel };
    if (manifest.schemaVersion !== 'od-plugin/v1') return null;
    let id = '';
    if (typeof manifest.id === 'string' && !/[\0\r\n]/.test(manifest.id)) {
      id = manifest.id.trim();
    }
    if (!id) id = fallbackId.trim();
    if (!id || /[\0\r\n]/.test(id) || id.length > 200) return null;
    manifest.id = id;
    if (typeof manifest.name === 'string' && !/[\0\r\n]/.test(manifest.name)) {
      manifest.name = manifest.name.trim() || id;
    } else {
      manifest.name = id;
    }
    if (typeof manifest.description === 'string' && !/\0/.test(manifest.description)) {
      let d = manifest.description.replace(/[\r\n]+/g, ' ').trim() || undefined;
      if (d && d.length > PLUGIN_DESCRIPTION_MAX) d = d.slice(0, PLUGIN_DESCRIPTION_MAX);
      manifest.description = d;
    }
    if (typeof manifest.version === 'string' && !/[\0\r\n]/.test(manifest.version)) {
      const v = manifest.version.trim() || '0.0.0';
      manifest.version = v.length > 64 ? v.slice(0, 64) : v;
    } else {
      // Missing / non-string / control-char versions default for type + UI safety
      manifest.version = '0.0.0';
    }
    if (manifest.capabilityGates !== undefined) {
      if (Array.isArray(manifest.capabilityGates)) {
        const gates: string[] = [];
        for (const c of manifest.capabilityGates.slice(0, 50)) {
          if (typeof c !== 'string' || /[\0\r\n]/.test(c)) continue;
          const t = c.trim();
          if (t && t.length <= 120) gates.push(t);
        }
        manifest.capabilityGates = gates;
      } else {
        delete manifest.capabilityGates;
      }
    }
    if (manifest.pipeline !== undefined) {
      const stages = normalizePipelineStages(manifest.pipeline);
      if (stages) manifest.pipeline = stages;
      else delete manifest.pipeline;
    }
    const skillPath = path.join(dir, 'SKILL.md');
    try {
      const sst = await fs.lstat(skillPath);
      if (!sst.isSymbolicLink() && sst.isFile()) {
        const skillBody = await fs.readFile(skillPath, 'utf-8');
        if (!/\0/.test(skillBody)) {
          const trimmedSkill = skillBody.trim();
          if (trimmedSkill) {
            manifest.skillContent =
              skillBody.length > PLUGIN_SKILL_CONTENT_MAX
                ? skillBody.slice(0, PLUGIN_SKILL_CONTENT_MAX) + '\n…[skill truncated]'
                : skillBody;
          }
        }
      }
    } catch {
      // No SKILL.md
    }
    manifest.dir = dir;
    (manifest as PluginManifest & { channel?: PluginChannel }).channel = channel;
    return manifest;
  } catch {
    return null;
  }
}

/**
 * Scan a root for plugin packages.
 * - Direct children with open-design.json
 * - One-level groups (_official, community, …) containing packages
 */
async function scanPluginRoot(
  root: string,
  channel: PluginChannel,
): Promise<PluginManifest[]> {
  const out: PluginManifest[] = [];
  let entries: Dirent[];
  try {
    // Explicit Dirent[] — Node overloads make ReturnType<typeof fs.readdir> resolve to Buffer names
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    // Skip symlink dirs (Dirent.isDirectory is false for links; belt-and-suspenders)
    if (entry.isSymbolicLink() || !entry.isDirectory() || !entry.name || entry.name.startsWith('.')) {
      continue;
    }
    const dir = path.join(root, entry.name);
    // Try as package
    const direct = await loadPluginFromDir(dir, entry.name, channel);
    if (direct) {
      out.push(direct);
      continue;
    }
    // Try as group folder (_official / community / …)
    let children: Dirent[];
    try {
      children = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const groupChannel: PluginChannel =
      entry.name === '_official' || entry.name === 'official'
        ? 'official'
        : entry.name === 'community'
          ? 'community'
          : channel;
    for (const child of children) {
      if (child.isSymbolicLink() || !child.isDirectory() || !child.name || child.name.startsWith('.')) {
        continue;
      }
      const pkg = await loadPluginFromDir(
        path.join(dir, child.name),
        child.name,
        groupChannel,
      );
      if (pkg) out.push(pkg);
    }
  }
  return out;
}

/**
 * List plugins: user skills dir first, then bundled marketplace `plugins/`.
 * Same plugin id → user wins (shadowing).
 */
export async function listPlugins(opts?: {
  bundledRoot?: string | null;
}): Promise<PluginManifest[]> {
  const byId = new Map<string, PluginManifest>();

  // 1) User-installed (skills with open-design.json)
  for (const p of await scanPluginRoot(SKILLS_DIR, 'user')) {
    byId.set(p.id, p);
  }

  // 2) Bundled marketplace (cwd/env/explicit; group folders set official/community)
  const bundled = resolveBundledPluginsDir(opts?.bundledRoot ?? null);
  if (bundled) {
    for (const p of await scanPluginRoot(bundled, 'bundled')) {
      if (!byId.has(p.id)) byId.set(p.id, p);
    }
  }

  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Practical bound for plugin id lookups. */
const PLUGIN_LOOKUP_ID_MAX = 100;

function safePluginLookupId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(raw)) return '';
  const id = raw.trim();
  if (!id || id.length > PLUGIN_LOOKUP_ID_MAX) return '';
  return id;
}

export async function getPlugin(id: string): Promise<PluginManifest | null> {
  const trimmed = safePluginLookupId(id);
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
  const rawName =
    typeof options.skillDirName === 'string' ? options.skillDirName : '';
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(rawName) || rawName.trim().length > 200) {
    throw new Error('Invalid skill directory name');
  }
  const trimmed = rawName.trim();
  if (!trimmed) throw new Error('Invalid skill directory name');
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
  // Null-byte skill body cannot contribute title/description lines
  if (/\0/.test(skillBody)) skillBody = '';
  const firstLine =
    skillBody
      .split('\n')
      .find((l) => {
        if (/[\0\r\n]/.test(l)) return false;
        const t = l.trim();
        return t.length > 0 && !t.startsWith('---') && !t.startsWith('name:');
      }) ?? '';
  let title =
    (typeof options.name === 'string' && !/[\0\r\n]/.test(options.name)
      ? options.name.trim()
      : '') || safe;
  if (title.length > 200) title = title.slice(0, 200);
  let description =
    (typeof options.description === 'string' && !/[\0\r\n]/.test(options.description)
      ? options.description.trim()
      : '')
    || (firstLine.replace(/^#+\s*/, '').slice(0, 200) || `Plugin upgraded from skill ${safe}`);
  if (description.length > 2_000) description = description.slice(0, 2_000);

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
  manifest.channel = 'user';
  return manifest;
}
