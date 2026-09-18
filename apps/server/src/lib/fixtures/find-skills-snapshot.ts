/** Live GET /api/download/vercel-labs/skills/find-skills hash (Appendix A.2). */
export const FIND_SKILLS_GOLDEN_HASH =
  'b146008599c31057cef1c145774cea5d5afb30e8f43fa802e47a4b461419aaaf';

export const FIND_SKILLS_ID = 'vercel-labs/skills/find-skills';

export const FIND_SKILLS_SKILL_MD = `---
name: find-skills
description: Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used when the user is looking for functionality that might exist as an installable skill.
license: MIT
---

# Find Skills

This skill helps you discover and install skills from the open agent skills ecosystem.

## When to Use This Skill

Use this skill when the user:

- Asks "how do I do X" where X might be a common task with an existing skill
- Says "find a skill for X" or "is there a skill for X"
- Asks "can you do X" where X is a specialized capability
- Expresses interest in extending agent capabilities
- Wants to search for tools, templates, or workflows
- Mentions they wish they had help with a specific domain (design, testing, deployment, etc.)

## What is the Skills CLI?

The Skills CLI (\`npx skills\`) is the package manager for the open agent skills ecosystem. Skills are modular packages that extend agent capabilities with specialized knowledge, workflows, and tools.

**Browse skills at:** https://skills.sh/
`;

export const FIND_SKILLS_SNAPSHOT = {
  files: [{ path: 'SKILL.md', contents: FIND_SKILLS_SKILL_MD }],
  hash: FIND_SKILLS_GOLDEN_HASH,
};

export const FIND_SKILLS_SEARCH_HIT = {
  id: FIND_SKILLS_ID,
  skillId: 'find-skills',
  name: 'find-skills',
  installs: 3_400_000,
  source: 'vercel-labs/skills',
};
