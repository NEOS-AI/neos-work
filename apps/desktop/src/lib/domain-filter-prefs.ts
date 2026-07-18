/** Persist domain filter chips for Blocks / Templates / Harnesses lists. */

export type DomainFilterPref = 'all' | 'finance' | 'coding' | 'general';

const KEYS = {
  blocks: 'neos-blocks-domain',
  templates: 'neos-templates-domain',
  harnesses: 'neos-harnesses-domain',
} as const;

export type DomainFilterScope = keyof typeof KEYS;

export function loadDomainFilter(scope: DomainFilterScope): DomainFilterPref {
  try {
    const v = localStorage.getItem(KEYS[scope]);
    if (v === 'finance' || v === 'coding' || v === 'general' || v === 'all') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveDomainFilter(scope: DomainFilterScope, value: DomainFilterPref): void {
  try {
    if (value === 'all' || value === 'finance' || value === 'coding' || value === 'general') {
      localStorage.setItem(KEYS[scope], value);
    }
  } catch {
    // ignore quota / private mode
  }
}

/** Blocks list source chip (built-in vs custom). */
export type BlocksSourceFilter = 'all' | 'builtin' | 'custom';

const BLOCKS_SOURCE_KEY = 'neos-blocks-source';

export function loadBlocksSourceFilter(): BlocksSourceFilter {
  try {
    const v = localStorage.getItem(BLOCKS_SOURCE_KEY);
    if (v === 'builtin' || v === 'custom' || v === 'all') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveBlocksSourceFilter(value: BlocksSourceFilter): void {
  try {
    if (value === 'all' || value === 'builtin' || value === 'custom') {
      localStorage.setItem(BLOCKS_SOURCE_KEY, value);
    }
  } catch {
    // ignore
  }
}
