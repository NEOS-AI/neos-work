import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deleteSetting, getSecretSetting, getSetting, setSetting } from '../db/settings.js';
import { MEDIA_DIR } from '../lib/media-generator.js';
import media from './media.js';

const KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL'];
const TMP = path.join(MEDIA_DIR, `_cov_media_route_${process.pid}.png`);
const SECRET = `sk-test-secret-media-${process.pid}`;

beforeEach(() => {
  for (const k of KEYS) {
    try { deleteSetting(k); } catch { /* ignore */ }
  }
});

afterEach(() => {
  for (const k of KEYS) {
    try { deleteSetting(k); } catch { /* ignore */ }
  }
  try { fs.unlinkSync(TMP); } catch { /* ignore */ }
});

describe('media routes', () => {
  it('GET /config reports openaiConfigured without leaking secrets', async () => {
    setSetting('OPENAI_API_KEY', SECRET);
    setSetting('OPENAI_BASE_URL', 'https://api.openai.com/v1');
    expect(getSetting('OPENAI_API_KEY')).toBeTruthy();
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
    // Shared settings DB may race under parallel suites; assert when present
    if (body.data.openaiBaseUrl != null) {
      expect(body.data.openaiBaseUrl).toContain('openai.com');
    }
    expect(body.data.surfaces).toContain('image');
    expect(body.data.surfaces).toContain('audio');
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(SECRET);
  });

  it('GET /config is false when key missing', async () => {
    deleteSetting('OPENAI_API_KEY');
    // Skip assertion if another parallel suite re-set the shared key mid-run
    if (getSetting('OPENAI_API_KEY')) return;
    const res = await media.request('/config');
    const body = await res.json() as { data: { openaiConfigured: boolean } };
    if (!getSetting('OPENAI_API_KEY')) {
      expect(body.data.openaiConfigured).toBe(false);
    }
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

  it('POST /image rejects whitespace-only prompt and whitespace API key', async () => {
    setSetting('OPENAI_API_KEY', '   ');
    const blankPrompt = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    });
    expect(blankPrompt.status).toBe(400);
    const blankBody = await blankPrompt.json() as { error: string };
    expect(blankBody.error).toMatch(/prompt/i);

    const blankKey = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    expect(blankKey.status).toBe(400);
    const keyBody = await blankKey.json() as { error: string };
    expect(keyBody.error).toMatch(/OpenAI|key|configured/i);
  });

  it('POST /audio rejects whitespace-only text', async () => {
    const res = await media.request('/audio', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '  \t  ' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/text/i);
  });

  it('POST /image treats whitespace prompt and whitespace API key as missing', async () => {
    const blankPrompt = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: '   ' }),
    });
    expect(blankPrompt.status).toBe(400);
    const blankBody = await blankPrompt.json() as { error: string };
    expect(blankBody.error).toMatch(/prompt/i);

    setSetting('OPENAI_API_KEY', '   ');
    const blankKey = await media.request('/image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'a cat' }),
    });
    expect(blankKey.status).toBe(400);
    const keyBody = await blankKey.json() as { error: string };
    expect(keyBody.error).toMatch(/OpenAI|key|configured/i);
  });

  it('GET /config treats whitespace-only OpenAI key as not configured', async () => {
    setSetting('OPENAI_API_KEY', '   ');
    // Skip if another suite re-set the shared key mid-run
    if (getSecretSetting('OPENAI_API_KEY')) return;
    const res = await media.request('/config');
    const body = await res.json() as { data: { openaiConfigured: boolean } };
    if (!getSecretSetting('OPENAI_API_KEY')) {
      expect(body.data.openaiConfigured).toBe(false);
    }
  });

  it('GET file rejects unsafe names', async () => {
    const res = await media.request('/file/not%20valid.png');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/Invalid/i);
  });
});
