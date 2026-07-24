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

  // Cap directory fan-out and skill file size (discovery hygiene)
  const ENTRY_MAX = 500;
  const FILE_MAX_BYTES = 1 * 1024 * 1024;
  let count = 0;
  for (const entry of entries) {
    if (count >= ENTRY_MAX) break;
    // Skip hidden files and non-markdown; reject control-char / overlong names
    if (!entry || entry.startsWith('.') || !entry.endsWith('.md')) continue;
    if (/[\0\r\n]/.test(entry) || entry.length > 200) continue;
    const filePath = join(base, entry);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) continue;
      if (s.size > FILE_MAX_BYTES) continue;
      const content = await readFile(filePath, 'utf-8');
      const skill = parseSkillFile(content, filePath, source);
      if (skill) {
        skills.push(skill);
        count += 1;
      }
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
  // Reject control chars / overlong paths that confuse path APIs
  if (ws && !/[\0\r\n]/.test(ws) && ws.length <= 4_096) {
    const localDir = resolve(ws, '.neos-work', 'skills');
    const localSkills = await scanDirectory(localDir, 'local');
    skills.push(...localSkills);
  }

  return skills;
}
