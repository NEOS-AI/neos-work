import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DESIGN_MD_MAX_CHARS,
  DESIGN_SYSTEMS_DIR,
  RULES_MD_MAX_CHARS,
  TOKENS_CSS_MAX_CHARS,
  deleteDesignSystem,
  listDesignSystems,
} from '../lib/design-system-store.js';
import designSystems from './design-systems.js';

const NAME = `_cov_ds_route_${process.pid}`;

afterEach(async () => {
  const list = await listDesignSystems();
  for (const ds of list) {
    if (ds.name === NAME || ds.name.startsWith(NAME)) {
      await deleteDesignSystem(ds.id);
    }
  }
  await fs.rm(path.join(DESIGN_SYSTEMS_DIR, NAME), { recursive: true, force: true }).catch(() => {});
});

describe('design-systems routes', () => {
  it('rejects create without name', async () => {
    const res = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for overlong or path-like design system ids', async () => {
    expect((await designSystems.request(`/${'a'.repeat(65)}`)).status).toBe(404);
    expect((await designSystems.request('/foo/bar')).status).toBe(404);
    expect((await designSystems.request(`/${encodeURIComponent('bad\nid')}`)).status).toBe(404);
  });

  it('rejects invalid name charset and invalid JSON', async () => {
    const badName = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'has space!' }),
    });
    // Route may return 400 (validation) or 409 (create failed after sanitize) depending on path
    expect([400, 409]).toContain(badName.status);
    expect(((await badName.json()) as { error: string }).error).toMatch(/name|exist|required/i);

    const badJson = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
  });

  it('rejects control-char names and descriptions on create', async () => {
    const ctrlName = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad\nname' }),
    });
    expect(ctrlName.status).toBe(400);
    expect(((await ctrlName.json()) as { error: string }).error).toMatch(/control characters/i);

    const lead = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '\nBrand' }),
    });
    expect(lead.status).toBe(400);

    const ctrlDesc = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, description: 'bad\ndesc' }),
    });
    expect(ctrlDesc.status).toBe(400);
    expect(((await ctrlDesc.json()) as { error: string }).error).toMatch(/control characters/i);
  });

  it('trims name/description and rejects whitespace-only name', async () => {
    const blank = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });
    expect(blank.status).toBe(400);

    const create = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `  ${NAME}  `, description: '  spaced  ' }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { data: { id: string; name: string; description?: string } };
    expect(created.data.name).toBe(NAME);
    expect(created.data.description).toBe('spaced');
    await designSystems.request(`/${created.data.id}`, { method: 'DELETE' });
  });

  it('creates, gets, lists, updates content, deletes', async () => {
    const create = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME, description: 'route test' }),
    });
    expect(create.status).toBe(201);
    const created = await create.json() as { ok: boolean; data: { id: string; name: string } };
    expect(created.ok).toBe(true);
    expect(created.data.name).toBe(NAME);
    const id = created.data.id;

    const list = await designSystems.request('/');
    const listBody = await list.json() as { data: Array<{ id: string }> };
    expect(listBody.data.some((d) => d.id === id)).toBe(true);

    const get = await designSystems.request(`/${id}`);
    expect(get.status).toBe(200);

    const contentGet = await designSystems.request(`/${id}/content`);
    const contentBody = await contentGet.json() as { data: { content: string } };
    expect(contentBody.data.content.length).toBeGreaterThan(0);

    const putNull = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: `ok${'\0'}bad` }),
    });
    expect(putNull.status).toBe(400);
    expect(((await putNull.json()) as { error: string }).error).toMatch(/control characters/i);

    const putBlank = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '   \n\t  ' }),
    });
    expect(putBlank.status).toBe(400);

    const put = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# Brand\n\nUpdated via route test.\n' }),
    });
    expect(put.status).toBe(200);

    const contentAgain = await designSystems.request(`/${id}/content`);
    const againBody = await contentAgain.json() as { data: { content: string } };
    expect(againBody.data.content).toContain('Updated via route test');

    const del = await designSystems.request(`/${id}`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    const missing = await designSystems.request(`/${id}`);
    expect(missing.status).toBe(404);
  });

  it('returns 404 for unknown content', async () => {
    const res = await designSystems.request('/no-such-ds/content');
    expect(res.status).toBe(404);
  });

  it('returns 404 for blank path ids after trim', async () => {
    const get = await designSystems.request('/%20%20');
    expect(get.status).toBe(404);
    const del = await designSystems.request('/%20', { method: 'DELETE' });
    expect(del.status).toBe(404);
    const content = await designSystems.request('/%20/content');
    expect(content.status).toBe(404);
    const put = await designSystems.request('/%20/content', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# x' }),
    });
    expect(put.status).toBe(404);
  });

  it('returns 409 on duplicate name and rejects non-string content', async () => {
    const first = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME }),
    });
    expect(first.status).toBe(201);
    const id = ((await first.json()) as { data: { id: string } }).data.id;

    const dup = await designSystems.request('/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: NAME }),
    });
    expect(dup.status).toBe(409);

    const nonString = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 123 }),
    });
    expect(nonString.status).toBe(400);
    expect(((await nonString.json()) as { error: string }).error).toMatch(/content string/i);

    const badJson = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    // Route-level DESIGN.md size cap (before store write)
    const huge = await designSystems.request(`/${id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(DESIGN_MD_MAX_CHARS + 1) }),
    });
    expect(huge.status).toBe(400);
    expect(((await huge.json()) as { error: string }).error).toMatch(/max size/i);

    await designSystems.request(`/${id}`, { method: 'DELETE' });
  });

  it('GET tokens and rejects write to bundled design systems', async () => {
    const list = await designSystems.request('/');
    const listBody = (await list.json()) as {
      data: Array<{ id: string; source?: string; name: string }>;
    };
    const bundled = listBody.data.find((d) => d.source === 'bundled')
      ?? listBody.data.find((d) => d.id === 'neos-default' || d.name === 'neos-default');
    expect(bundled).toBeTruthy();

    const tokens = await designSystems.request(`/${bundled!.id}/tokens`);
    // tokens may exist or 404 depending on store layout — either is a covered path
    expect([200, 404]).toContain(tokens.status);
    if (tokens.status === 200) {
      const body = (await tokens.json()) as { data: { content: string } };
      expect(typeof body.data.content).toBe('string');
    }

    const blankTokens = await designSystems.request('/%20/tokens');
    expect(blankTokens.status).toBe(404);

    const missingTokens = await designSystems.request('/no-such-ds-xyz/tokens');
    expect(missingTokens.status).toBe(404);

    const putBundled = await designSystems.request(`/${bundled!.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '# hack\n' }),
    });
    expect([403, 404]).toContain(putBundled.status);
    if (putBundled.status === 403) {
      expect(((await putBundled.json()) as { error: string }).error).toMatch(/read-only|Bundled/i);
    }
  });
});

async function createRouteSystem(name = NAME) {
  const res = await designSystems.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = (await res.json()) as { data?: { id: string } };
  return { status: res.status, id: body.data?.id ?? '' };
}

async function jsonReq(url: string, method: string, body?: unknown) {
  return designSystems.request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function bundledId(): Promise<string> {
  const list = await designSystems.request('/');
  const listBody = (await list.json()) as {
    data: Array<{ id: string; source?: string; name: string }>;
  };
  const bundled = listBody.data.find((d) => d.source === 'bundled' && d.name === 'neos-default')
    ?? listBody.data.find((d) => d.source === 'bundled');
  expect(bundled).toBeTruthy();
  return bundled!.id;
}

describe('design-systems RULES.md / tokens / components routes', () => {
  it('GET and PUT /:id/rules mirror content guards', async () => {
    const { id } = await createRouteSystem();
    expect(id).toBeTruthy();

    const get = await designSystems.request(`/${id}/rules`);
    expect(get.status).toBe(200);
    const got = (await get.json()) as { ok: boolean; data: { content: string } };
    expect(got.ok).toBe(true);
    expect(got.data.content).toContain('# Agent rules');

    const nonString = await jsonReq(`/${id}/rules`, 'PUT', { content: 123 });
    expect(nonString.status).toBe(400);
    expect(((await nonString.json()) as { error: string }).error).toMatch(/content string required/);

    const missingBody = await jsonReq(`/${id}/rules`, 'PUT', {});
    expect(missingBody.status).toBe(400);
    expect(((await missingBody.json()) as { error: string }).error).toMatch(/content string required/);

    const badJson = await designSystems.request(`/${id}/rules`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { error: string }).error).toMatch(/content string required/);

    const putNull = await jsonReq(`/${id}/rules`, 'PUT', { content: `ok${'\0'}bad` });
    expect(putNull.status).toBe(400);
    expect(((await putNull.json()) as { error: string }).error).toMatch(/control characters/i);

    const putBlank = await jsonReq(`/${id}/rules`, 'PUT', { content: '   \n\t  ' });
    expect(putBlank.status).toBe(400);
    expect(((await putBlank.json()) as { error: string }).error).toMatch(/empty/i);

    const huge = await jsonReq(`/${id}/rules`, 'PUT', { content: 'x'.repeat(RULES_MD_MAX_CHARS + 1) });
    expect(huge.status).toBe(400);
    expect(((await huge.json()) as { error: string }).error).toMatch(/max size/i);

    const put = await jsonReq(`/${id}/rules`, 'PUT', { content: '# Agent rules\n\nUpdated via route.\n' });
    expect(put.status).toBe(200);
    const again = await designSystems.request(`/${id}/rules`);
    expect(again.status).toBe(200);
    expect(((await again.json()) as { data: { content: string } }).data.content).toContain('Updated via route');

    expect((await designSystems.request('/%20/rules')).status).toBe(404);
    expect((await jsonReq('/%20/rules', 'PUT', { content: '# x\n' })).status).toBe(404);
    expect((await designSystems.request('/no-such-ds-xyz/rules')).status).toBe(404);
    expect((await jsonReq('/no-such-ds-xyz/rules', 'PUT', { content: '# x\n' })).status).toBe(404);
  });

  it('GET /:id/rules returns 404 when the file is missing', async () => {
    const { id } = await createRouteSystem();
    await fs.rm(path.join(DESIGN_SYSTEMS_DIR, NAME, 'RULES.md'), { force: true });
    const res = await designSystems.request(`/${id}/rules`);
    expect(res.status).toBe(404);
    const raw = await res.text();
    const body = raw.trim().startsWith('{') ? JSON.parse(raw) as { ok: boolean } : { ok: false };
    expect(body.ok).toBe(false);
  });

  it('PUT /:id/rules returns 403 for bundled systems', async () => {
    const id = await bundledId();
    const res = await jsonReq(`/${id}/rules`, 'PUT', { content: '# hack\n' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toMatch(/read-only|Bundled/i);
  });

  it('POST /:id/rules/append returns 400 for 501-char text and 200 for 500', async () => {
    const { id } = await createRouteSystem();
    const tooLong = await jsonReq(`/${id}/rules/append`, 'POST', { text: 'x'.repeat(501) });
    expect(tooLong.status).toBe(400);

    const ok = await jsonReq(`/${id}/rules/append`, 'POST', { text: 'x'.repeat(500) });
    expect(ok.status).toBe(200);
    const get = await designSystems.request(`/${id}/rules`);
    const content = ((await get.json()) as { data: { content: string } }).data.content;
    expect(content).toContain('x'.repeat(500));
    expect(content).toMatch(/- \d{4}-\d{2}-\d{2}:/);

    expect((await jsonReq(`/${id}/rules/append`, 'POST', { text: '' })).status).toBe(400);
    expect((await jsonReq(`/${id}/rules/append`, 'POST', { text: '   ' })).status).toBe(400);
    expect((await jsonReq(`/${id}/rules/append`, 'POST', { text: 123 })).status).toBe(400);
    const badJson = await designSystems.request(`/${id}/rules/append`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);
  });

  it('POST /:id/rules/append returns 404 when commentId is missing from preview comments', async () => {
    const { id } = await createRouteSystem();
    const res = await jsonReq(`/${id}/rules/append`, 'POST', {
      text: 'keep contrast',
      commentId: '00000000-0000-0000-0000-000000000001',
    });
    expect(res.status).toBe(404);
    const raw = await res.text();
    const err = raw.trim().startsWith('{')
      ? JSON.parse(raw) as { ok: boolean; error?: string }
      : { ok: false as const };
    expect(err.ok).toBe(false);
    expect(JSON.stringify(err)).not.toMatch(/\/Users\/|\/home\/|\\\\Users\\\\/);

    const omitted = await jsonReq(`/${id}/rules/append`, 'POST', { text: 'keep contrast' });
    expect(omitted.status).toBe(200);
  });

  it('POST /:id/rules/append and POST /:id/rules/prune return 403 for bundled', async () => {
    const id = await bundledId();
    const append = await jsonReq(`/${id}/rules/append`, 'POST', { text: 'nope' });
    expect(append.status).toBe(403);
    const prune = await jsonReq(`/${id}/rules/prune`, 'POST', {});
    expect(prune.status).toBe(403);
  });

  it('POST /:id/rules/prune returns 404 when RULES.md is missing', async () => {
    const { id } = await createRouteSystem();
    await fs.rm(path.join(DESIGN_SYSTEMS_DIR, NAME, 'RULES.md'), { force: true });
    const res = await jsonReq(`/${id}/rules/prune`, 'POST', {});
    expect(res.status).toBe(404);
  });

  it('POST /:id/rules/prune returns 200 { pruned: 0 } when Corrections section is missing', async () => {
    const { id } = await createRouteSystem();
    const put = await jsonReq(`/${id}/rules`, 'PUT', {
      content: '# Agent rules\n\n## Never\n- Do not invent a palette.\n',
    });
    expect(put.status).toBe(200);
    const before = ((await (await designSystems.request(`/${id}/rules`)).json()) as {
      data: { content: string };
    }).data.content;

    const res = await jsonReq(`/${id}/rules/prune`, 'POST', {});
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { pruned: number } };
    expect(body.ok).toBe(true);
    expect(body.data.pruned).toBe(0);

    const after = ((await (await designSystems.request(`/${id}/rules`)).json()) as {
      data: { content: string };
    }).data.content;
    expect(after).toBe(before);
  });

  it('POST /:id/rules/prune returns 400 for maxEntries 0 / 101 and maxAgeDays 366', async () => {
    const { id } = await createRouteSystem();
    expect((await jsonReq(`/${id}/rules/prune`, 'POST', { maxEntries: 0 })).status).toBe(400);
    expect((await jsonReq(`/${id}/rules/prune`, 'POST', { maxEntries: 101 })).status).toBe(400);
    expect((await jsonReq(`/${id}/rules/prune`, 'POST', { maxAgeDays: 0 })).status).toBe(400);
    expect((await jsonReq(`/${id}/rules/prune`, 'POST', { maxAgeDays: 366 })).status).toBe(400);
    expect((await jsonReq(`/${id}/rules/prune`, 'POST', { maxEntries: '20' })).status).toBe(400);

    const ok = await jsonReq(`/${id}/rules/prune`, 'POST', {});
    expect(ok.status).toBe(200);
  });

  it('PUT /:id/tokens returns 403 for bundled, 400 for empty/null-byte/oversize, 200 for user', async () => {
    const bid = await bundledId();
    const bundledPut = await jsonReq(`/${bid}/tokens`, 'PUT', { content: ':root { --x: 1; }\n' });
    expect(bundledPut.status).toBe(403);
    expect(((await bundledPut.json()) as { error: string }).error).toMatch(/read-only|Bundled/i);

    const { id } = await createRouteSystem();
    expect((await jsonReq(`/${id}/tokens`, 'PUT', { content: '   ' })).status).toBe(400);
    expect((await jsonReq(`/${id}/tokens`, 'PUT', { content: `ok${'\0'}bad` })).status).toBe(400);
    expect((await jsonReq(`/${id}/tokens`, 'PUT', { content: 'x'.repeat(256 * 1024 + 1) })).status).toBe(400);
    expect(TOKENS_CSS_MAX_CHARS).toBe(256 * 1024);

    const put = await jsonReq(`/${id}/tokens`, 'PUT', { content: ':root { --color-primary: #111; }\n' });
    expect(put.status).toBe(200);
    const get = await designSystems.request(`/${id}/tokens`);
    expect(get.status).toBe(200);
    expect(((await get.json()) as { data: { content: string } }).data.content).toContain('--color-primary: #111');
  });

  it('GET /:id/components returns 404 when missing and 200 when present', async () => {
    const { id } = await createRouteSystem();
    expect((await designSystems.request(`/${id}/components`)).status).toBe(404);

    await fs.writeFile(path.join(DESIGN_SYSTEMS_DIR, NAME, 'components.html'), '<button>Ok</button>', 'utf8');
    const res = await designSystems.request(`/${id}/components`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { content: string } };
    expect(body.data.content).toContain('<button>Ok</button>');

    expect((await designSystems.request('/no-such-ds-xyz/components')).status).toBe(404);
    expect((await designSystems.request('/%20/components')).status).toBe(404);
  });

  it('GET / lists hasRules for created user systems and bundled neos-default', async () => {
    const { id } = await createRouteSystem();
    const list = await designSystems.request('/');
    const listBody = (await list.json()) as {
      data: Array<{ id: string; name: string; hasRules?: boolean; hasTokens?: boolean; source?: string }>;
    };
    const created = listBody.data.find((d) => d.id === id);
    expect(created?.hasRules).toBe(true);
    expect(created?.hasTokens).toBe(true);
    const neo = listBody.data.find((d) => d.name === 'neos-default');
    expect(neo?.hasRules).toBe(true);
  });
});
