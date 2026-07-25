import { isSafeMediaFilename } from './media-filename.js';
/**
 * Media Generation helpers — OpenAI DALL-E 3 (image) + TTS (audio)
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

/** Cap OpenAI API key length; reject control chars (header hygiene). */
const API_KEY_MAX_CHARS = 8_192;

function sanitizeApiKey(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  const key = raw.trim();
  if (!key || key.length > API_KEY_MAX_CHARS) return '';
  return key;
}

function getClient(apiKey: string) {
  return new OpenAI({ apiKey });
}

export const MEDIA_DIR = path.join(os.homedir(), '.neos-work', 'media');

async function ensureMediaDir() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

export interface MediaFileInfo {
  filename: string;
  size: number;
  kind: 'image' | 'audio' | 'other';
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
            : 'other';
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.gif': 'image/gif',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
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
  const client = getClient(apiKey);

  const response = await client.images.generate({
    model: 'dall-e-3',
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
  model?: 'tts-1' | 'tts-1-hd';
  apiKey: string;
}): Promise<GenerateAudioResult> {
  // Control-char check before trim (trim strips leading/trailing \r\n)
  if (typeof options.text === 'string' && /[\0\r\n]/.test(options.text)) {
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
  const client = getClient(apiKey);

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
