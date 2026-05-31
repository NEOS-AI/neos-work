/**
 * MediaNode — generates images or audio via server API
 */

import type { ExecutableNode, NodeContext, NodeResult } from '../types.js';

export const MediaNode: ExecutableNode = {
  type: 'media',

  async execute(ctx: NodeContext): Promise<NodeResult> {
    const { config, settings, inputs } = ctx;
    const mediaType = (config?.mediaType as string) ?? 'image';
    const serverUrl = settings['SERVER_URL'] ?? 'http://localhost:3001';
    const serverToken = settings['SERVER_TOKEN'] ?? '';

    if (mediaType === 'image') {
      const prompt = (config?.prompt as string) ?? (inputs['prompt'] as string) ?? '';
      if (!prompt) return { ok: false, error: 'No prompt provided for image generation' };

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
      if (!data.ok) return { ok: false, error: data.error ?? 'Image generation failed' };
      return {
        ok: true,
        output: `Image generated: ${data.data?.filename}\n${data.data?.revisedPrompt ? `Revised prompt: ${data.data.revisedPrompt}` : ''}`.trim(),
      };
    }

    if (mediaType === 'audio') {
      const text = (config?.text as string) ?? (inputs['text'] as string) ?? '';
      if (!text) return { ok: false, error: 'No text provided for audio generation' };

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
      if (!data.ok) return { ok: false, error: data.error ?? 'Audio generation failed' };
      return { ok: true, output: `Audio generated: ${data.data?.filename}` };
    }

    return { ok: false, error: `Unknown media type: ${mediaType}` };
  },
};
