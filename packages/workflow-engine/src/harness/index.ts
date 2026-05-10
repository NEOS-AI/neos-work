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
  return registry.get(id);
}

export function listHarnesses(domain?: string): AgentHarness[] {
  const all = [...registry.values()];
  return domain ? all.filter((h) => h.domain === domain) : all;
}

export function registerHarness(harness: AgentHarness): void {
  registry.set(harness.id, harness);
}
