import { accessSync, constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentCliDef, AgentDetectResult, PathOverrides } from './types.js';
import { AGENT_CLI_DEFS } from './defs/catalog.js';

const execFileAsync = promisify(execFile);

export type WhichFn = (cmd: string) => Promise<string | null>;
export type VersionFn = (binPath: string, flag: string) => Promise<string | undefined>;

export async function defaultWhich(cmd: string): Promise<string | null> {
  if (typeof cmd !== 'string' || !cmd.trim() || /[\0\r\n]/.test(cmd)) return null;
  try {
    const { stdout } = await execFileAsync('which', [cmd.trim()], { timeout: 3000 });
    const line = stdout.replace(/\0/g, '').split('\n')[0] ?? '';
    const p = line.trim();
    if (!p || /[\0\r\n]/.test(p)) return null;
    return p;
  } catch {
    return null;
  }
}

export async function defaultVersionProbe(
  binPath: string,
  flag = '--version',
): Promise<string | undefined> {
  if (typeof binPath !== 'string' || !binPath || /[\0\r\n]/.test(binPath)) return undefined;
  try {
    const { stdout } = await execFileAsync(binPath, [flag], { timeout: 3000 });
    const line = (stdout.replace(/\0/g, '').split('\n')[0] ?? '').trim();
    if (!line || line.length > 200) return undefined;
    return line;
  } catch {
    return undefined;
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function resolveBinaryPath(
  def: AgentCliDef,
  overrides?: PathOverrides,
  whichFn: WhichFn = defaultWhich,
): Promise<string | null> {
  const overrideRaw = overrides?.[def.id];
  if (typeof overrideRaw === 'string' && !/[\0\r\n]/.test(overrideRaw)) {
    const override = overrideRaw.trim();
    if (override && override.length <= 1_024 && isExecutable(override)) {
      return override;
    }
  }
  return whichFn(def.launch.binary);
}

export async function detectAgent(
  def: AgentCliDef,
  overrides?: PathOverrides,
  deps: { which?: WhichFn; version?: VersionFn } = {},
): Promise<AgentDetectResult> {
  const whichFn = deps.which ?? defaultWhich;
  const versionFn = deps.version ?? defaultVersionProbe;
  const path = await resolveBinaryPath(def, overrides, whichFn);
  if (!path) {
    return {
      id: def.id,
      name: def.name,
      streamFormat: def.streamFormat,
      settingKey: def.settingKey,
      available: false,
      binary: def.launch.binary,
    };
  }
  const version = await versionFn(path, def.launch.versionFlag ?? '--version');
  return {
    id: def.id,
    name: def.name,
    path,
    version,
    streamFormat: def.streamFormat,
    settingKey: def.settingKey,
    available: true,
  };
}

export async function detectAllAgents(
  overrides?: PathOverrides,
  deps: { which?: WhichFn; version?: VersionFn; defs?: readonly AgentCliDef[] } = {},
): Promise<AgentDetectResult[]> {
  const defs = deps.defs ?? AGENT_CLI_DEFS;
  const results: AgentDetectResult[] = [];
  for (const def of defs) {
    results.push(await detectAgent(def, overrides, deps));
  }
  return results;
}

/** Only available agents (legacy detectCLIs shape-friendly). */
export async function detectAvailableAgents(
  overrides?: PathOverrides,
  deps: { which?: WhichFn; version?: VersionFn; defs?: readonly AgentCliDef[] } = {},
): Promise<Array<{ id: string; name: string; path: string; version?: string }>> {
  const all = await detectAllAgents(overrides, deps);
  return all
    .filter((a): a is Extract<AgentDetectResult, { available: true }> => a.available)
    .map((a) => ({ id: a.id, name: a.name, path: a.path, version: a.version }));
}
