import fs from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { generateMediaUnified, generateStubImage, MEDIA_DIR } from './media-generator.js';
import { clearMediaJobs, getMediaJob } from './media-jobs.js';

const created: string[] = [];

afterEach(async () => {
  delete process.env.NEOS_MEDIA_ALLOW_STUBS;
  clearMediaJobs();
  for (const f of created.splice(0)) {
    await fs.unlink(f).catch(() => {});
  }
});

describe('multi-provider generate + stub', () => {
  it('rejects stub when stubs disabled', async () => {
    await expect(generateStubImage('x')).rejects.toThrow(/disabled/i);
    await expect(
      generateMediaUnified({ surface: 'image', provider: 'stub', prompt: 'hi' }),
    ).rejects.toThrow(/disabled|not configured/i);
  });

  it('stub image/audio/video when allowed', async () => {
    process.env.NEOS_MEDIA_ALLOW_STUBS = '1';
    const img = await generateMediaUnified({
      surface: 'image',
      provider: 'stub',
      prompt: 'a cat',
    });
    expect(img.surface).toBe('image');
    if (img.surface === 'image') {
      created.push(img.filePath);
      expect(img.filename).toMatch(/\.png$/);
    }

    const audio = await generateMediaUnified({
      surface: 'audio',
      provider: 'stub',
      text: 'hello',
    });
    if (audio.surface === 'audio') {
      created.push(audio.filePath);
      expect(audio.filename).toMatch(/\.mp3$/);
    }

    const video = await generateMediaUnified({
      surface: 'video',
      provider: 'stub',
      prompt: 'drone shot',
    });
    expect(video.surface).toBe('video');
    if (video.surface === 'video') {
      expect(video.async).toBe(true);
      expect(video.jobId).toBeTruthy();
      // stub completes quickly in background
      await new Promise((r) => setTimeout(r, 50));
      const job = getMediaJob(video.jobId);
      expect(job?.status).toBe('succeeded');
      if (job?.filePath) created.push(job.filePath);
      expect(job?.filename).toMatch(/\.mp4$/);
    }
    expect(MEDIA_DIR).toBeTruthy();
  });
});
