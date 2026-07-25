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
  // Control-char domain filter → list all (check before trim; align with listBlocks)
  const domainFilter =
    typeof domain === 'string' && domain.trim() && !/[\0\r\n]/.test(domain)
      ? domain.trim().toLowerCase() || undefined
      : undefined;
  const all = [...registry.values()];
  return domainFilter ? all.filter((h) => h.domain === domainFilter) : all;
}

export function registerHarness(harness: AgentHarness): void {
  // Control-char check before trim so "\nmy-id" is not registered as "my-id"
  const idRaw = typeof harness.id === 'string' ? harness.id : '';
  if (!idRaw || /[\0\r\n]/.test(idRaw)) return;
  const id = idRaw.trim();
  if (!isSafeId(id)) return;

  let name = id;
  if (typeof harness.name === 'string' && !/[\0\r\n]/.test(harness.name)) {
    name = harness.name.trim() || id;
  }
  if (name.length > HARNESS_NAME_MAX) name = name.slice(0, HARNESS_NAME_MAX);

  // Control-char domain → general
  const domainRaw =
    typeof harness.domain === 'string' && !/[\0\r\n]/.test(harness.domain)
      ? harness.domain.trim().toLowerCase() || 'general'
      : 'general';
  const domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as AgentHarness['domain'])
    : 'general';

  let description: string | undefined;
  if (typeof harness.description === 'string') {
    // Collapse control chars for list/UI hygiene (align with harness DB)
    description = harness.description.replace(/[\0\r\n]/g, ' ').trim();
  } else {
    description = harness.description;
  }
  if (typeof description === 'string' && description.length > HARNESS_DESCRIPTION_MAX) {
    description = description.slice(0, HARNESS_DESCRIPTION_MAX);
  }

  // systemPrompt: reject control chars entirely (align with harness routes)
  if (typeof harness.systemPrompt !== 'string' || /[\0\r\n]/.test(harness.systemPrompt)) {
    return;
  }
  let systemPrompt = harness.systemPrompt.trim();
  // Blank system prompts are not useful for agent runs
  if (!systemPrompt) return;
  if (systemPrompt.length > HARNESS_SYSTEM_PROMPT_MAX) {
    systemPrompt = systemPrompt.slice(0, HARNESS_SYSTEM_PROMPT_MAX);
  }

  // Control-char tool names dropped before trim
  const allowedTools = Array.isArray(harness.allowedTools)
    ? harness.allowedTools
        .map((t) => String(t ?? ''))
        .filter((t) => t.length > 0 && !/[\0\r\n]/.test(t))
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= HARNESS_TOOL_NAME_MAX)
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
