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

  it('enforceJobCap prefers dropping finished jobs before active ones', () => {
    // Fill near cap with a mix of finished + active
    const finished: string[] = [];
    for (let i = 0; i < 50; i++) {
      const j = createMediaJob({ surface: 'video', provider: 'stub', prompt: `fin${i}` });
      updateMediaJob(j.id, { status: i % 2 === 0 ? 'succeeded' : 'failed' });
      finished.push(j.id);
    }
    for (let i = 0; i < 180; i++) {
      createMediaJob({ surface: 'video', provider: 'stub', prompt: `act${i}` });
    }
    // Trigger cap by creating more
    for (let i = 0; i < 30; i++) {
      createMediaJob({ surface: 'video', provider: 'stub', prompt: `more${i}` });
    }
    expect(listMediaJobs(500).length).toBeLessThanOrEqual(200);
    // Many finished should have been dropped
    const stillFinished = finished.filter((id) => getMediaJob(id)).length;
    expect(stillFinished).toBeLessThan(finished.length);
  });

  it('updateMediaJob sanitizes filename/filePath/model and rejects unknown ids', () => {
    expect(updateMediaJob('missing', { status: 'running' })).toBeUndefined();
    expect(getMediaJob('x'.repeat(100))).toBeUndefined();

    const job = createMediaJob({
      surface: 'video',
      provider: 'stub',
      prompt: 'p',
      model: undefined,
    });
    updateMediaJob(job.id, {
      filename: 'bad\nname.mp4',
      filePath: 'bad\npath',
      model: 'ok-model',
    });
    const u = getMediaJob(job.id)!;
    expect(u.filename).toBeUndefined();
    expect(u.filePath).toBeUndefined();
    expect(u.model).toBe('ok-model');

    updateMediaJob(job.id, {
      filename: '  clip.mp4  ',
      filePath: '  /tmp/clip.mp4  ',
      model: 'bad\nmodel',
    });
    const u2 = getMediaJob(job.id)!;
    expect(u2.filename).toBe('clip.mp4');
    expect(u2.filePath).toBe('/tmp/clip.mp4');
    expect(u2.model).toBeUndefined();

    updateMediaJob(job.id, { error: 123 as never });
    expect(getMediaJob(job.id)?.error).toBeUndefined();
  });
});
