/** Persist ON/OFF/All enabled chips for list pages (Skills, Routines, Memory). */

export type EnabledFilterPref = 'all' | 'enabled' | 'disabled';

const KEYS = {
  skills: 'neos-skills-enabled',
  routines: 'neos-routines-enabled',
  memory: 'neos-memory-enabled',
} as const;

export type EnabledFilterScope = keyof typeof KEYS;

export function loadEnabledFilter(scope: EnabledFilterScope): EnabledFilterPref {
  try {
    const v = localStorage.getItem(KEYS[scope]);
    if (v === 'enabled' || v === 'disabled' || v === 'all') return v;
    return 'all';
  } catch {
    return 'all';
  }
}

export function saveEnabledFilter(scope: EnabledFilterScope, value: EnabledFilterPref): void {
  try {
    if (value === 'all' || value === 'enabled' || value === 'disabled') {
      localStorage.setItem(KEYS[scope], value);
    }
  } catch {
    // ignore quota / private mode
  }
}
