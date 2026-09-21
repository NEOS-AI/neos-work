import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  analyzeVideo,
  convertTsToMp4,
  openMpegTsFile,
  saveFile,
  checkEnvironment,
  transcodeVideo,
  muxVideo,
  openVideoFile,
  openAudioFile,
  openSubtitleFile,
  cancelJob,
  revealPath,
} = vi.hoisted(() => ({
  analyzeVideo: vi.fn(),
  convertTsToMp4: vi.fn(),
  openMpegTsFile: vi.fn(),
  saveFile: vi.fn(),
  checkEnvironment: vi.fn(),
  transcodeVideo: vi.fn(),
  muxVideo: vi.fn(),
  openVideoFile: vi.fn(),
  openAudioFile: vi.fn(),
  openSubtitleFile: vi.fn(),
  cancelJob: vi.fn(),
  revealPath: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@video/hooks/useFfmpegJob', () => ({
  useFfmpegJob: () => ({
    isRunning: false,
    percent: 0,
    message: '',
    runJob: async (work: (jobId: string) => Promise<void>) => {
      await work('test-job');
      return { ok: true };
    },
    cancel: vi.fn(),
  }),
}));

vi.mock('@video/lib/tauri/commands', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/tauri/commands.js')>();
  return {
    ...actual,
    analyzeVideo: (...args: unknown[]) => analyzeVideo(...args),
    convertTsToMp4: (...args: unknown[]) => convertTsToMp4(...args),
    openMpegTsFile: () => openMpegTsFile(),
    saveFile: (...args: unknown[]) => saveFile(...args),
    checkEnvironment: () => checkEnvironment(),
    transcodeVideo: (...args: unknown[]) => transcodeVideo(...args),
    muxVideo: (...args: unknown[]) => muxVideo(...args),
    openVideoFile: () => openVideoFile(),
    openAudioFile: () => openAudioFile(),
    openSubtitleFile: () => openSubtitleFile(),
    cancelJob: (...args: unknown[]) => cancelJob(...args),
    revealPath: (...args: unknown[]) => revealPath(...args),
  };
});

const { LocaleProvider } = await import('../lib/i18n.js');
const { default: TranscodePage } = await import('./TranscodePage.js');
const { VIDEO_EXTS, MPEG_TS_EXTS } = await import('../lib/tauri/commands.js');

function stream(index: number, codec_type: string, codec_name: string) {
  return {
    index,
    codec_type,
    codec_name,
    codec_long_name: codec_name,
    width: codec_type === 'video' ? 1920 : null,
    height: codec_type === 'video' ? 1080 : null,
    rotation: null,
    r_frame_rate: codec_type === 'video' ? '30/1' : null,
    avg_frame_rate: codec_type === 'video' ? '30/1' : null,
    pix_fmt: codec_type === 'video' ? 'yuv420p' : null,
    sample_rate: codec_type === 'audio' ? '48000' : null,
    channels: codec_type === 'audio' ? 2 : null,
    channel_layout: codec_type === 'audio' ? 'stereo' : null,
    bit_rate: '1000000',
    duration: '12.5',
    language: null,
    title: null,
  };
}

function videoInfo(formatName: string, streams: ReturnType<typeof stream>[], filename = '/tmp/clip.ts') {
  return {
    format: {
      filename,
      format_name: formatName,
      format_long_name: formatName,
      duration: 12.5,
      bit_rate: 1_200_000,
      size: 2_000_000,
    },
    streams,
  };
}

function renderPage() {
  return render(
    <LocaleProvider>
      <TranscodePage />
    </LocaleProvider>,
  );
}

describe('TranscodePage TS → MP4', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    analyzeVideo.mockReset().mockResolvedValue(
      videoInfo('mpegts', [stream(0, 'video', 'h264'), stream(1, 'audio', 'mp2')]),
    );
    convertTsToMp4.mockReset().mockResolvedValue(undefined);
    openMpegTsFile.mockReset().mockResolvedValue(null);
    saveFile.mockReset();
    checkEnvironment.mockReset().mockResolvedValue({ hw_encoders: [] });
    transcodeVideo.mockReset();
    muxVideo.mockReset();
    openVideoFile.mockReset();
    openAudioFile.mockReset();
    openSubtitleFile.mockReset();
    cancelJob.mockReset();
    revealPath.mockReset();
  });

  it('shows the TS → MP4 tab in Korean', async () => {
    renderPage();
    await waitFor(() => {
      expect(checkEnvironment).toHaveBeenCalled();
    });
    expect(screen.getByRole('button', { name: 'TS → MP4' })).toBeInTheDocument();
  });

  it('shows a substituted mix plan after mpegts probe', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'TS → MP4' }));
    fireEvent.change(screen.getAllByPlaceholderText('/path/to/file')[0], {
      target: { value: '/tmp/clip.ts' },
    });
    await waitFor(() => {
      expect(analyzeVideo).toHaveBeenCalledWith('/tmp/clip.ts');
    });
    expect(screen.getByText('비디오 복사, 오디오 AAC로 인코딩')).toBeInTheDocument();
    expect(screen.queryByText(/\{vcodec\}/)).not.toBeInTheDocument();
  });

  it('does not claim stream copy when force_copy codecs are incompatible', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'TS → MP4' }));
    fireEvent.change(screen.getAllByPlaceholderText('/path/to/file')[0], {
      target: { value: '/tmp/clip.ts' },
    });
    await waitFor(() => {
      expect(screen.getByText('비디오 복사, 오디오 AAC로 인코딩')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByDisplayValue('자동 (가능한 트랙 복사)'), {
      target: { value: 'force_copy' },
    });
    await waitFor(() => {
      expect(
        screen.getByText('스트림 복사 불가 (mp2). 자동 또는 다시 인코딩을 쓰세요'),
      ).toBeInTheDocument();
    });
    expect(screen.getByText('이 코덱은 MP4에 복사할 수 없습니다: mp2')).toBeInTheDocument();
    expect(screen.queryByText('비디오·오디오 스트림 복사')).not.toBeInTheDocument();
    expect(screen.queryByText('{codec}')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MP4로 변환' })).toBeDisabled();
  });

  it('keeps the copy plan when force_copy codecs are compatible', async () => {
    analyzeVideo.mockResolvedValue(
      videoInfo('mpegts', [stream(0, 'video', 'h264'), stream(1, 'audio', 'aac')]),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'TS → MP4' }));
    fireEvent.change(screen.getAllByPlaceholderText('/path/to/file')[0], {
      target: { value: '/tmp/clip.ts' },
    });
    await waitFor(() => {
      expect(screen.getByText('비디오·오디오 스트림 복사')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByDisplayValue('자동 (가능한 트랙 복사)'), {
      target: { value: 'force_copy' },
    });
    expect(screen.getByText('비디오·오디오 스트림 복사')).toBeInTheDocument();
    expect(screen.queryByText(/스트림 복사 불가/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'MP4로 변환' })).not.toBeDisabled();
  });

  it('disables Run and substitutes format= for non-mpegts', async () => {
    analyzeVideo.mockResolvedValue(
      videoInfo('mov,mp4,m4a,3gp,3g2,mj2', [stream(0, 'video', 'h264'), stream(1, 'audio', 'aac')]),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'TS → MP4' }));
    fireEvent.change(screen.getAllByPlaceholderText('/path/to/file')[0], {
      target: { value: '/tmp/clip.ts' },
    });
    await waitFor(() => {
      expect(
        screen.getByText('이 파일은 MPEG-TS가 아닙니다 (format=mov,mp4,m4a,3gp,3g2,mj2)'),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'MP4로 변환' })).toBeDisabled();
    expect(screen.queryByText('{format}')).not.toBeInTheDocument();
  });

  it('sends auto mode without a video_codec key', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'TS → MP4' }));
    fireEvent.change(screen.getAllByPlaceholderText('/path/to/file')[0], {
      target: { value: '/tmp/clip.ts' },
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'MP4로 변환' })).not.toBeDisabled();
    });
    await user.click(screen.getByRole('button', { name: 'MP4로 변환' }));
    await waitFor(() => {
      expect(convertTsToMp4).toHaveBeenCalled();
    });
    const payload = convertTsToMp4.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.mode).toBe('auto');
    expect(payload).not.toHaveProperty('video_codec');
    expect(payload).not.toHaveProperty('audio_codec');
    expect(payload).not.toHaveProperty('crf');
    expect(payload.input_path).toBe('/tmp/clip.ts');
    expect(payload.output_path).toBe('/tmp/clip.mp4');
    expect(payload.video_stream_index).toBe(0);
    expect(payload.audio_stream_index).toBe(1);
    expect(payload.job_id).toBe('test-job');
  });

  it('does not seed a remembered .mp4 into the TS tab', async () => {
    sessionStorage.setItem('neos-video:selected-file', '/tmp/clip.mp4');
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('/path/to/file')[0]).toHaveValue('/tmp/clip.mp4');
    });
    await user.click(screen.getByRole('button', { name: 'TS → MP4' }));
    await waitFor(() => {
      expect(screen.getByText(/MPEG 전송 스트림을 MP4로/)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.getAllByPlaceholderText('/path/to/file')[0]).toHaveValue('');
    });
  });

  it('shows the TS → MP4 tab key in English', async () => {
    localStorage.setItem('neos-video:locale', 'en');
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Transcode' })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'TS → MP4' })).toBeInTheDocument();
  });

  it('keeps ts off VIDEO_EXTS and lists MPEG_TS_EXTS', () => {
    expect(VIDEO_EXTS).not.toContain('ts');
    expect(VIDEO_EXTS).not.toContain('m2ts');
    expect(VIDEO_EXTS).not.toContain('mts');
    expect(MPEG_TS_EXTS).toEqual(['ts', 'm2ts', 'mts']);
  });
});
