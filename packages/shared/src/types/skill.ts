/**
 * Skill types compatible with OpenCode / OD SKILL.md package format (v0.5.7).
 */

export interface SkillManifest {
  name: string;
  description: string;
  version?: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  /** Execution mode: 'agent' | 'tool' | 'template' | design modes */
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

/** Derived gallery card from examples/<key>.html under a skill package. */
export interface SkillExampleCard {
  /** `<parent-name>:<example-key>` */
  id: string;
  key: string;
  path: string;
  title?: string;
}

export type SkillSource = 'local' | 'global' | 'bundled' | 'opencode';

export interface Skill {
  manifest: SkillManifest;
  content: string;
  /** Absolute path to SKILL.md or flat .md file. */
  path: string;
  source: SkillSource;
  /** Package root when discovered as dir/SKILL.md layout. */
  packageDir?: string;
  /** Relative asset file names under packageDir/assets (best-effort). */
  assets?: string[];
  /** Relative reference file names under packageDir/references. */
  references?: string[];
  /** Derived example cards from packageDir/examples/*.html */
  examples?: SkillExampleCard[];
}

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  version: string | null;
  installedAt: string;
}
