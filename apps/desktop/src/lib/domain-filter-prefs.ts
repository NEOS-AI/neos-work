/** Persist domain filter chips for Blocks / Templates / Harnesses lists. */

export type DomainFilterPref = 'all' | 'finance' | 'coding' | 'general';

/** Shared chip order for Blocks / Templates / Harnesses toolbars. */
export const DOMAIN_FILTER_OPTIONS: readonly DomainFilterPref[] = [
  'all',
  'finance',
  'coding',
  'general',
] as const;

const KEYS = {
  blocks: 'neos-blocks-domain',
  templates: 'neos-templates-domain',
  harnesses: 'neos-harnesses-domain',
} as const;

export type DomainFilterScope = keyof typeof KEYS;

const DOMAIN_ALLOWED = new Set<string>(['all', 'finance', 'coding', 'general']);

function parseDomain(raw: unknown): DomainFilterPref | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return DOMAIN_ALLOWED.has(v) ? (v as DomainFilterPref) : null;
}

export function loadDomainFilter(scope: DomainFilterScope): DomainFilterPref {
  try {
    return parseDomain(localStorage.getItem(KEYS[scope])) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveDomainFilter(scope: DomainFilterScope, value: DomainFilterPref): void {
  try {
    const parsed = parseDomain(value);
    if (parsed) localStorage.setItem(KEYS[scope], parsed);
  } catch {
    // ignore quota / private mode
  }
}

/** Blocks list source chip (built-in vs custom). */
export type BlocksSourceFilter = 'all' | 'builtin' | 'custom';

const BLOCKS_SOURCE_KEY = 'neos-blocks-source';
const SOURCE_ALLOWED = new Set<string>(['all', 'builtin', 'custom']);

function parseSource(raw: unknown): BlocksSourceFilter | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return SOURCE_ALLOWED.has(v) ? (v as BlocksSourceFilter) : null;
}

export function loadBlocksSourceFilter(): BlocksSourceFilter {
  try {
    return parseSource(localStorage.getItem(BLOCKS_SOURCE_KEY)) ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveBlocksSourceFilter(value: BlocksSourceFilter): void {
  try {
    const parsed = parseSource(value);
    if (parsed) localStorage.setItem(BLOCKS_SOURCE_KEY, parsed);
  } catch {
    // ignore
  }
}
