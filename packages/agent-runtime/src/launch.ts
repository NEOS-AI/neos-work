import type { AgentCliDef, BuildLaunchResult, PathOverrides } from './types.js';
import { getDefById } from './defs/catalog.js';
import { resolveBinaryPath } from './detection.js';

export const PROMPT_MAX_CHARS = 400_000;

function sanitizePrompt(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Allow newlines in prompts; reject null bytes only
  if (/\0/.test(raw)) {
    throw new Error('prompt contains invalid control characters');
  }
  let prompt = raw.trim();
  if (!prompt) throw new Error('prompt is required');
  if (prompt.length > PROMPT_MAX_CHARS) {
    prompt = prompt.slice(0, PROMPT_MAX_CHARS) + '\n…[prompt truncated]';
  }
  return prompt;
}

/**
 * Build bin + argv (or stdin payload) for a CLI def.
 * Compatible with existing server spawn for the original 3 CLIs.
 */
export function buildLaunchArgs(
  def: AgentCliDef,
  promptRaw: unknown,
  binOverride?: string | null,
): BuildLaunchResult {
  const prompt = sanitizePrompt(promptRaw);
  const bin =
    typeof binOverride === 'string' && binOverride.trim() && !/[\0\r\n]/.test(binOverride)
      ? binOverride.trim()
      : def.launch.binary;

  if (def.launch.mode === 'stdin') {
    const args = def.launch.argsTemplate
      .map((a) => a.replaceAll('{prompt}', '').replaceAll('{cwd}', process.cwd()))
      .filter((a) => a.length > 0);
    return { bin, args, mode: 'stdin', stdinPayload: prompt };
  }

  const args = def.launch.argsTemplate.map((part) =>
    part.replaceAll('{prompt}', prompt).replaceAll('{cwd}', process.cwd()),
  );
  return { bin, args, mode: 'argv' };
}

export async function buildLaunchForId(
  agentId: string,
  prompt: unknown,
  overrides?: PathOverrides,
): Promise<BuildLaunchResult & { def: AgentCliDef }> {
  const def = getDefById(agentId);
  if (!def) throw new Error(`Unknown agent id: ${agentId}`);
  const path = await resolveBinaryPath(def, overrides);
  const launch = buildLaunchArgs(def, prompt, path);
  return { ...launch, def };
}
