/**
 * Worker list filter by agent node type (v0.4 alias of harness-filter).
 * Prefer these names in new code; harness-filter remains for compatibility.
 */
export {
  allowedDomainsForAgentNode,
  filterAndSortHarnesses as filterAndSortWorkers,
  filterAndSortHarnesses,
  type HarnessLike as WorkerLike,
  type HarnessLike,
} from './harness-filter.js';
