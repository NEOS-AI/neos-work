/**
 * MediaNode — generates images or audio via server API
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

/** Aligned with desktop NodeConfigPanel / media-node-options allow-lists. */
const IMAGE_SIZES = new Set(['1024x1024', '1792x1024', '1024x1792']);
const IMAGE_QUALITIES = new Set(['standard', 'hd']);
const TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const TTS_MODELS = new Set(['tts-1', 'tts-1-hd']);

function resolvePrompt(config: Record<string, unknown> | undefined, inputs: Record<string, unknown>): string {
  const raw = config?.['prompt'] ?? inputs['prompt'] ?? '';
  return typeof raw === 'string' ? raw.trim() : String(raw).trim();
}

function resolveAudioText(config: Record<string, unknown> | undefined, inputs: Record<string, unknown>): string {
  const raw = config?.['text'] ?? inputs['text'] ?? '';
  return typeof raw === 'string' ? raw.trim() : String(raw).trim();
}

export const MediaNode: ExecutableNode = {
  type: 'media',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const { config, settings, inputs } = ctx;
    const mediaType = (config?.mediaType as string) ?? 'image';
    const serverUrl = settings['SERVER_URL'] ?? 'http://localhost:3001';
    const serverToken = settings['SERVER_TOKEN'] ?? '';

    if (mediaType === 'image') {
      const prompt = resolvePrompt(config, inputs);
      if (!prompt) {
        return {
          ok: false,
          output: null,
          error: 'No prompt provided for image generation',
          durationMs: Date.now() - start,
        };
      }

      const rawSize = typeof config?.size === 'string' ? config.size : '1024x1024';
      const size = IMAGE_SIZES.has(rawSize) ? rawSize : '1024x1024';
      const rawQuality = typeof config?.quality === 'string' ? config.quality : 'standard';
      const quality = IMAGE_QUALITIES.has(rawQuality) ? rawQuality : 'standard';

      try {
        const res = await fetch(`${serverUrl}/api/media/image`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serverToken}`,
          },
          body: JSON.stringify({ prompt, size, quality }),
          signal: ctx.signal,
        });

        const data = await res.json() as { ok: boolean; data?: { filename: string; revisedPrompt?: string }; error?: string };
        if (!data.ok) {
          return {
            ok: false,
            output: null,
            error: data.error ?? 'Image generation failed',
            durationMs: Date.now() - start,
          };
        }
        return {
          ok: true,
          output: `Image generated: ${data.data?.filename}\n${data.data?.revisedPrompt ? `Revised prompt: ${data.data.revisedPrompt}` : ''}`.trim(),
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          ok: false,
          output: null,
          error: err instanceof Error ? err.message : 'Image generation failed',
          durationMs: Date.now() - start,
        };
      }
    }

    if (mediaType === 'audio') {
      const text = resolveAudioText(config, inputs);
      if (!text) {
        return {
          ok: false,
          output: null,
          error: 'No text provided for audio generation',
          durationMs: Date.now() - start,
        };
      }

      const rawVoice = typeof config?.voice === 'string' ? config.voice : 'alloy';
      const voice = TTS_VOICES.has(rawVoice) ? rawVoice : 'alloy';
      const rawModel = typeof config?.model === 'string' ? config.model : 'tts-1';
      const model = TTS_MODELS.has(rawModel) ? rawModel : 'tts-1';

      try {
        const res = await fetch(`${serverUrl}/api/media/audio`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${serverToken}`,
          },
          body: JSON.stringify({ text, voice, model }),
          signal: ctx.signal,
        });

        const data = await res.json() as { ok: boolean; data?: { filename: string }; error?: string };
        if (!data.ok) {
          return {
            ok: false,
            output: null,
            error: data.error ?? 'Audio generation failed',
            durationMs: Date.now() - start,
          };
        }
        return {
          ok: true,
          output: `Audio generated: ${data.data?.filename}`,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          ok: false,
          output: null,
          error: err instanceof Error ? err.message : 'Audio generation failed',
          durationMs: Date.now() - start,
        };
      }
    }

    return {
      ok: false,
      output: null,
      error: `Unknown media type: ${mediaType}`,
      durationMs: Date.now() - start,
    };
  },
};
