import { describe, expect, it } from 'vitest';
import { TEMPLATES } from './templates.js';

describe('workflow TEMPLATES', () => {
  it('includes finance, coding, and general domains', () => {
    const domains = new Set(TEMPLATES.map((t) => t.domain));
    expect(domains.has('finance')).toBe(true);
    expect(domains.has('coding')).toBe(true);
    expect(domains.has('general')).toBe(true);
  });

  it('includes Parallel Research Branches with fan-out/fan-in', () => {
    const parallel = TEMPLATES.find((t) => t.name === 'Parallel Research Branches');
    expect(parallel).toBeTruthy();
    const types = parallel!.nodes.map((n) => n.type);
    expect(types).toContain('parallel_start');
    expect(types).toContain('parallel_end');
    expect(types.filter((t) => t === 'web_search').length).toBeGreaterThanOrEqual(2);
    const ps = parallel!.nodes.find((n) => n.type === 'parallel_start')!;
    const out = parallel!.edges.filter((e) => e.source === ps.id);
    expect(out.length).toBeGreaterThanOrEqual(2);
  });

  it('every template has trigger and output', () => {
    for (const t of TEMPLATES) {
      expect(t.nodes.some((n) => n.type === 'trigger')).toBe(true);
      expect(t.nodes.some((n) => n.type === 'output')).toBe(true);
      expect(t.nodes.length).toBeGreaterThan(0);
      expect(t.edges.length).toBeGreaterThan(0);
    }
  });

  it('template edges only reference existing node ids', () => {
    for (const t of TEMPLATES) {
      const ids = new Set(t.nodes.map((n) => n.id));
      for (const e of t.edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
      }
    }
  });

  it('node and edge ids are unique within each template', () => {
    for (const t of TEMPLATES) {
      const nodeIds = t.nodes.map((n) => n.id);
      const edgeIds = t.edges.map((e) => e.id);
      expect(new Set(nodeIds).size).toBe(nodeIds.length);
      expect(new Set(edgeIds).size).toBe(edgeIds.length);
      expect(edgeIds.every((id) => typeof id === 'string' && id.trim().length > 0)).toBe(true);
    }
  });

  it('includes Generate Image & Deploy template', () => {
    const t = TEMPLATES.find((x) => x.name === 'Generate Image & Deploy');
    expect(t).toBeTruthy();
    const types = t!.nodes.map((n) => n.type);
    expect(types).toContain('media');
    expect(types).toContain('deploy');
  });

  it('includes OR Race Two Agents template', () => {
    const t = TEMPLATES.find((x) => x.name === 'OR Race Two Agents');
    expect(t).toBeTruthy();
    expect(t!.nodes.some((n) => n.type === 'or_gate')).toBe(true);
    expect(t!.nodes.filter((n) => n.type === 'agent_coding').length).toBe(2);
  });

  it('OR template fans into or_gate from both agents', () => {
    const t = TEMPLATES.find((x) => x.name === 'OR Race Two Agents')!;
    const or = t.nodes.find((n) => n.type === 'or_gate')!;
    const incoming = t.edges.filter((e) => e.target === or.id);
    expect(incoming.length).toBe(2);
  });
});
