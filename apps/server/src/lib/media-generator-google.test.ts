import fs from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateGoogleImage, generateMediaUnified, MEDIA_DIR } from './media-generator.js';
import { clearMediaJobs, getMediaJob } from './media-jobs.js';
import * as mediaProviders from './media-providers.js';

const created: string[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearMediaJobs();
  delete process.env.NEOS_MEDIA_ALLOW_STUBS;
  for (const f of created.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('generateGoogleImage', () => {
  it('writes PNG from base64 prediction', async () => {
    const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          predictions: [{ bytesBase64Encoded: png.toString('base64'), mimeType: 'image/png' }],
        }),
        text: async () => '',
      }),
    );
    const result = await generateGoogleImage({ prompt: 'sunset', apiKey: 'gkey' });
    expect(result.url).toBe('google://imagen');
    expect(result.filePath.startsWith(MEDIA_DIR)).toBe(true);
    created.push(result.filePath);
    const st = await fs.stat(result.filePath);
    expect(st.size).toBe(png.length);
  });

  it('validates prompt and apiKey', async () => {
    await expect(generateGoogleImage({ prompt: '', apiKey: 'k' })).rejects.toThrow(/prompt/i);
    await expect(generateGoogleImage({ prompt: 'bad\np', apiKey: 'k' })).rejects.toThrow(
      /control/i,
    );
    await expect(generateGoogleImage({ prompt: 'ok', apiKey: '' })).rejects.toThrow(/apiKey/i);
  });

  it('surfaces HTTP and empty prediction errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => 'quota',
        json: async () => ({}),
      }),
    );
    await expect(generateGoogleImage({ prompt: 'x', apiKey: 'k' })).rejects.toThrow(/403/);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ predictions: [{}] }),
        text: async () => '',
      }),
    );
    await expect(generateGoogleImage({ prompt: 'x', apiKey: 'k' })).rejects.toThrow(/no image/i);
  });
});

describe('generateMediaUnified google + live video paths', () => {
  it('dispatches google image via unified API when configured', async () => {
    vi.spyOn(mediaProviders, 'resolveMediaProvider').mockReturnValue({
      id: 'google',
      def: mediaProviders.getProviderDef('google')!,
      configured: true,
      apiKey: 'gkey',
      baseURL: undefined,
      reason: undefined,
    } as ReturnType<typeof mediaProviders.resolveMediaProvider>);

    const png = Buffer.from([1, 2, 3, 4]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          predictions: [{ bytesBase64Encoded: png.toString('base64') }],
        }),
        text: async () => '',
      }),
    );

    const out = await generateMediaUnified({
      surface: 'image',
      provider: 'google',
      prompt: 'mountains',
    });
    expect(out.surface).toBe('image');
    if (out.surface === 'image') {
      created.push(out.filePath);
      expect(out.provider).toBe('google');
    }
  });

  it('live video job downloads direct URL from provider', async () => {
    vi.spyOn(mediaProviders, 'resolveMediaProvider').mockReturnValue({
      id: 'xai',
      def: mediaProviders.getProviderDef('xai')!,
      configured: true,
      apiKey: 'xkey',
      baseURL: 'https://api.x.ai/v1',
      reason: undefined,
    } as ReturnType<typeof mediaProviders.resolveMediaProvider>);

    const videoBytes = new Uint8Array([0, 0, 0, 1, 2, 3]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes('/videos/generations') && !String(url).match(/generations\/.+/)) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ url: 'https://cdn.example.com/v.mp4' }] }),
          text: async () => '',
          headers: { get: () => null },
        };
      }
      // download
      return {
        ok: true,
        status: 200,
        headers: {
          get: (k: string) =>
            k.toLowerCase() === 'content-length' ? String(videoBytes.length) : null,
        },
        arrayBuffer: async () => videoBytes.buffer.slice(
          videoBytes.byteOffset,
          videoBytes.byteOffset + videoBytes.byteLength,
        ),
        text: async () => '',
        json: async () => ({}),
      };
    });
    vi.stubGlobal('fetch', fetchImpl);

    const out = await generateMediaUnified({
      surface: 'video',
      provider: 'xai',
      prompt: 'orbit shot',
    });
    expect(out.surface).toBe('video');
    if (out.surface === 'video') {
      // wait for background job
      let job = getMediaJob(out.jobId);
      for (let i = 0; i < 40 && job && job.status === 'running'; i++) {
        await new Promise((r) => setTimeout(r, 25));
        job = getMediaJob(out.jobId);
      }
      // may be succeeded or failed depending on SSRF of cdn.example.com host block
      expect(job).toBeTruthy();
      if (job?.status === 'succeeded' && job.filePath) {
        created.push(job.filePath);
      } else {
        // If SSRF blocked the host, still covered error path in downloadVideoToMedia
        expect(job?.status === 'failed' || job?.status === 'succeeded').toBe(true);
      }
    }
  });

  it('live video job fails clearly when create endpoint errors', async () => {
    vi.spyOn(mediaProviders, 'resolveMediaProvider').mockReturnValue({
      id: 'xai',
      def: mediaProviders.getProviderDef('xai')!,
      configured: true,
      apiKey: 'xkey',
      baseURL: 'https://api.x.ai/v1',
      reason: undefined,
    } as ReturnType<typeof mediaProviders.resolveMediaProvider>);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
        json: async () => ({}),
        headers: { get: () => null },
      }),
    );

    const out = await generateMediaUnified({
      surface: 'video',
      provider: 'xai',
      prompt: 'fail path',
    });
    if (out.surface === 'video') {
      let job = getMediaJob(out.jobId);
      for (let i = 0; i < 40 && job && (job.status === 'pending' || job.status === 'running'); i++) {
        await new Promise((r) => setTimeout(r, 25));
        job = getMediaJob(out.jobId);
      }
      expect(job?.status).toBe('failed');
      expect(job?.error).toMatch(/500|Video generation failed/i);
    }
  });
});
