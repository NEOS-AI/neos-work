/**
 * Media Generation routes
 * POST /api/media/image  — Generate image via DALL-E 3
 * POST /api/media/audio  — Generate audio via TTS
 * GET  /api/media/file   — Serve a saved media file
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { getSecretSetting } from '../db/settings.js';
import { generateImage, generateAudio, listMediaFiles, MEDIA_DIR as MEDIA_DIR_EXPORT } from '../lib/media-generator.js';

const media = new Hono();
const MEDIA_DIR = MEDIA_DIR_EXPORT;

/** List generated media files for FileViewer */
media.get('/files', async (c) => {
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? '100'), 1), 500);
  const files = await listMediaFiles(limit);
  return c.json({ ok: true, data: files });
});

/**
 * Media config status (plan Task 7) — does not return the secret value.
 */
media.get('/config', (c) => {
  const hasOpenAi = !!getSecretSetting('OPENAI_API_KEY');
  const baseUrl = getSecretSetting('OPENAI_BASE_URL');
  return c.json({
    ok: true,
    data: {
      openaiConfigured: hasOpenAi,
      openaiBaseUrl: baseUrl ?? null,
      surfaces: ['image', 'audio'] as const,
      imageModels: ['dall-e-3'],
      audioModels: ['tts-1', 'tts-1-hd'],
    },
  });
});

media.post('/image', async (c) => {
  const body = await c.req.json<{
    prompt: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return c.json({ ok: false, error: 'prompt is required' }, 400);
  }
  if (prompt.length > 4000) {
    return c.json({ ok: false, error: 'prompt too long' }, 400);
  }

  const apiKey = getSecretSetting('OPENAI_API_KEY');
  if (!apiKey) return c.json({ ok: false, error: 'OpenAI API key not configured' }, 400);

  try {
    const result = await generateImage({
      prompt,
      size: body.size,
      quality: body.quality,
      apiKey,
    });
    return c.json({
      ok: true,
      data: {
        filePath: result.filePath,
        filename: path.basename(result.filePath),
        revisedPrompt: result.revisedPrompt,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate image';
    return c.json({ ok: false, error: msg }, 500);
  }
});

media.post('/audio', async (c) => {
  const body = await c.req.json<{
    text: string;
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    model?: 'tts-1' | 'tts-1-hd';
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return c.json({ ok: false, error: 'text is required' }, 400);
  }
  if (text.length > 4096) {
    return c.json({ ok: false, error: 'text too long (max 4096 chars)' }, 400);
  }

  const apiKey = getSecretSetting('OPENAI_API_KEY');
  if (!apiKey) return c.json({ ok: false, error: 'OpenAI API key not configured' }, 400);

  try {
    const result = await generateAudio({
      text,
      voice: body.voice,
      model: body.model,
      apiKey,
    });
    return c.json({
      ok: true,
      data: { filePath: result.filePath, filename: path.basename(result.filePath) },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate audio';
    return c.json({ ok: false, error: msg }, 500);
  }
});

// Serve a saved media file by filename (path traversal safe)
media.get('/file/:filename', (c) => {
  const filename = c.req.param('filename').trim();
  // Reject any path traversal
  if (!filename || !/^[a-zA-Z0-9_\-.]+$/.test(filename)) {
    return c.json({ ok: false, error: 'Invalid filename' }, 400);
  }
  const filePath = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] ?? 'application/octet-stream';
  const buf = fs.readFileSync(filePath);
  c.header('Content-Type', mimeType);
  return c.body(buf);
});

/**
 * Unified media generate endpoint (plan Task 7).
 * Body: { surface: 'image' | 'audio', prompt|text, size?, quality?, voice?, model? }
 */
media.post('/generate', async (c) => {
  const body = await c.req.json<{
    surface?: 'image' | 'audio';
    prompt?: string;
    text?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    model?: 'tts-1' | 'tts-1-hd';
  }>().catch(() => null);

  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const surface =
    typeof body.surface === 'string' ? body.surface.trim().toLowerCase() : '';
  if (surface !== 'image' && surface !== 'audio') {
    return c.json({ ok: false, error: 'surface must be image or audio' }, 400);
  }

  const apiKey = getSecretSetting('OPENAI_API_KEY');
  if (!apiKey) return c.json({ ok: false, error: 'OpenAI API key not configured' }, 400);

  try {
    if (surface === 'image') {
      const rawPrompt = body.prompt ?? body.text;
      const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
      if (!prompt) {
        return c.json({ ok: false, error: 'prompt is required for image' }, 400);
      }
      if (prompt.length > 4000) {
        return c.json({ ok: false, error: 'prompt too long' }, 400);
      }
      const result = await generateImage({
        prompt,
        size: body.size,
        quality: body.quality,
        apiKey,
      });
      return c.json({
        ok: true,
        data: {
          surface: 'image',
          filePath: result.filePath,
          filename: path.basename(result.filePath),
          revisedPrompt: result.revisedPrompt,
        },
      });
    }

    const rawText = body.text ?? body.prompt;
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) {
      return c.json({ ok: false, error: 'text is required for audio' }, 400);
    }
    if (text.length > 4096) {
      return c.json({ ok: false, error: 'text too long (max 4096 chars)' }, 400);
    }
    const result = await generateAudio({
      text,
      voice: body.voice,
      model: body.model,
      apiKey,
    });
    return c.json({
      ok: true,
      data: {
        surface: 'audio',
        filePath: result.filePath,
        filename: path.basename(result.filePath),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to generate media';
    return c.json({ ok: false, error: msg }, 500);
  }
});

/** Delete a generated media file */
media.delete('/file/:filename', (c) => {
  const filename = c.req.param('filename').trim();
  if (!filename || !/^[a-zA-Z0-9_\-.]+$/.test(filename)) {
    return c.json({ ok: false, error: 'Invalid filename' }, 400);
  }
  const filePath = path.join(MEDIA_DIR, filename);
  if (!fs.existsSync(filePath)) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  try {
    fs.unlinkSync(filePath);
    return c.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Delete failed';
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default media;
