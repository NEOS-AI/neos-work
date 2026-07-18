/**
 * MediaNode — generates images or audio via server API
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

export const MediaNode: ExecutableNode = {
  type: 'media',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const start = Date.now();
    const { config, settings, inputs } = ctx;
    const mediaType = (config?.mediaType as string) ?? 'image';
    const serverUrl = settings['SERVER_URL'] ?? 'http://localhost:3001';
    const serverToken = settings['SERVER_TOKEN'] ?? '';

    if (mediaType === 'image') {
      const prompt = (config?.prompt as string) ?? (inputs['prompt'] as string) ?? '';
      if (!prompt) {
        return {
          ok: false,
          output: null,
          error: 'No prompt provided for image generation',
          durationMs: Date.now() - start,
        };
      }

      const size = (config?.size as string) ?? '1024x1024';
      const quality = (config?.quality as string) ?? 'standard';

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
    }

    if (mediaType === 'audio') {
      const text = (config?.text as string) ?? (inputs['text'] as string) ?? '';
      if (!text) {
        return {
          ok: false,
          output: null,
          error: 'No text provided for audio generation',
          durationMs: Date.now() - start,
        };
      }

      const voice = (config?.voice as string) ?? 'alloy';
      const model = (config?.model as string) ?? 'tts-1';

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
    }

    return {
      ok: false,
      output: null,
      error: `Unknown media type: ${mediaType}`,
      durationMs: Date.now() - start,
    };
  },
};
