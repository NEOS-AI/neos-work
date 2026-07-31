import { afterEach, describe, expect, it } from 'vitest';
import {
  clearMediaJobs,
  createMediaJob,
  getMediaJob,
  listMediaJobs,
  updateMediaJob,
} from './media-jobs.js';

afterEach(() => {
  clearMediaJobs();
});

describe('media-jobs', () => {
  it('creates, updates, and lists jobs', () => {
    const job = createMediaJob({
      surface: 'video',
      provider: 'stub',
      prompt: 'a walking cat',
    });
    expect(job.id.startsWith('mjob_')).toBe(true);
    expect(job.status).toBe('queued');
    expect(getMediaJob(job.id)?.prompt).toBe('a walking cat');

    updateMediaJob(job.id, { status: 'running' });
    expect(getMediaJob(job.id)?.status).toBe('running');
    updateMediaJob(job.id, {
      status: 'succeeded',
      filename: 'video_stub.mp4',
      filePath: '/tmp/video_stub.mp4',
    });
    expect(getMediaJob(job.id)?.filename).toBe('video_stub.mp4');
    expect(listMediaJobs(10).some((j) => j.id === job.id)).toBe(true);
  });

  it('rejects control-char job ids', () => {
    expect(getMediaJob('bad\nid')).toBeUndefined();
    expect(getMediaJob('')).toBeUndefined();
  });
});
