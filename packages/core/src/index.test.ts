import { describe, expect, it } from 'vitest';
import * as core from './index.js';

describe('@neos-work/core barrel exports', () => {
  it('re-exports agent, tools, llm, and skills surfaces', () => {
    const keys = Object.keys(core);
    expect(keys.length).toBeGreaterThan(10);
    // Representative runtime symbols from submodules
    expect(typeof (core as { scrubErrorMessage?: unknown }).scrubErrorMessage).toBe('function');
    expect(typeof (core as { Planner?: unknown }).Planner).toBe('function');
    expect(typeof (core as { createShellTool?: unknown }).createShellTool).toBe('function');
    expect(typeof (core as { discoverSkills?: unknown }).discoverSkills).toBe('function');
  });
});
