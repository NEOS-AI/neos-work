/**
 * Skill types compatible with OpenCode SKILL.md format.
 */

export interface SkillManifest {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}

export interface Skill {
  manifest: SkillManifest;
  content: string;
  path: string;
  source: 'local' | 'global' | 'opencode';
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  version: string | null;
  installedAt: string;
}
