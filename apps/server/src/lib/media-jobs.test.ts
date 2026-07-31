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

  it('sanitizes provider/prompt and ignores invalid status patches', () => {
    const job = createMediaJob({
      surface: 'video',
      provider: '  XAI  ',
      prompt: '  hello  ',
      model: '  grok-video  ',
    });
    expect(job.provider).toBe('xai');
    expect(job.prompt).toBe('hello');
    expect(job.model).toBe('grok-video');

    const ctrl = createMediaJob({
      surface: 'video',
      provider: 'bad\nprov',
      prompt: 'line\nbreak',
    });
    expect(ctrl.provider).toBe('unknown');
    expect(ctrl.prompt).toBe('');

    updateMediaJob(job.id, { status: 'nope' as never, error: 'err\nline' });
    expect(getMediaJob(job.id)?.status).toBe('queued');
    expect(getMediaJob(job.id)?.error).toBe('err line');
  });

  it('hard-caps registry size under load', () => {
    for (let i = 0; i < 220; i++) {
      createMediaJob({
        surface: 'video',
        provider: 'stub',
        prompt: `p${i}`,
      });
    }
    expect(listMediaJobs(500).length).toBeLessThanOrEqual(200);
  });
});
