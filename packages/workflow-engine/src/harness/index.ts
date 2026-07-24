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

export function resolveHarness(id: string): AgentHarness | undefined {
  const trimmed = typeof id === 'string' ? id.trim() : '';
  if (!trimmed) return undefined;
  return registry.get(trimmed);
}

export function listHarnesses(domain?: string): AgentHarness[] {
  const domainRaw = typeof domain === 'string' ? domain.trim().toLowerCase() || undefined : undefined;
  const domainFilter =
    domainRaw && (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
      ? domainRaw
      : domainRaw
        ? domainRaw // keep unknown filters as exact match after lower-case
        : undefined;
  const all = [...registry.values()];
  return domainFilter ? all.filter((h) => h.domain === domainFilter) : all;
}

export function registerHarness(harness: AgentHarness): void {
  const id = typeof harness.id === 'string' ? harness.id.trim() : '';
  if (!id) return;
  const name =
    typeof harness.name === 'string' ? harness.name.trim() || id : id;
  const domainRaw =
    typeof harness.domain === 'string' ? harness.domain.trim().toLowerCase() : 'general';
  const domain = (['finance', 'coding', 'general'] as const).includes(domainRaw as never)
    ? (domainRaw as AgentHarness['domain'])
    : 'general';
  const description =
    typeof harness.description === 'string' ? harness.description.trim() : harness.description;
  const systemPrompt =
    typeof harness.systemPrompt === 'string' ? harness.systemPrompt.trim() : harness.systemPrompt;
  const allowedTools = Array.isArray(harness.allowedTools)
    ? harness.allowedTools.map((t) => String(t).trim()).filter(Boolean)
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
