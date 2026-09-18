/**
 * neos-skill-source.json sidecar — remote skill provenance (not neos-remote.json).
 */

import { lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { SkillProvenance } from '@neos-work/shared';

export const SKILL_PROVENANCE_FILENAME = 'neos-skill-source.json';

function nonEmptyString(raw: unknown): string | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const t = raw.trim();
  return t.length > 0 ? t : null;
}

export function validateSkillProvenance(raw: unknown): SkillProvenance | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.schemaVersion !== 'neos-skill-source/v1') return null;
  if (o.origin !== 'skills.sh' && o.origin !== 'github' && o.origin !== 'well-known') return null;
  if (o.trust !== 'unverified') return null;
  const id = nonEmptyString(o.id);
  const source = nonEmptyString(o.source);
  const slug = nonEmptyString(o.slug);
  const installedAt = nonEmptyString(o.installedAt);
  if (!id || !source || !slug || !installedAt) return null;

  const out: SkillProvenance = {
    schemaVersion: 'neos-skill-source/v1',
    origin: o.origin,
    id,
    source,
    slug,
    trust: 'unverified',
    installedAt,
  };

  if (o.installUrl !== undefined) {
    const v = nonEmptyString(o.installUrl);
    if (!v) return null;
    out.installUrl = v;
  }
  if (o.ref !== undefined) {
    const v = nonEmptyString(o.ref);
    if (!v) return null;
    out.ref = v;
  }
  if (o.hash !== undefined) {
    const v = nonEmptyString(o.hash);
    if (!v) return null;
    out.hash = v;
  }
  if (o.updatedAt !== undefined) {
    const v = nonEmptyString(o.updatedAt);
    if (!v) return null;
    out.updatedAt = v;
  }
  return out;
}

export async function readSkillProvenance(packageDir: string): Promise<SkillProvenance | null> {
  if (typeof packageDir !== 'string' || /[\0\r\n]/.test(packageDir)) return null;
  const base = packageDir.trim();
  if (!base) return null;
  const file = join(base, SKILL_PROVENANCE_FILENAME);
  try {
    const st = await lstat(file);
    if (st.isSymbolicLink() || !st.isFile()) return null;
    const text = await readFile(file, 'utf8');
    if (/\0/.test(text)) return null;
    return validateSkillProvenance(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function writeSkillProvenance(
  packageDir: string,
  provenance: SkillProvenance,
): Promise<void> {
  const valid = validateSkillProvenance(provenance);
  if (!valid) throw new Error('Invalid skill provenance');
  if (typeof packageDir !== 'string' || /[\0\r\n]/.test(packageDir) || !packageDir.trim()) {
    throw new Error('Invalid skill package directory');
  }
  const file = join(packageDir.trim(), SKILL_PROVENANCE_FILENAME);
  try {
    const st = await lstat(file);
    if (st.isSymbolicLink()) await unlink(file);
  } catch {
    // ENOENT — ok
  }
  await writeFile(file, `${JSON.stringify(valid, null, 2)}\n`, 'utf8');
}
