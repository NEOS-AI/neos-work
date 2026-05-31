/**
 * Skill types compatible with OpenCode SKILL.md format.
 */

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Execution mode: 'agent' | 'tool' | 'template' */
  mode?: string;
  /** Target platform or runtime, e.g. 'node', 'browser', 'tauri' */
  platform?: string;
  /** Grouping category, e.g. 'code', 'data', 'infra' */
  category?: string;
  /** Whether this skill is featured/promoted */
  featured?: boolean;
  /** Example prompt the user can paste to try the skill */
  examplePrompt?: string;
  /** Trigger phrases that activate the skill automatically */
  triggers?: string[];
  /** Whether a design system is required */
  designSystemRequired?: boolean;
  /** UI/UX fidelity level, e.g. 'wireframe' | 'high-fidelity' */
  fidelity?: string;
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
