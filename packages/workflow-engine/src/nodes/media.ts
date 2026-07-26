/**
 * MediaNode — generates images or audio via server API
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';
import { safeServerUrl } from './server-url.js';
import { scrubErrorMessage } from '@neos-work/core';

/** Aligned with desktop NodeConfigPanel / media-node-options allow-lists. */
const IMAGE_SIZES = new Set(['1024x1024', '1792x1024', '1024x1792']);
const IMAGE_QUALITIES = new Set(['standard', 'hd']);
const TTS_VOICES = new Set(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']);
const TTS_MODELS = new Set(['tts-1', 'tts-1-hd']);
/** Align with apps/server media routes (prompt ≤ 4000, TTS text ≤ 4096). */
const IMAGE_PROMPT_MAX = 4000;
const AUDIO_TEXT_MAX = 4096;

function resolvePromptRaw(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const raw = config?.['prompt'] ?? inputs['prompt'] ?? '';
  return typeof raw === 'string' ? raw : String(raw);
}

function resolveAudioTextRaw(
  config: Record<string, unknown> | undefined,
  inputs: Record<string, unknown>,
): string {
  const raw = config?.['text'] ?? inputs['text'] ?? '';
  return typeof raw === 'string' ? raw : String(raw);
}

export const MediaNode: ExecutableNode = {
  type: 'media',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const { config, settings, inputs } = ctx;
    // Control-char before trim so leading \n cannot strip to "image"/"audio"
    const mediaTypeRaw = String(config?.mediaType ?? 'image');
    const mediaType =
      /[\0\r\n]/.test(mediaTypeRaw)
        ? 'image'
        : mediaTypeRaw.trim().toLowerCase() || 'image';
    const serverUrl = safeServerUrl(settings['SERVER_URL']);
    const rawServerToken = String(settings['SERVER_TOKEN'] ?? '');
    // Drop tokens that would break Authorization headers (check before trim)
    let serverToken =
      /[\0\r\n]/.test(rawServerToken) || rawServerToken.trim().length > 8_192
        ? ''
        : rawServerToken.trim();

    if (mediaType === 'image') {
      const promptRaw = resolvePromptRaw(config, inputs);
      if (/[\0\r\n]/.test(promptRaw)) {
        return {
          ok: false,
          output: null,
          error: 'Image prompt contains invalid control characters',
          durationMs: Date.now() - start,
        };
      }
      const prompt = promptRaw.trim();
      if (!prompt) {
        return {
          ok: false,
          output: null,
          error: 'No prompt provided for image generation',
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

      // Control-char size/quality → fall back to defaults (check before trim)
      const sizeRaw0 = typeof config?.size === 'string' ? config.size : '1024x1024';
      const rawSize =
        /[\0\r\n]/.test(sizeRaw0) ? '1024x1024' : sizeRaw0.trim().toLowerCase() || '1024x1024';
      const size = IMAGE_SIZES.has(rawSize) ? rawSize : '1024x1024';
      const qualityRaw0 = typeof config?.quality === 'string' ? config.quality : 'standard';
      const rawQuality =
        /[\0\r\n]/.test(qualityRaw0)
          ? 'standard'
          : qualityRaw0.trim().toLowerCase() || 'standard';
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
          // Scrub control chars from media API error bodies
          const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
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
          let errMsg = 'Image generation failed';
          if (typeof data.error === 'string' && !/[\0\r\n]/.test(data.error)) {
            const e = data.error.trim();
            if (e) errMsg = e;
          }
          return {
            ok: false,
            output: null,
            error: errMsg,
            durationMs: Date.now() - start,
          };
        }
        // Control-char filename / revised prompt dropped (check before trim)
        let filename = '';
        if (typeof data.data?.filename === 'string' && !/[\0\r\n]/.test(data.data.filename)) {
          filename = data.data.filename.trim();
        }
        let revised = '';
        if (
          typeof data.data?.revisedPrompt === 'string'
          && !/\0/.test(data.data.revisedPrompt)
        ) {
          revised = data.data.revisedPrompt.replace(/[\r\n]+/g, ' ').trim();
        }
        return {
          ok: true,
          output: `Image generated: ${filename}${revised ? `\nRevised prompt: ${revised}` : ''}`.trim(),
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          ok: false,
          output: null,
          error: scrubErrorMessage(err instanceof Error ? err.message : 'Image generation failed') || 'Image generation failed',
          durationMs: Date.now() - start,
        };
      }
    }

    if (mediaType === 'audio') {
      const textRaw = resolveAudioTextRaw(config, inputs);
      // TTS allows multi-line text; only null-byte is rejected (align with media route / generator)
      if (/\0/.test(textRaw)) {
        return {
          ok: false,
          output: null,
          error: 'Audio text contains invalid control characters',
          durationMs: Date.now() - start,
        };
      }
      const text = textRaw.trim();
      if (!text) {
        return {
          ok: false,
          output: null,
          error: 'No text provided for audio generation',
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

      // Control-char voice/model → defaults (check before trim)
      const voiceRaw0 = typeof config?.voice === 'string' ? config.voice : 'alloy';
      const rawVoice =
        /[\0\r\n]/.test(voiceRaw0) ? 'alloy' : voiceRaw0.trim().toLowerCase() || 'alloy';
      const voice = TTS_VOICES.has(rawVoice) ? rawVoice : 'alloy';
      const modelRaw0 = typeof config?.model === 'string' ? config.model : 'tts-1';
      const rawModel =
        /[\0\r\n]/.test(modelRaw0) ? 'tts-1' : modelRaw0.trim().toLowerCase() || 'tts-1';
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
          // Scrub control chars from media API error bodies
          const detail = body.replace(/[\0\r\n]+/g, ' ').trim().slice(0, 500);
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
          let errMsg = 'Audio generation failed';
          if (typeof data.error === 'string' && !/[\0\r\n]/.test(data.error)) {
            const e = data.error.trim();
            if (e) errMsg = e;
          }
          return {
            ok: false,
            output: null,
            error: errMsg,
            durationMs: Date.now() - start,
          };
        }
        let filename = '';
        if (typeof data.data?.filename === 'string' && !/[\0\r\n]/.test(data.data.filename)) {
          filename = data.data.filename.trim();
        }
        return {
          ok: true,
          output: `Audio generated: ${filename}`,
          durationMs: Date.now() - start,
        };
      } catch (err) {
        return {
          ok: false,
          output: null,
          error: scrubErrorMessage(err instanceof Error ? err.message : 'Audio generation failed') || 'Audio generation failed',
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
