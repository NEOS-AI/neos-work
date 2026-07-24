/**
 * Skill discovery — scans local and global skill directories.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

import type { Skill } from '@neos-work/shared';
import { parseSkillFile } from './parser.js';

const GLOBAL_SKILL_DIR = join(homedir(), '.config', 'neos-work', 'skills');

async function scanDirectory(dir: string, source: 'local' | 'global'): Promise<Skill[]> {
  const skills: Skill[] = [];
  const base = typeof dir === 'string' ? dir.trim() : '';
  if (!base) return skills;

  let entries: string[];
  try {
    entries = await readdir(base);
  } catch {
    return skills; // Directory doesn't exist
  }

  for (const entry of entries) {
    // Skip hidden files and non-markdown
    if (!entry || entry.startsWith('.') || !entry.endsWith('.md')) continue;
    const filePath = join(base, entry);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) continue;
      const content = await readFile(filePath, 'utf-8');
      const skill = parseSkillFile(content, filePath, source);
      if (skill) skills.push(skill);
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}

export async function discoverSkills(workspacePath?: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  // Global skills
  const globalSkills = await scanDirectory(GLOBAL_SKILL_DIR, 'global');
  skills.push(...globalSkills);

  // Local workspace skills (blank/whitespace path treated as omitted)
  const ws =
    typeof workspacePath === 'string' ? workspacePath.trim() : '';
  if (ws) {
    const localDir = resolve(ws, '.neos-work', 'skills');
    const localSkills = await scanDirectory(localDir, 'local');
    skills.push(...localSkills);
  }

  return skills;
}
