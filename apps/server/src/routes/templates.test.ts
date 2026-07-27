import { describe, expect, it } from 'vitest';
import { migrateWorkflowV1ToV2 } from '@neos-work/shared';
import templates, { TEMPLATES } from './templates.js';

describe('templates routes', () => {
  it('lists all templates and filters by trimmed domain', async () => {
    const all = await templates.request('/');
    expect(all.status).toBe(200);
    const allBody = await all.json() as { data: Array<{ domain: string }> };
    expect(allBody.data.length).toBe(TEMPLATES.length);

    const filtered = await templates.request('/?domain=%20coding%20');
    expect(filtered.status).toBe(200);
    const body = await filtered.json() as { data: Array<{ domain: string }> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data.every((t) => t.domain === 'coding')).toBe(true);

    const caseInsensitive = await templates.request('/?domain=%20CODING%20');
    expect(caseInsensitive.status).toBe(200);
    const caseBody = await caseInsensitive.json() as { data: Array<{ domain: string }> };
    expect(caseBody.data.every((t) => t.domain === 'coding')).toBe(true);

    for (const domain of ['finance', 'general'] as const) {
      const res = await templates.request(`/?domain=${domain}`);
      expect(res.status).toBe(200);
      const d = await res.json() as { data: Array<{ domain: string }> };
      expect(d.data.length).toBeGreaterThan(0);
      expect(d.data.every((t) => t.domain === domain)).toBe(true);
      expect(d.data.length).toBe(TEMPLATES.filter((t) => t.domain === domain).length);
    }

    const blankDomain = await templates.request('/?domain=%20%20');
    expect(blankDomain.status).toBe(200);
    const blankBody = await blankDomain.json() as { data: unknown[] };
    expect(blankBody.data.length).toBe(TEMPLATES.length);

    // Unknown domain does not empty the catalog
    const unknown = await templates.request('/?domain=marketing');
    expect(unknown.status).toBe(200);
    const unknownBody = await unknown.json() as { data: unknown[] };
    expect(unknownBody.data.length).toBe(TEMPLATES.length);

    // Control-char domain must not strip to a valid filter (return all)
    const ctrl = await templates.request('/?domain=%0Acoding');
    expect(ctrl.status).toBe(200);
    const ctrlBody = await ctrl.json() as { data: unknown[] };
    expect(ctrlBody.data.length).toBe(TEMPLATES.length);
  });
});

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
    // v2 templates use unified agent + workerId
    expect(
      t!.nodes.filter(
        (n) => n.type === 'agent' && typeof (n.config as { workerId?: string }).workerId === 'string',
      ).length,
    ).toBe(2);
  });

  it('OR template fans into or_gate from both agents', () => {
    const t = TEMPLATES.find((x) => x.name === 'OR Race Two Agents')!;
    const or = t.nodes.find((n) => n.type === 'or_gate')!;
    const incoming = t.edges.filter((e) => e.target === or.id);
    expect(incoming.length).toBe(2);
  });

  it('includes finance and coding starter templates with expected node types', () => {
    const stock = TEMPLATES.find((t) => t.name === 'Stock Price Monitor');
    expect(stock?.domain).toBe('finance');
    expect(stock?.nodes.some((n) => n.type === 'block' && (n.config as { blockId?: string }).blockId === 'price_lookup')).toBe(true);
    expect(stock?.nodes.some((n) => n.type === 'slack_message')).toBe(true);

    const review = TEMPLATES.find((t) => t.name === 'Code Review Assistant');
    expect(review?.domain).toBe('coding');
    expect(
      review?.nodes.some(
        (n) => n.type === 'agent' && (n.config as { workerId?: string }).workerId === 'coding_reviewer',
      ),
    ).toBe(true);

    const testWriter = TEMPLATES.find((t) => t.name === 'Test Writer');
    expect(testWriter?.domain).toBe('coding');

    const tech = TEMPLATES.find((t) => t.name === 'Technical Analysis Report');
    expect(tech?.nodes.some((n) => n.type === 'gate_and')).toBe(true);
    expect(
      tech?.nodes.some(
        (n) => n.type === 'agent' && (n.config as { workerId?: string }).workerId === 'finance_analyst',
      ),
    ).toBe(true);

    const portfolio = TEMPLATES.find((t) => t.name === 'Portfolio Risk Report');
    expect(portfolio?.domain).toBe('finance');

    const liveChart = TEMPLATES.find((t) => t.name === 'Live Chart Analysis (TradingView)');
    expect(liveChart?.domain).toBe('finance');
    expect(
      liveChart?.nodes.some(
        (n) =>
          n.type === 'agent'
          && (n.config as { workerId?: string }).workerId === 'finance_chart_analyst',
      ),
    ).toBe(true);

    const webResearch = TEMPLATES.find((t) => t.name === 'Web Research + Slack');
    expect(webResearch?.domain).toBe('general');
    expect(webResearch?.nodes.some((n) => n.type === 'web_search' || n.type === 'slack_message')).toBe(true);
  });

  it('every template has unique name and non-empty description', () => {
    const names = TEMPLATES.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect(TEMPLATES.every((t) => typeof t.description === 'string' && t.description.trim().length > 0)).toBe(true);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(9);
  });

  it('migrates legacy agent_* + harnessId templates to agent + workerId (v2)', () => {
    for (const t of TEMPLATES) {
      const { workflow, report } = migrateWorkflowV1ToV2({
        ...t,
        id: `tmpl-${t.name}`,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
      expect(workflow.schemaVersion).toBe(2);
      expect(report.warnings).toEqual([]);
      for (const n of workflow.nodes) {
        // No legacy agent types remain
        expect(n.type).not.toMatch(/^agent_/);
        if (n.type === 'agent') {
          const workerId = n.config['workerId'];
          expect(typeof workerId).toBe('string');
          expect(String(workerId).length).toBeGreaterThan(0);
          expect(n.config['harnessId']).toBeUndefined();
        }
      }
    }
  });
});
