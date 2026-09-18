import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const checkEnvironment = vi.fn();
const openVideoFile = vi.fn();

vi.mock('@video/lib/tauri/commands', () => ({
  checkEnvironment: () => checkEnvironment(),
  openVideoFile: () => openVideoFile(),
}));

const { LocaleProvider } = await import('../lib/i18n.js');
const { default: HomePage } = await import('./HomePage.js');

describe('Video HomePage', () => {
  beforeEach(() => {
    checkEnvironment.mockReset().mockResolvedValue({
      os: 'macos',
      arch: 'aarch64',
      target_triple: 'aarch64-apple-darwin',
      ffmpeg_ok: true,
      ffprobe_ok: true,
      ffmpeg_version: '7.0',
      ffprobe_version: '7.0',
      ffmpeg_source: 'path:ffmpeg',
      ffprobe_source: 'path:ffprobe',
      ffmpeg_sidecar: 'ffmpeg-aarch64-apple-darwin',
      ffprobe_sidecar: 'ffprobe-aarch64-apple-darwin',
      ytdlp_ok: false,
      ytdlp_version: null,
      ytdlp_source: null,
      ytdlp_sidecar: 'yt-dlp-aarch64-apple-darwin',
      hw_encoders: ['h264_videotoolbox'],
      hw_accels: ['videotoolbox'],
    });
    openVideoFile.mockReset();
  });

  it('shows environment and tool cards', async () => {
    render(
      <LocaleProvider>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </LocaleProvider>,
    );
    await waitFor(() => {
      expect(checkEnvironment).toHaveBeenCalled();
    });
    expect(screen.getByText('영상 스튜디오')).toBeInTheDocument();
    expect(screen.getByText(/macos\/aarch64/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /분석/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/video/probe'),
    );
  });
});
