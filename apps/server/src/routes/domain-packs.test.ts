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
});
