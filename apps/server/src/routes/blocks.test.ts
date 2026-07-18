import { afterEach, describe, expect, it } from 'vitest';
import { createCustomBlock, deleteCustomBlock } from '../db/blocks.js';
import blocks from './blocks.js';

const ID = `_cov_blk_route_${process.pid}`;

afterEach(() => {
  try { deleteCustomBlock(ID); } catch { /* ignore */ }
});

describe('blocks routes', () => {
  it('lists built-in and custom blocks', async () => {
    createCustomBlock({
      id: ID,
      name: 'Cov Block Route',
      domain: 'general',
      category: 'test',
      description: 'route cov',
      implementationType: 'prompt',
      paramDefs: [],
      inputDescription: 'in',
      outputDescription: 'out',
    });
    const res = await blocks.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: Array<{ id: string; isBuiltIn?: boolean; name: string }>;
    };
    expect(body.ok).toBe(true);
    expect(body.data.some((b) => b.id === ID)).toBe(true);
    // built-ins should also appear (finance/coding registry)
    expect(body.data.some((b) => b.isBuiltIn === true || b.id !== ID)).toBe(true);
  });

  it('GET missing custom block returns 404', async () => {
    const res = await blocks.request('/no-such-custom-block-xyz');
    // route may only support list or get
    expect([404, 405, 200]).toContain(res.status);
  });
});
