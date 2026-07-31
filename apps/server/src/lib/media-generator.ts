import { isSafeMediaFilename } from './media-filename.js';
/**
 * Media Generation helpers — multi-provider image / audio / video (Task 8).
 * OpenAI DALL-E 3 + TTS baseline; Azure / xAI / OpenAI-compatible via baseURL;
 * stub when NEOS_MEDIA_ALLOW_STUBS=1.
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  defaultProviderForSurface,
  mediaStubsAllowed,
  resolveMediaProvider,
  type MediaProviderId,
  type MediaSurface,
} from './media-providers.js';
import {
  createMediaJob,
  getMediaJob,
  updateMediaJob,
  type MediaJob,
} from './media-jobs.js';

/** Cap OpenAI API key length; reject control chars (header hygiene). */
const API_KEY_MAX_CHARS = 8_192;

function sanitizeApiKey(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const key = raw.trim();
  if (!key || key.length > API_KEY_MAX_CHARS) return '';
  return key;
}

function sanitizeBaseURL(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return undefined;
  const u = raw.trim().replace(/\/+$/, '');
  if (!u || u.length > 2_048) return undefined;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
    return u;
  } catch {
    return undefined;
  }
}

function getClient(apiKey: string, baseURL?: string) {
  const opts: { apiKey: string; baseURL?: string } = { apiKey };
  const base = sanitizeBaseURL(baseURL);
  if (base) opts.baseURL = base;
  return new OpenAI(opts);
}

export const MEDIA_DIR = path.join(os.homedir(), '.neos-work', 'media');

async function ensureMediaDir() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

export interface MediaFileInfo {
  filename: string;
  size: number;
  kind: 'image' | 'audio' | 'video' | 'other';
  mimeType: string;
  createdAt: string;
  urlPath: string;
}

/** List generated media files under ~/.neos-work/media (newest first). */
export async function listMediaFiles(limit = 100): Promise<MediaFileInfo[]> {
  const capped = Math.min(Math.max(Number(limit) || 100, 1), 500);
  await ensureMediaDir();
  let names: string[];
  try {
    names = await fs.readdir(MEDIA_DIR);
  } catch {
    return [];
  }

  const items: MediaFileInfo[] = [];
  for (const filename of names) {
    if (!isSafeMediaFilename(filename)) continue;
    const filePath = path.join(MEDIA_DIR, filename);
    try {
      const st = await fs.stat(filePath);
      if (!st.isFile()) continue;
      const ext = path.extname(filename).toLowerCase();
      const kind: MediaFileInfo['kind'] =
        ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? 'image'
          : ['.mp3', '.wav', '.opus', '.aac', '.flac'].includes(ext) ? 'audio'
            : ['.mp4', '.webm', '.mov'].includes(ext) ? 'video'
              : 'other';
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.mov': 'video/quicktime',
      };
      items.push({
        filename,
        size: st.size,
        kind,
        mimeType: mimeTypes[ext] ?? 'application/octet-stream',
        createdAt: st.mtime.toISOString(),
        urlPath: `/api/media/file/${encodeURIComponent(filename)}`,
      });
    } catch {
      // skip unreadable
    }
  }

  items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return items.slice(0, capped);
}

export interface GenerateImageResult {
  filePath: string;
  url: string;
  revisedPrompt?: string;
}

/** Aligned with desktop media-node-options / MediaNode runtime allow-lists. */
export const IMAGE_SIZES = new Set(['1024x1024', '1792x1024', '1024x1792']);
export const IMAGE_QUALITIES = new Set(['standard', 'hd']);
export const TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
export const TTS_MODELS = new Set(['tts-1', 'tts-1-hd']);

const IMAGE_PROMPT_MAX = 4000;
const AUDIO_TEXT_MAX = 4096;

export async function generateImage(options: {
  prompt: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  apiKey: string;
  /** OpenAI-compatible base URL (Azure / xAI / custom). */
  baseURL?: string;
  /** Model id (default dall-e-3). */
  model?: string;
}): Promise<GenerateImageResult> {
  if (typeof options.prompt === 'string' && /[\0\r\n]/.test(options.prompt)) {
    throw new Error('prompt contains invalid control characters');
  }
  const prompt = typeof options.prompt === 'string' ? options.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');
  if (prompt.length > IMAGE_PROMPT_MAX) {
    throw new Error(`prompt too long (max ${IMAGE_PROMPT_MAX})`);
  }
  const sizeRaw =
    typeof options.size === 'string' && !/[\0\r\n]/.test(options.size)
      ? options.size.trim().toLowerCase()
      : '1024x1024';
  const size = (IMAGE_SIZES.has(sizeRaw) ? sizeRaw : '1024x1024') as
    '1024x1024' | '1792x1024' | '1024x1792';
  const qualityRaw =
    typeof options.quality === 'string' && !/[\0\r\n]/.test(options.quality)
      ? options.quality.trim().toLowerCase()
      : 'standard';
  const quality = (IMAGE_QUALITIES.has(qualityRaw) ? qualityRaw : 'standard') as 'standard' | 'hd';
  const apiKey = sanitizeApiKey(options.apiKey);
  if (!apiKey) throw new Error('apiKey is required');
  const modelRaw =
    typeof options.model === 'string' && !/[\0\r\n]/.test(options.model)
      ? options.model.trim()
      : 'dall-e-3';
  const model = modelRaw || 'dall-e-3';
  const client = getClient(apiKey, options.baseURL);

  const response = await client.images.generate({
    model,
    prompt,
    size,
    quality,
    response_format: 'url',
    n: 1,
  });

  const item = response.data?.[0];
  if (!item?.url) throw new Error('No image URL returned');

  // Download the image and save locally (http(s) only — defense against non-http redirects)
  const imageUrlRaw = typeof item.url === 'string' ? item.url : '';
  if (!imageUrlRaw || /[\0\r\n]/.test(imageUrlRaw) || imageUrlRaw.length > 2_048) {
    throw new Error('Invalid image URL returned');
  }
  const imageUrl = imageUrlRaw.trim();
  try {
    const u = new URL(imageUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('Image URL must be http(s)');
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('http(s)')) throw err;
    throw new Error('Invalid image URL returned');
  }
  await ensureMediaDir();
  // Cap downloaded image size (plan Task 7 — 16 MB max)
  const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error('Failed to download image');
  // Reject oversized payloads early via Content-Length when present
  const clHeader = imgRes.headers?.get?.('content-length');
  if (clHeader) {
    const cl = Number(clHeader);
    if (Number.isFinite(cl) && cl > MAX_IMAGE_BYTES) {
      throw new Error(`Image exceeds max size (${MAX_IMAGE_BYTES} bytes)`);
    }
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds max size (${MAX_IMAGE_BYTES} bytes)`);
  }
  const filename = `img_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buf);

  return { filePath, url: imageUrl, revisedPrompt: item.revised_prompt };
}

export interface GenerateAudioResult {
  filePath: string;
}

export async function generateAudio(options: {
  text: string;
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  model?: 'tts-1' | 'tts-1-hd' | string;
  apiKey: string;
  baseURL?: string;
}): Promise<GenerateAudioResult> {
  // TTS allows multi-line text; only null-byte is rejected (align with media route)
  if (typeof options.text === 'string' && /\0/.test(options.text)) {
    throw new Error('text contains invalid control characters');
  }
  const text = typeof options.text === 'string' ? options.text.trim() : '';
  if (!text) throw new Error('text is required');
  if (text.length > AUDIO_TEXT_MAX) {
    throw new Error(`text too long (max ${AUDIO_TEXT_MAX})`);
  }
  const voiceRaw =
    typeof options.voice === 'string' && !/[\0\r\n]/.test(options.voice)
      ? options.voice.trim().toLowerCase()
      : 'alloy';
  const voice = (TTS_VOICES.has(voiceRaw) ? voiceRaw : 'alloy') as
    'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  const modelRaw =
    typeof options.model === 'string' && !/[\0\r\n]/.test(options.model)
      ? options.model.trim().toLowerCase()
      : 'tts-1';
  const model = (TTS_MODELS.has(modelRaw) ? modelRaw : 'tts-1') as 'tts-1' | 'tts-1-hd';
  const apiKey = sanitizeApiKey(options.apiKey);
  if (!apiKey) throw new Error('apiKey is required');
  const client = getClient(apiKey, options.baseURL);

  const mp3 = await client.audio.speech.create({
    model,
    voice,
    input: text,
  });

  await ensureMediaDir();
  // Cap TTS audio payload (plan Task 7 — runaway binary defense)
  const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
  const buf = Buffer.from(await mp3.arrayBuffer());
  if (buf.length > MAX_AUDIO_BYTES) {
    throw new Error(`Audio exceeds max size (${MAX_AUDIO_BYTES} bytes)`);
  }
  const filename = `audio_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buf);

  return { filePath };
}

/** Minimal placeholder PNG (1×1) for stub image surface. */
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export async function generateStubImage(prompt: string): Promise<GenerateImageResult> {
  if (!mediaStubsAllowed()) {
    throw new Error('Stub media is disabled (set NEOS_MEDIA_ALLOW_STUBS=1)');
  }
  await ensureMediaDir();
  const filename = `img_stub_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, STUB_PNG);
  return {
    filePath,
    url: `stub://image`,
    revisedPrompt: `stub: ${prompt.slice(0, 200)}`,
  };
}

export async function generateStubAudio(text: string): Promise<GenerateAudioResult> {
  if (!mediaStubsAllowed()) {
    throw new Error('Stub media is disabled (set NEOS_MEDIA_ALLOW_STUBS=1)');
  }
  await ensureMediaDir();
  // Tiny silent-ish payload (not a valid full MP3 frame — enough for file registry)
  const filename = `audio_stub_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(MEDIA_DIR, filename);
  const body = Buffer.from(`ID3stub:${text.slice(0, 64)}`, 'utf8');
  await fs.writeFile(filePath, body);
  return { filePath };
}

export async function generateStubVideo(prompt: string): Promise<{ filePath: string; filename: string }> {
  if (!mediaStubsAllowed()) {
    throw new Error('Stub media is disabled (set NEOS_MEDIA_ALLOW_STUBS=1)');
  }
  await ensureMediaDir();
  const filename = `video_stub_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`;
  const filePath = path.join(MEDIA_DIR, filename);
  // Placeholder bytes — not a real MP4 bitstream
  await fs.writeFile(filePath, Buffer.from(`ftypstub:${prompt.slice(0, 80)}`, 'utf8'));
  return { filePath, filename };
}

/**
 * Google Imagen-style image generation via Generative Language REST.
 * Best-effort; failures surface clear errors (no silent stub).
 */
export async function generateGoogleImage(options: {
  prompt: string;
  apiKey: string;
}): Promise<GenerateImageResult> {
  if (typeof options.prompt === 'string' && /[\0\r\n]/.test(options.prompt)) {
    throw new Error('prompt contains invalid control characters');
  }
  const prompt = typeof options.prompt === 'string' ? options.prompt.trim() : '';
  if (!prompt) throw new Error('prompt is required');
  if (prompt.length > IMAGE_PROMPT_MAX) {
    throw new Error(`prompt too long (max ${IMAGE_PROMPT_MAX})`);
  }
  const apiKey = sanitizeApiKey(options.apiKey);
  if (!apiKey) throw new Error('apiKey is required');

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt }],
      parameters: { sampleCount: 1 },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).replace(/[\0\r\n]+/g, ' ').slice(0, 200);
    throw new Error(
      detail
        ? `Google image generation failed: ${res.status}: ${detail}`
        : `Google image generation failed: ${res.status}`,
    );
  }
  const json = (await res.json()) as {
    predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
  };
  const b64 = json.predictions?.[0]?.bytesBase64Encoded;
  if (!b64 || typeof b64 !== 'string') {
    throw new Error('Google image generation returned no image data');
  }
  const buf = Buffer.from(b64, 'base64');
  const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
  if (buf.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image exceeds max size (${MAX_IMAGE_BYTES} bytes)`);
  }
  await ensureMediaDir();
  const filename = `img_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buf);
  return { filePath, url: 'google://imagen' };
}

export type UnifiedGenerateResult =
  | {
      surface: 'image' | 'audio';
      provider: string;
      filePath: string;
      filename: string;
      revisedPrompt?: string;
      async?: false;
    }
  | {
      surface: 'video';
      provider: string;
      jobId: string;
      status: string;
      async: true;
      filename?: string;
      filePath?: string;
    };

/**
 * Dispatch generation to the resolved multi-provider catalog.
 */
export async function generateMediaUnified(input: {
  surface: MediaSurface;
  provider?: string;
  prompt?: string;
  text?: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  voice?: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  model?: string;
}): Promise<UnifiedGenerateResult> {
  const surface = input.surface;
  const providerId = (input.provider?.trim() || defaultProviderForSurface(surface)) as MediaProviderId;
  const resolved = resolveMediaProvider(providerId);
  if (!resolved.configured) {
    throw new Error(resolved.reason || `Provider ${providerId} is not configured`);
  }
  if (!resolved.def.surfaces.includes(surface)) {
    throw new Error(`Provider ${providerId} does not support surface ${surface}`);
  }

  if (surface === 'image') {
    const rawPrompt = input.prompt ?? input.text ?? '';
    if (typeof rawPrompt === 'string' && /[\0\r\n]/.test(rawPrompt)) {
      throw new Error('prompt contains invalid control characters');
    }
    const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
    if (!prompt) throw new Error('prompt is required for image');

    let result: GenerateImageResult;
    if (resolved.def.isStub) {
      result = await generateStubImage(prompt);
    } else if (providerId === 'google') {
      result = await generateGoogleImage({ prompt, apiKey: resolved.apiKey! });
    } else {
      result = await generateImage({
        prompt,
        size: input.size,
        quality: input.quality,
        apiKey: resolved.apiKey!,
        baseURL: resolved.baseURL,
        model: input.model || resolved.def.models.image?.[0],
      });
    }
    return {
      surface: 'image',
      provider: providerId,
      filePath: result.filePath,
      filename: path.basename(result.filePath),
      revisedPrompt: result.revisedPrompt,
    };
  }

  if (surface === 'audio') {
    const rawText = input.text ?? input.prompt ?? '';
    if (typeof rawText === 'string' && /\0/.test(rawText)) {
      throw new Error('text contains invalid control characters');
    }
    const text = typeof rawText === 'string' ? rawText.trim() : '';
    if (!text) throw new Error('text is required for audio');

    let result: GenerateAudioResult;
    if (resolved.def.isStub) {
      result = await generateStubAudio(text);
    } else {
      result = await generateAudio({
        text,
        voice: input.voice,
        model: input.model,
        apiKey: resolved.apiKey!,
        baseURL: resolved.baseURL,
      });
    }
    return {
      surface: 'audio',
      provider: providerId,
      filePath: result.filePath,
      filename: path.basename(result.filePath),
    };
  }

  // video — async job
  const rawPrompt = input.prompt ?? input.text ?? '';
  if (typeof rawPrompt === 'string' && /[\0\r\n]/.test(rawPrompt)) {
    throw new Error('prompt contains invalid control characters');
  }
  const prompt = typeof rawPrompt === 'string' ? rawPrompt.trim() : '';
  if (!prompt) throw new Error('prompt is required for video');
  if (prompt.length > IMAGE_PROMPT_MAX) {
    throw new Error(`prompt too long (max ${IMAGE_PROMPT_MAX})`);
  }

  const job = createMediaJob({
    surface: 'video',
    provider: providerId,
    prompt,
    model: input.model || resolved.def.models.video?.[0],
  });
  // Fire-and-forget completion (stub completes immediately; live providers background)
  void runVideoJob(job.id, resolved, prompt, input.model);

  return {
    surface: 'video',
    provider: providerId,
    jobId: job.id,
    status: job.status,
    async: true,
  };
}

async function runVideoJob(
  jobId: string,
  resolved: ReturnType<typeof resolveMediaProvider>,
  prompt: string,
  model?: string,
): Promise<void> {
  updateMediaJob(jobId, { status: 'running' });
  try {
    if (resolved.def.isStub) {
      const out = await generateStubVideo(prompt);
      updateMediaJob(jobId, {
        status: 'succeeded',
        filePath: out.filePath,
        filename: out.filename,
      });
      return;
    }

    // xAI / OpenAI-compatible video: attempt async create+poll if endpoint exists;
    // otherwise fail clearly (no silent stub).
    if (!resolved.apiKey) {
      throw new Error('API key missing for video provider');
    }
    const base = (resolved.baseURL || 'https://api.x.ai/v1').replace(/\/+$/, '');
    const createRes = await fetch(`${base}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${resolved.apiKey}`,
      },
      body: JSON.stringify({
        model: model || resolved.def.models.video?.[0] || 'grok-video',
        prompt,
      }),
    });
    if (!createRes.ok) {
      const detail = (await createRes.text().catch(() => '')).replace(/[\0\r\n]+/g, ' ').slice(0, 200);
      throw new Error(
        detail
          ? `Video generation failed: ${createRes.status}: ${detail}`
          : `Video generation failed: ${createRes.status}`,
      );
    }
    const created = (await createRes.json()) as {
      id?: string;
      status?: string;
      data?: Array<{ url?: string }>;
    };

    // Immediate URL path
    const directUrl = created.data?.[0]?.url;
    if (typeof directUrl === 'string' && directUrl.startsWith('http')) {
      const file = await downloadVideoToMedia(directUrl);
      updateMediaJob(jobId, {
        status: 'succeeded',
        filePath: file.filePath,
        filename: file.filename,
      });
      return;
    }

    // Poll job id when provided
    const remoteId = typeof created.id === 'string' ? created.id : '';
    if (!remoteId || /[\0\r\n]/.test(remoteId)) {
      throw new Error('Video provider returned no job id or URL');
    }
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2_000));
      const pollRes = await fetch(`${base}/videos/generations/${encodeURIComponent(remoteId)}`, {
        headers: { Authorization: `Bearer ${resolved.apiKey}` },
      });
      if (!pollRes.ok) continue;
      const polled = (await pollRes.json()) as {
        status?: string;
        data?: Array<{ url?: string }>;
        error?: { message?: string };
      };
      const st = (polled.status || '').toLowerCase();
      if (st === 'failed' || st === 'error') {
        throw new Error(polled.error?.message || 'Video generation failed');
      }
      const url = polled.data?.[0]?.url;
      if ((st === 'succeeded' || st === 'completed') && typeof url === 'string') {
        const file = await downloadVideoToMedia(url);
        updateMediaJob(jobId, {
          status: 'succeeded',
          filePath: file.filePath,
          filename: file.filename,
        });
        return;
      }
    }
    throw new Error('Video generation timed out');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Video generation failed';
    updateMediaJob(jobId, { status: 'failed', error: msg.slice(0, 500) });
  }
}

async function downloadVideoToMedia(url: string): Promise<{ filePath: string; filename: string }> {
  if (/[\0\r\n]/.test(url) || url.length > 2_048) {
    throw new Error('Invalid video URL');
  }
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('Video URL must be http(s)');
  }
  const MAX = 64 * 1024 * 1024;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to download video');
  const cl = res.headers?.get?.('content-length');
  if (cl && Number(cl) > MAX) throw new Error(`Video exceeds max size (${MAX} bytes)`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX) throw new Error(`Video exceeds max size (${MAX} bytes)`);
  await ensureMediaDir();
  const filename = `video_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp4`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buf);
  return { filePath, filename };
}

export function getVideoJob(id: string): MediaJob | undefined {
  return getMediaJob(id);
}
