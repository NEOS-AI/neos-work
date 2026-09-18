import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyzeVideo = vi.fn();
const openVideoFile = vi.fn();

vi.mock('@video/lib/tauri/commands', () => ({
  analyzeVideo: (...args: unknown[]) => analyzeVideo(...args),
  openVideoFile: () => openVideoFile(),
}));

const { LocaleProvider } = await import('../lib/i18n.js');
const { default: ProbePage } = await import('./ProbePage.js');

describe('ProbePage', () => {
  beforeEach(() => {
    analyzeVideo.mockReset().mockResolvedValue({
      format: {
        filename: '/tmp/clip.mp4',
        format_name: 'mov,mp4,m4a,3gp,3g2,mj2',
        format_long_name: 'QuickTime / MOV',
        duration: 12.5,
        bit_rate: 1_200_000,
        size: 2_000_000,
      },
      streams: [
        {
          index: 0,
          codec_type: 'video',
          codec_name: 'h264',
          codec_long_name: 'H.264',
          width: 1920,
          height: 1080,
          rotation: null,
          r_frame_rate: '30/1',
          avg_frame_rate: '30/1',
          pix_fmt: 'yuv420p',
          sample_rate: null,
          channels: null,
          channel_layout: null,
          bit_rate: '1000000',
          duration: '12.5',
          language: 'eng',
          title: null,
        },
      ],
    });
    openVideoFile.mockReset();
  });

  it('analyzes a path and shows stream metadata', async () => {
    const user = userEvent.setup();
    render(
      <LocaleProvider>
        <MemoryRouter>
          <ProbePage />
        </MemoryRouter>
      </LocaleProvider>,
    );
    await user.type(screen.getByPlaceholderText('/path/to/video.mp4'), '/tmp/clip.mp4');
    await user.click(screen.getByRole('button', { name: '분석' }));
    await waitFor(() => {
      expect(analyzeVideo).toHaveBeenCalledWith('/tmp/clip.mp4');
    });
    expect(screen.getByText('QuickTime / MOV')).toBeInTheDocument();
    expect(screen.getByText(/h264/)).toBeInTheDocument();
    expect(screen.getByText('1920×1080')).toBeInTheDocument();
  });
});
