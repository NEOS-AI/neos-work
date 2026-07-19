/** Persist Skills page category chip (PLAN Task 5 polish). */

const CATEGORY_KEY = 'neos-skills-category';

/** Category filter value; dynamic categories from skills list, plus `all`. */
export function loadSkillsCategoryFilter(): string {
  try {
    const v = localStorage.getItem(CATEGORY_KEY)?.trim();
    if (!v) return 'all';
    return v;
  } catch {
    return 'all';
  }
}

export function saveSkillsCategoryFilter(category: string): void {
  try {
    const next = category.trim() || 'all';
    localStorage.setItem(CATEGORY_KEY, next);
  } catch {
    // ignore quota / private mode
  }
}
