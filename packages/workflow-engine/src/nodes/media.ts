/**
 * MediaNode — generates images or audio via server API
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { safeServerUrl } from './server-url.js';

/** Aligned with desktop NodeConfigPanel / media-node-options allow-lists. */
const IMAGE_SIZES = new Set(['1024x1024', '1792x1024', '1024x1792']);
const IMAGE_QUALITIES = new Set(['standard', 'hd']);
const TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const TTS_MODELS = new Set(['tts-1', 'tts-1-hd']);
/** Align with apps/server media routes (prompt ≤ 4000, TTS text ≤ 4096). */
const IMAGE_PROMPT_MAX = 4000;
const AUDIO_TEXT_MAX = 4096;

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
    // Normalize case/whitespace so "Image" / " AUDIO " work like the panel options
    const mediaType = String(config?.mediaType ?? 'image').trim().toLowerCase() || 'image';
    const serverUrl = safeServerUrl(settings['SERVER_URL']);
    const rawServerToken = String(settings['SERVER_TOKEN'] ?? '');
    // Drop tokens that would break Authorization headers (check before trim)
    let serverToken =
      /[\0\r\n]/.test(rawServerToken) || rawServerToken.trim().length > 8_192
        ? ''
        : rawServerToken.trim();

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
      if (/[\0\r\n]/.test(prompt)) {
        return {
          ok: false,
          output: null,
          error: 'Image prompt contains invalid control characters',
          durationMs: Date.now() - start,
        };
      }
      if (prompt.length > IMAGE_PROMPT_MAX) {
        return {
          ok: false,
          output: null,
          error: `Image prompt exceeds ${IMAGE_PROMPT_MAX} characters`,
          durationMs: Date.now() - start,
        };
      }

      const rawSize =
        typeof config?.size === 'string' ? config.size.trim().toLowerCase() : '1024x1024';
      const size = IMAGE_SIZES.has(rawSize) ? rawSize : '1024x1024';
      const rawQuality =
        typeof config?.quality === 'string' ? config.quality.trim().toLowerCase() : 'standard';
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

        const httpFailed =
          res.ok === false
          || (typeof res.status === 'number' && res.status >= 400);
        if (httpFailed) {
          const body = await res.text().catch(() => '');
          const detail = body.trim().slice(0, 500);
          const status = typeof res.status === 'number' ? res.status : 0;
          return {
            ok: false,
            output: null,
            error: detail
              ? `Image generation failed: ${status}: ${detail}`
              : `Image generation failed: ${status}`,
            durationMs: Date.now() - start,
          };
        }
        const data = await res.json() as { ok?: boolean; data?: { filename?: string; revisedPrompt?: string }; error?: string };
        if (data.ok === false) {
          return {
            ok: false,
            output: null,
            error: typeof data.error === 'string' && data.error.trim()
              ? data.error.trim()
              : 'Image generation failed',
            durationMs: Date.now() - start,
          };
        }
        const filename =
          typeof data.data?.filename === 'string' ? data.data.filename.trim() : '';
        const revised =
          typeof data.data?.revisedPrompt === 'string' ? data.data.revisedPrompt.trim() : '';
        return {
          ok: true,
          output: `Image generated: ${filename}${revised ? `\nRevised prompt: ${revised}` : ''}`.trim(),
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
      if (/[\0\r\n]/.test(text)) {
        return {
          ok: false,
          output: null,
          error: 'Audio text contains invalid control characters',
          durationMs: Date.now() - start,
        };
      }
      if (text.length > AUDIO_TEXT_MAX) {
        return {
          ok: false,
          output: null,
          error: `Audio text exceeds ${AUDIO_TEXT_MAX} characters`,
          durationMs: Date.now() - start,
        };
      }

      const rawVoice =
        typeof config?.voice === 'string' ? config.voice.trim().toLowerCase() : 'alloy';
      const voice = TTS_VOICES.has(rawVoice) ? rawVoice : 'alloy';
      const rawModel =
        typeof config?.model === 'string' ? config.model.trim().toLowerCase() : 'tts-1';
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

        const httpFailed =
          res.ok === false
          || (typeof res.status === 'number' && res.status >= 400);
        if (httpFailed) {
          const body = await res.text().catch(() => '');
          const detail = body.trim().slice(0, 500);
          const status = typeof res.status === 'number' ? res.status : 0;
          return {
            ok: false,
            output: null,
            error: detail
              ? `Audio generation failed: ${status}: ${detail}`
              : `Audio generation failed: ${status}`,
            durationMs: Date.now() - start,
          };
        }
        const data = await res.json() as { ok?: boolean; data?: { filename?: string }; error?: string };
        if (data.ok === false) {
          return {
            ok: false,
            output: null,
            error: typeof data.error === 'string' && data.error.trim()
              ? data.error.trim()
              : 'Audio generation failed',
            durationMs: Date.now() - start,
          };
        }
        const filename =
          typeof data.data?.filename === 'string' ? data.data.filename.trim() : '';
        return {
          ok: true,
          output: `Audio generated: ${filename}`,
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
