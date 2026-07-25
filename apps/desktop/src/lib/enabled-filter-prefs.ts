/** Persist ON/OFF/All enabled chips for list pages (Skills, Routines, Memory). */

export type EnabledFilterPref = 'all' | 'enabled' | 'disabled';

const KEYS = {
  skills: 'neos-skills-enabled',
  routines: 'neos-routines-enabled',
  memory: 'neos-memory-enabled',
} as const;

export type EnabledFilterScope = keyof typeof KEYS;

const ALLOWED = new Set<string>(['all', 'enabled', 'disabled']);

function parseEnabled(raw: unknown): EnabledFilterPref | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return ALLOWED.has(v) ? (v as EnabledFilterPref) : null;
}

export function loadEnabledFilter(scope: EnabledFilterScope): EnabledFilterPref {
  try {
    const parsed = parseEnabled(localStorage.getItem(KEYS[scope]));
    return parsed ?? 'all';
  } catch {
    return 'all';
  }
}

export function saveEnabledFilter(scope: EnabledFilterScope, value: EnabledFilterPref): void {
  try {
    const parsed = parseEnabled(value);
    if (parsed) localStorage.setItem(KEYS[scope], parsed);
  } catch {
    // ignore quota / private mode
  }
}
