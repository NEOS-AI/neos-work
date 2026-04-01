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

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return skills; // Directory doesn't exist
  }

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const filePath = join(dir, entry);
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

  // Local workspace skills
  if (workspacePath) {
    const localDir = resolve(workspacePath, '.neos-work', 'skills');
    const localSkills = await scanDirectory(localDir, 'local');
    skills.push(...localSkills);
  }

  return skills;
}
