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
  const domainFilter = typeof domain === 'string' ? domain.trim() || undefined : undefined;
  const all = [...registry.values()];
  return domainFilter ? all.filter((h) => h.domain === domainFilter) : all;
}

export function registerHarness(harness: AgentHarness): void {
  const id = typeof harness.id === 'string' ? harness.id.trim() : '';
  if (!id) return;
  registry.set(id, { ...harness, id });
}
