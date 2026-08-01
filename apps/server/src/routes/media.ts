/**
 * Media Generation routes (Task 8 multi-provider).
 * POST /api/media/image  — Generate image
 * POST /api/media/audio  — Generate audio
 * POST /api/media/generate — Unified image|audio|video (+ provider)
 * GET  /api/media/jobs/:id — Video job poll
 * GET  /api/media/providers — Provider catalog
 * GET  /api/media/config — Readiness (no secrets)
 * GET  /api/media/file   — Serve a saved media file
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { publicErrorMessage } from '../lib/errors.js';
import {
  generateMediaUnified,
  getVideoJob,
  listMediaFiles,
  MEDIA_DIR as MEDIA_DIR_EXPORT,
} from '../lib/media-generator.js';
import { buildMediaConfigPublic, listProviderCatalog } from '../lib/media-providers.js';
import { listMediaJobs } from '../lib/media-jobs.js';
import { isSafeMediaFilename } from '../lib/media-filename.js';

const media = new Hono();
const MEDIA_DIR = MEDIA_DIR_EXPORT;

/**
 * Resolve a media filename under MEDIA_DIR and ensure realpath stays inside
 * (blocks planted symlinks that escape the media root).
 * Returns absolute path or null when invalid/missing/escape.
 */
function resolveMediaFilePath(filename: string): string | null {
  if (!isSafeMediaFilename(filename)) return null;
  const name = filename.trim();
  const joined = path.join(MEDIA_DIR, name);
  let rootReal: string;
  let fileReal: string;
  try {
    rootReal = fs.realpathSync(MEDIA_DIR);
    fileReal = fs.realpathSync(joined);
  } catch {
    return null;
  }
  const prefix = rootReal.endsWith(path.sep) ? rootReal : rootReal + path.sep;
  if (fileReal !== rootReal && !fileReal.startsWith(prefix)) return null;
  return fileReal;
}

/** Map validation / config errors to 400; provider/network failures stay 500. */
function mediaClientErrorStatus(msg: string): 400 | 500 {
  if (
    /not configured|disabled|does not support|required|too long|control characters|invalid|must be|unknown media provider/i.test(
      msg,
    )
  ) {
    return 400;
  }
  return 500;
}

/** List generated media files for FileViewer */
media.get('/files', async (c) => {
  const limitQuery = c.req.query('limit') ?? '';
  // Ignore control-char / non-numeric limit → default 100
  const limitRaw =
    limitQuery && !/[\0\r\n]/.test(limitQuery) ? limitQuery.trim() : '';
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 100, 1), 500) : 100;
  const files = await listMediaFiles(limit);
  return c.json({ ok: true, data: files });
});

/**
 * Media config status (plan Task 7/8) — does not return secret values.
 */
media.get('/config', (c) => {
  return c.json({
    ok: true,
    data: buildMediaConfigPublic(),
  });
});

/** Provider catalog with configured flags (no secrets). */
media.get('/providers', (c) => {
  const providers = listProviderCatalog();
  return c.json({
    ok: true,
    data: providers,
    meta: { count: providers.length },
  });
});

/** Video / async job poll */
media.get('/jobs/:id', (c) => {
  const idRaw = c.req.param('id');
  if (typeof idRaw !== 'string' || /[\0\r\n]/.test(idRaw) || !idRaw.trim()) {
    return c.json({ ok: false, error: 'Invalid job id' }, 400);
  }
  const job = getVideoJob(idRaw.trim());
  if (!job) return c.json({ ok: false, error: 'Not found' }, 404);
  return c.json({
    ok: true,
    data: {
      id: job.id,
      surface: job.surface,
      provider: job.provider,
      status: job.status,
      filename: job.filename,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
  });
});

media.get('/jobs', (c) => {
  const limitQuery = c.req.query('limit') ?? '';
  const limitRaw =
    limitQuery && !/[\0\r\n]/.test(limitQuery) ? limitQuery.trim() : '';
  const limit = limitRaw ? Math.min(Math.max(Number(limitRaw) || 50, 1), 200) : 50;
  const jobs = listMediaJobs(limit).map((job) => ({
    id: job.id,
    surface: job.surface,
    provider: job.provider,
    status: job.status,
    filename: job.filename,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  }));
  return c.json({ ok: true, data: jobs });
});

media.post('/image', async (c) => {
  const body = await c.req.json<{
    prompt: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    provider?: string;
    model?: string;
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.prompt === 'string' && /[\0\r\n]/.test(body.prompt)) {
    return c.json({ ok: false, error: 'prompt contains invalid control characters' }, 400);
  }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    return c.json({ ok: false, error: 'prompt is required' }, 400);
  }
  if (prompt.length > 4000) {
    return c.json({ ok: false, error: 'prompt too long' }, 400);
  }

  try {
    const result = await generateMediaUnified({
      surface: 'image',
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      prompt,
      size: body.size,
      quality: body.quality,
      model: typeof body.model === 'string' ? body.model : undefined,
    });
    if (result.surface !== 'image') {
      return c.json({ ok: false, error: 'Unexpected surface' }, 500);
    }
    return c.json({
      ok: true,
      data: {
        filePath: result.filePath,
        filename: result.filename,
        revisedPrompt: result.revisedPrompt,
        provider: result.provider,
      },
    });
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to generate image');
    return c.json({ ok: false, error: msg }, mediaClientErrorStatus(msg));
  }
});

media.post('/audio', async (c) => {
  const body = await c.req.json<{
    text: string;
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    model?: 'tts-1' | 'tts-1-hd';
    provider?: string;
  }>().catch(() => null);
  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  if (typeof body.text === 'string' && /[\0]/.test(body.text)) {
    return c.json({ ok: false, error: 'text contains invalid control characters' }, 400);
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) {
    return c.json({ ok: false, error: 'text is required' }, 400);
  }
  if (text.length > 4096) {
    return c.json({ ok: false, error: 'text too long (max 4096 chars)' }, 400);
  }

  try {
    const result = await generateMediaUnified({
      surface: 'audio',
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      text,
      voice: body.voice,
      model: body.model,
    });
    if (result.surface !== 'audio') {
      return c.json({ ok: false, error: 'Unexpected surface' }, 500);
    }
    return c.json({
      ok: true,
      data: {
        filePath: result.filePath,
        filename: result.filename,
        provider: result.provider,
      },
    });
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to generate audio');
    return c.json({ ok: false, error: msg }, mediaClientErrorStatus(msg));
  }
});

// Serve a saved media file by filename (path traversal + symlink-escape safe)
media.get('/file/:filename', (c) => {
  // Pass raw param — isSafeMediaFilename checks control chars before trim
  const filenameRaw = c.req.param('filename');
  if (!isSafeMediaFilename(filenameRaw)) {
    return c.json({ ok: false, error: 'Invalid filename' }, 400);
  }
  const filename = filenameRaw.trim();
  const filePath = resolveMediaFilePath(filename);
  if (!filePath) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.webp': 'image/webp',
  };
  const mimeType = mimeTypes[ext] ?? 'application/octet-stream';
  const buf = fs.readFileSync(filePath);
  c.header('Content-Type', mimeType);
  return c.body(buf);
});

/**
 * Unified media generate endpoint (plan Task 7/8).
 * Body: { surface: 'image' | 'audio' | 'video', provider?, prompt|text, size?, quality?, voice?, model? }
 */
media.post('/generate', async (c) => {
  const body = await c.req.json<{
    surface?: 'image' | 'audio' | 'video';
    provider?: string;
    prompt?: string;
    text?: string;
    size?: '1024x1024' | '1792x1024' | '1024x1792';
    quality?: 'standard' | 'hd';
    voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
    model?: string;
  }>().catch(() => null);

  if (!body || typeof body !== 'object') {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  // Control-char check before trim (leading \r\n must not strip to "image")
  const surfaceRaw = typeof body.surface === 'string' ? body.surface : '';
  if (surfaceRaw && /[\0\r\n]/.test(surfaceRaw)) {
    return c.json({ ok: false, error: 'surface contains invalid control characters' }, 400);
  }
  const surface = surfaceRaw.trim().toLowerCase();
  if (surface !== 'image' && surface !== 'audio' && surface !== 'video') {
    return c.json({ ok: false, error: 'surface must be image, audio, or video' }, 400);
  }

  const providerRaw = typeof body.provider === 'string' ? body.provider : '';
  if (providerRaw && /[\0\r\n]/.test(providerRaw)) {
    return c.json({ ok: false, error: 'provider contains invalid control characters' }, 400);
  }

  try {
    const result = await generateMediaUnified({
      surface: surface as 'image' | 'audio' | 'video',
      provider: providerRaw.trim() || undefined,
      prompt: body.prompt,
      text: body.text,
      size: body.size,
      quality: body.quality,
      voice: body.voice,
      model: typeof body.model === 'string' ? body.model : undefined,
    });
    return c.json({ ok: true, data: result });
  } catch (err) {
    const msg = publicErrorMessage(err, 'Failed to generate media');
    return c.json({ ok: false, error: msg }, mediaClientErrorStatus(msg));
  }
});

/** Delete a generated media file */
media.delete('/file/:filename', (c) => {
  // Pass raw param — isSafeMediaFilename checks control chars before trim
  const filenameRaw = c.req.param('filename');
  if (!isSafeMediaFilename(filenameRaw)) {
    return c.json({ ok: false, error: 'Invalid filename' }, 400);
  }
  const filename = filenameRaw.trim();
  // realpath containment — refuse to unlink through escape symlink
  const filePath = resolveMediaFilePath(filename);
  if (!filePath) {
    return c.json({ ok: false, error: 'Not found' }, 404);
  }
  try {
    // Unlink the path under MEDIA_DIR (not the escape target if any)
    fs.unlinkSync(path.join(MEDIA_DIR, filename));
    return c.json({ ok: true });
  } catch (err) {
    const msg = publicErrorMessage(err, 'Delete failed');
    return c.json({ ok: false, error: msg }, 500);
  }
});

export default media;
