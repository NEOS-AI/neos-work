/**
 * Media Generation helpers — OpenAI DALL-E 3 (image) + TTS (audio)
 */

import OpenAI from 'openai';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

function getClient(apiKey: string) {
  return new OpenAI({ apiKey });
}

const MEDIA_DIR = path.join(os.homedir(), '.neos-work', 'media');

async function ensureMediaDir() {
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

export interface GenerateImageResult {
  filePath: string;
  url: string;
  revisedPrompt?: string;
}

export async function generateImage(options: {
  prompt: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  apiKey: string;
}): Promise<GenerateImageResult> {
  const { prompt, size = '1024x1024', quality = 'standard', apiKey } = options;
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

  // Download the image and save locally
  await ensureMediaDir();
  const imgRes = await fetch(item.url);
  if (!imgRes.ok) throw new Error('Failed to download image');
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const filename = `img_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.png`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buf);

  return { filePath, url: item.url, revisedPrompt: item.revised_prompt };
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
  const { text, voice = 'alloy', model = 'tts-1', apiKey } = options;
  const client = getClient(apiKey);

  const mp3 = await client.audio.speech.create({
    model,
    voice,
    input: text,
  });

  await ensureMediaDir();
  const buf = Buffer.from(await mp3.arrayBuffer());
  const filename = `audio_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(MEDIA_DIR, filename);
  await fs.writeFile(filePath, buf);

  return { filePath };
}
