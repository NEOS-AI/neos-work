/**
 * Media Generation routes
 * POST /api/media/image  — Generate image via DALL-E 3
 * POST /api/media/audio  — Generate audio via TTS
 * GET  /api/media/file   — Serve a saved media file
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getSetting } from '../db/settings.js';
import { generateImage, generateAudio } from '../lib/media-generator.js';

const media = new Hono();
const MEDIA_DIR = path.join(os.homedir(), '.neos-work', 'media');

media.post('/image', async (c) => {
  const body = await c.req.json<{
    prompt: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
  }>();

  if (!body.prompt || typeof body.prompt !== 'string') {
    return c.json({ ok: false, error: 'prompt is required' }, 400);
  }
  if (body.prompt.length > 4000) {
    return c.json({ ok: false, error: 'prompt too long' }, 400);
  }

  const apiKey = getSetting('OPENAI_API_KEY');
  if (!apiKey) return c.json({ ok: false, error: 'OpenAI API key not configured' }, 400);

  try {
    const result = await generateImage({
      prompt: body.prompt,
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
  }>();

  if (!body.text || typeof body.text !== 'string') {
    return c.json({ ok: false, error: 'text is required' }, 400);
  }
  if (body.text.length > 4096) {
    return c.json({ ok: false, error: 'text too long (max 4096 chars)' }, 400);
  }

  const apiKey = getSetting('OPENAI_API_KEY');
  if (!apiKey) return c.json({ ok: false, error: 'OpenAI API key not configured' }, 400);

  try {
    const result = await generateAudio({
      text: body.text,
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
  const filename = c.req.param('filename');
  // Reject any path traversal
  if (!/^[a-zA-Z0-9_\-.]+$/.test(filename)) {
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

export default media;
