/**
 * Harness registry — resolves agent harnesses by ID.
 * Built-in harnesses are statically defined; custom harnesses can be registered at runtime.
 */

import type { AgentHarness } from '@neos-work/shared';
import { FINANCE_HARNESSES } from './finance.js';
import { CODING_HARNESSES } from './coding.js';

const BUILT_IN_HARNESSES: AgentHarness[] = [
  ...FINANCE_HARNESSES,
  ...CODING_HARNESSES,
];

const registry = new Map<string, AgentHarness>(
  BUILT_IN_HARNESSES.map((h) => [h.id, h]),
);

/** Cap harness identity / prompt fields in the runtime registry. */
const HARNESS_ID_MAX = 200;
const HARNESS_NAME_MAX = 200;
const HARNESS_DESCRIPTION_MAX = 2_000;
const HARNESS_SYSTEM_PROMPT_MAX = 100_000;
const HARNESS_TOOLS_MAX = 100;
const HARNESS_TOOL_NAME_MAX = 100;

function isSafeId(id: string): boolean {
  return id.length > 0 && id.length <= HARNESS_ID_MAX && !/[\0\r\n]/.test(id);
}

export function resolveHarness(id: string): AgentHarness | undefined {
  if (typeof id !== 'string') return undefined;
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (/[\0\r\n]/.test(id)) return undefined;
  const trimmed = id.trim();
  if (!isSafeId(trimmed)) return undefined;
  return registry.get(trimmed);
}

export function listHarnesses(domain?: string): AgentHarness[] {
  // Trim + lower-case filter; blank → list all (including custom domains)
  const domainFilter =
    typeof domain === 'string' ? domain.trim().toLowerCase() || undefined : undefined;
  const all = [...registry.values()];
  return domainFilter ? all.filter((h) => h.domain === domainFilter) : all;
}

export function registerHarness(harness: AgentHarness): void {
  const id = typeof harness.id === 'string' ? harness.id.trim() : '';
  if (!isSafeId(id)) return;
  let name =
    typeof harness.name === 'string' ? harness.name.trim() || id : id;
  if (/[\0\r\n]/.test(name)) name = id;
  if (name.length > HARNESS_NAME_MAX) name = name.slice(0, HARNESS_NAME_MAX);
  const domainRaw =
    typeof harness.domain === 'string' ? harness.domain.trim().toLowerCase() : 'general';
  const domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as AgentHarness['domain'])
    : 'general';
  let description =
    typeof harness.description === 'string' ? harness.description.trim() : harness.description;
  if (typeof description === 'string' && description.length > HARNESS_DESCRIPTION_MAX) {
    description = description.slice(0, HARNESS_DESCRIPTION_MAX);
  }
  let systemPrompt =
    typeof harness.systemPrompt === 'string' ? harness.systemPrompt.trim() : '';
  // Blank system prompts are not useful for agent runs (align with harness routes)
  if (!systemPrompt) return;
  if (systemPrompt.length > HARNESS_SYSTEM_PROMPT_MAX) {
    systemPrompt = systemPrompt.slice(0, HARNESS_SYSTEM_PROMPT_MAX);
  }
  const allowedTools = Array.isArray(harness.allowedTools)
    ? harness.allowedTools
        .map((t) => String(t).trim())
        .filter((t) => t.length > 0 && t.length <= HARNESS_TOOL_NAME_MAX && !/[\0\r\n]/.test(t))
        .slice(0, HARNESS_TOOLS_MAX)
    : [];
  registry.set(id, {
    ...harness,
    id,
    name,
    domain,
    description,
    systemPrompt,
    allowedTools,
    // Custom registrations are never built-in; preserve explicit true only if provided
    isBuiltIn: harness.isBuiltIn === true,
  });
}
