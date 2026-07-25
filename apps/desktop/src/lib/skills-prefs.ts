/** Persist Skills page category chip (PLAN Task 5 polish). */

const CATEGORY_KEY = 'neos-skills-category';

/** Category filter value; dynamic categories from skills list, plus `all`. */
export function loadSkillsCategoryFilter(): string {
  try {
    const raw = localStorage.getItem(CATEGORY_KEY) ?? '';
    // Control-char stored values ignored (check before trim)
    if (!raw || /[\0\r\n]/.test(raw)) return 'all';
    const v = raw.trim();
    if (!v || v.length > 100) return 'all';
    return v;
  } catch {
    return 'all';
  }
}

export function saveSkillsCategoryFilter(category: string): void {
  try {
    // Control-char category → default all
    if (typeof category !== 'string' || /[\0\r\n]/.test(category)) {
      localStorage.setItem(CATEGORY_KEY, 'all');
      return;
    }
    const next = category.trim() || 'all';
    localStorage.setItem(CATEGORY_KEY, next.slice(0, 100));
  } catch {
    // ignore quota / private mode
  }
}
