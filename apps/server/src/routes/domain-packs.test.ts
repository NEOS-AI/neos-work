import { describe, expect, it } from 'vitest';
import domainPacks from './domain-packs.js';

describe('domain-packs routes', () => {
  it('lists four built-in packs with counts', async () => {
    const res = await domainPacks.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: Array<{ id: string; workerCount: number; isBuiltIn: boolean }>;
    };
    expect(body.ok).toBe(true);
    expect(body.data.map((p) => p.id).sort()).toEqual(
      ['coding', 'finance', 'general', 'research'].sort(),
    );
    expect(body.data.every((p) => p.isBuiltIn && p.workerCount >= 2)).toBe(true);
  });

  it('returns pack detail with workers', async () => {
    const res = await domainPacks.request('/research');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data: { id: string; workers: Array<{ id: string }> };
    };
    expect(body.data.id).toBe('research');
    expect(body.data.workers.map((w) => w.id)).toEqual(
      expect.arrayContaining(['research_web', 'research_synthesizer']),
    );
  });

  it('404s unknown pack', async () => {
    const res = await domainPacks.request('/nope');
    expect(res.status).toBe(404);
  });

  it('404s blank and control-char pack ids', async () => {
    const blank = await domainPacks.request('/%20');
    expect(blank.status).toBe(404);
    const ctrl = await domainPacks.request(`/${encodeURIComponent('research\nid')}`);
    expect(ctrl.status).toBe(404);
  });

  it('returns coding pack with block ids', async () => {
    const res = await domainPacks.request('/coding');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { id: string; blockIds: string[]; workers: Array<{ id: string }> };
    };
    expect(body.data.id).toBe('coding');
    expect(body.data.blockIds.length).toBeGreaterThan(0);
    expect(body.data.workers.some((w) => w.id === 'coding_reviewer')).toBe(true);
  });
});
