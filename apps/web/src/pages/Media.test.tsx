import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listMediaFiles = vi.fn();
const listMediaProviders = vi.fn();
const generateMedia = vi.fn();
const getMediaJob = vi.fn();
const fetchMediaBlob = vi.fn();
const mediaFileUrl = vi.fn((name: string) => `http://engine.test/api/media/file/${name}`);

const loadConnection = vi.fn(() => ({
  serverUrl: 'http://127.0.0.1:3000',
  token: 'test-token',
}));
const clearConnection = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => loadConnection(),
  clearConnection: (...args: unknown[]) => clearConnection(...args),
}));

vi.mock('../lib/api.js', () => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return {
    ApiError,
    WebApiClient: class {
      listMediaFiles = listMediaFiles;
      listMediaProviders = listMediaProviders;
      generateMedia = generateMedia;
      getMediaJob = getMediaJob;
      fetchMediaBlob = fetchMediaBlob;
      mediaFileUrl = mediaFileUrl;
    },
  };
});

const { Media } = await import('./Media.js');

const sampleFiles = [
  {
    filename: 'photo.png',
    kind: 'image' as const,
    size: 1024,
    mimeType: 'image/png',
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    filename: 'clip.mp3',
    kind: 'audio' as const,
    size: 2048,
    mimeType: 'audio/mpeg',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

describe('Web Media page', () => {
  beforeEach(() => {
    listMediaFiles.mockReset();
    listMediaProviders.mockReset().mockResolvedValue({ ok: true, data: [] });
    generateMedia.mockReset();
    getMediaJob.mockReset();
    fetchMediaBlob.mockReset();
    mediaFileUrl.mockClear();
    clearConnection.mockClear();
    loadConnection.mockReturnValue({
      serverUrl: 'http://127.0.0.1:3000',
      token: 'test-token',
    });
  });

  function renderMedia(initial = '/media') {
    return render(
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/media" element={<Media />} />
          <Route path="/" element={<div data-testid="connect-page">Connect</div>} />
          <Route path="/projects" element={<div>Projects</div>} />
          <Route path="/settings" element={<div>Settings</div>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('redirects to connect when no token', async () => {
    loadConnection.mockReturnValue({ serverUrl: 'http://127.0.0.1:3000', token: '' });
    listMediaFiles.mockResolvedValue({ ok: true, data: [] });
    renderMedia();
    await waitFor(() => {
      expect(screen.getByTestId('connect-page')).toBeInTheDocument();
    });
  });

  it('shows empty state and generate form', async () => {
    listMediaFiles.mockResolvedValue({ ok: true, data: [] });
    renderMedia();
    await waitFor(() => {
      expect(screen.getByText(/No media files yet/i)).toBeInTheDocument();
    });
    expect(screen.getByTestId('media-generate-form')).toBeInTheDocument();
    expect(screen.getByTestId('media-nav-projects')).toBeInTheDocument();
    expect(screen.getByTestId('media-nav-settings')).toBeInTheDocument();
  });

  it('lists media files', async () => {
    listMediaFiles.mockResolvedValue({ ok: true, data: sampleFiles });
    renderMedia();
    await waitFor(() => {
      expect(screen.getByText('photo.png')).toBeInTheDocument();
      expect(screen.getByText('clip.mp3')).toBeInTheDocument();
    });
    expect(listMediaFiles).toHaveBeenCalledWith(200);
  });

  it('generates image media and reloads list', async () => {
    listMediaFiles
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            filename: 'gen.png',
            kind: 'image' as const,
            size: 99,
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      });
    generateMedia.mockResolvedValue({
      ok: true,
      data: { surface: 'image', filename: 'gen.png' },
    });
    renderMedia();
    await waitFor(() => expect(screen.getByTestId('media-generate-prompt')).toBeInTheDocument());

    fireEvent.change(screen.getByTestId('media-generate-prompt'), {
      target: { value: 'a blue cat' },
    });
    fireEvent.click(screen.getByTestId('media-generate-submit'));

    await waitFor(() => {
      expect(generateMedia).toHaveBeenCalledWith({
        surface: 'image',
        prompt: 'a blue cat',
        text: undefined,
        provider: undefined,
      });
    });
    await waitFor(() => {
      expect(screen.getByText('gen.png')).toBeInTheDocument();
      expect(screen.getByTestId('media-generate-status').textContent).toMatch(/Generated gen\.png/);
    });
  });

  it('scrubs control chars in list errors', async () => {
    listMediaFiles.mockResolvedValue({
      ok: false,
      error: `load${'\n'}failed${'\0'}!`,
    });
    renderMedia();
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).not.toMatch(/[\0\n]/);
      expect(alert.textContent).toMatch(/load failed/i);
    });
  });

  it('scrubs generate errors', async () => {
    listMediaFiles.mockResolvedValue({ ok: true, data: [] });
    generateMedia.mockResolvedValue({ ok: false, error: `no${'\n'}key${'\0'}` });
    renderMedia();
    await waitFor(() => expect(screen.getByTestId('media-generate-prompt')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('media-generate-prompt'), {
      target: { value: 'hello' },
    });
    fireEvent.click(screen.getByTestId('media-generate-submit'));
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).not.toMatch(/[\0\n]/);
      expect(alert.textContent).toMatch(/no key/i);
    });
  });

  it('switches surface to audio and sends text', async () => {
    listMediaFiles.mockResolvedValue({ ok: true, data: [] });
    generateMedia.mockResolvedValue({
      ok: true,
      data: { surface: 'audio', filename: 'voice.mp3' },
    });
    renderMedia();
    await waitFor(() => expect(screen.getByTestId('media-surface-audio')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('media-surface-audio'));
    fireEvent.change(screen.getByTestId('media-generate-prompt'), {
      target: { value: 'speak this' },
    });
    fireEvent.click(screen.getByTestId('media-generate-submit'));
    await waitFor(() => {
      expect(generateMedia).toHaveBeenCalledWith({
        surface: 'audio',
        prompt: undefined,
        text: 'speak this',
        provider: undefined,
      });
    });
  });
});
