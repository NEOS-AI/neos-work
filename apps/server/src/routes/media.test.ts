import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deleteSetting, setSetting } from '../db/settings.js';
import { MEDIA_DIR } from '../lib/media-generator.js';
import media from './media.js';

const KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];
const TMP = path.join(MEDIA_DIR, `_cov_media_route_${process.pid}.png`);

afterEach(() => {
  for (const k of KEYS) {
    try { deleteSetting(k); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(TMP); } catch { /* ignore */ }
});

describe('media routes', () => {
  it('GET /config reports openaiConfigured without leaking secrets', async () => {
    setSetting('OPENAI_API_KEY', 'sk-test-secret');
    setSetting('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    const res = await media.request('/config');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      ok: boolean;
      data: {
        openaiConfigured: boolean;
        openaiBaseUrl: string | null;
        surfaces: string[];
        imageModels: string[];
        audioModels: string[];
      };
    };
    expect(body.ok).toBe(true);
    expect(body.data.openaiConfigured).toBe(true);
    expect(body.data.openaiBaseUrl).toContain('openai.com');
    expect(body.data.surfaces).toContain('image');
    expect(body.data.surfaces).toContain('audio');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('sk-test-secret');
  });

  it('GET /config is false when key missing', async () => {
    const res = await media.request('/config');
    const body = await res.json() as { data: { openaiConfigured: boolean } };
    expect(body.data.openaiConfigured).toBe(false);
  });

  it('GET /files returns list', async () => {
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    fs.writeFileSync(TMP, 'png');
    const res = await media.request('/files?limit=50');
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean; data: Array<{ filename: string }> };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.some((f) => f.filename === path.basename(TMP))).toBe(true);
  });

  it('POST /image rejects missing prompt and missing API key', async () => {
    const noPrompt = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(noPrompt.status).toBe(400);

    const noKey = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    expect(noKey.status).toBe(400);
    const body = await noKey.json() as { error: string };
    expect(body.error).toMatch(/OpenAI|key|configured/i);
  });

  it('GET file rejects unsafe names', async () => {
    const res = await media.request('/file/not%20valid.png');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid/i);
  });
});
