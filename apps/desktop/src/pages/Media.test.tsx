import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listMediaFiles = vi.fn();
const deleteMediaFile = vi.fn();
const fetchMediaBlob = vi.fn();
const generateMedia = vi.fn();
const listMediaProviders = vi.fn();
const getMediaJob = vi.fn();

const client = {
  listMediaFiles,
  deleteMediaFile,
  fetchMediaBlob,
  generateMedia,
  listMediaProviders,
  getMediaJob,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client,
  }),
}));

// stable blob URL for jsdom
const createObjectURL = vi.fn(() => 'blob:mock-url');
const revokeObjectURL = vi.fn();
vi.stubGlobal('URL', {
  ...URL,
  createObjectURL,
  revokeObjectURL,
});

const { Media } = await import('./Media.js');

const files = [
  {
    filename: 'photo.png',
    kind: 'image' as const,
    size: 1024,
    createdAt: '2026-01-02T00:00:00.000Z',
  },
  {
    filename: 'clip.mp3',
    kind: 'audio' as const,
    size: 2048,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    filename: 'notes.bin',
    kind: 'other' as const,
    size: 10,
    createdAt: '2025-12-01T00:00:00.000Z',
  },
];

describe('Media page', () => {
  beforeEach(() => {
    listMediaFiles.mockReset();
    deleteMediaFile.mockReset();
    fetchMediaBlob.mockReset();
    generateMedia.mockReset();
    listMediaProviders.mockReset().mockResolvedValue({ ok: true, data: [] });
    getMediaJob.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state', async () => {
    listMediaFiles.mockResolvedValue({ ok: true, data: [] });
    render(<Media />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/No media files yet/)).toBeInTheDocument();
    });
    expect(screen.getByTestId('media-generate-form')).toBeInTheDocument();
  });

  it('generates image media and reloads list', async () => {
    const user = userEvent.setup();
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
    render(<Media />);
    await waitFor(() => expect(screen.getByTestId('media-generate-prompt')).toBeInTheDocument());

    await user.type(screen.getByTestId('media-generate-prompt'), 'a blue cat');
    await user.click(screen.getByTestId('media-generate-submit'));

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
      expect(screen.getByTestId('media-generate-status')).toHaveTextContent(/Generated gen\.png/);
    });
  });

  it('polls async video job then reloads', async () => {
    const user = userEvent.setup();
    listMediaFiles
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({
        ok: true,
        data: [
          {
            filename: 'clip.mp4',
            kind: 'video' as const,
            size: 500,
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        ],
      });
    generateMedia.mockResolvedValue({
      ok: true,
      data: { jobId: 'job-abc-123', status: 'queued', surface: 'video' },
    });
    getMediaJob
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 'job-abc-123', status: 'running', surface: 'video', provider: 'x' },
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          id: 'job-abc-123',
          status: 'succeeded',
          filename: 'clip.mp4',
          surface: 'video',
          provider: 'x',
        },
      });
    render(<Media />);
    await waitFor(() => expect(screen.getByTestId('media-surface-video')).toBeInTheDocument());
    await user.click(screen.getByTestId('media-surface-video'));
    await user.type(screen.getByTestId('media-generate-prompt'), 'sunset waves');
    await user.click(screen.getByTestId('media-generate-submit'));

    await waitFor(() => {
      expect(generateMedia).toHaveBeenCalledWith(
        expect.objectContaining({ surface: 'video', prompt: 'sunset waves' }),
      );
    });
    await waitFor(
      () => {
        expect(getMediaJob).toHaveBeenCalledWith('job-abc-123');
        expect(screen.getByText('clip.mp4')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
  });

  it('surfaces generate errors without crashing', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: [] });
    generateMedia.mockResolvedValue({ ok: false, error: `no${'\n'}key${'\0'}` });
    render(<Media />);
    await waitFor(() => expect(screen.getByTestId('media-generate-prompt')).toBeInTheDocument());
    await user.type(screen.getByTestId('media-generate-prompt'), 'hello');
    await user.click(screen.getByTestId('media-generate-submit'));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/no key/);
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('lists files, filters by kind, and previews images', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    fetchMediaBlob.mockResolvedValue(new Blob(['img'], { type: 'image/png' }));
    render(<Media />);

    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());
    expect(screen.getByText('clip.mp3')).toBeInTheDocument();
    // newest first (sortByDateDesc)
    const labels = screen.getAllByRole('button').map((b) => b.textContent).filter((t) => t?.includes('.png') || t?.includes('.mp3'));
    expect(labels[0]).toContain('photo.png');

    await user.click(screen.getByTestId('media-kind-image'));
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.queryByText('clip.mp3')).not.toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();
    expect(localStorage.getItem('neos-media-kind')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: /photo\.png/i }));
    await waitFor(() => {
      expect(fetchMediaBlob).toHaveBeenCalledWith('photo.png');
      expect(screen.getByRole('img', { name: 'photo.png' })).toHaveAttribute('src', 'blob:mock-url');
    });
  });

  it('search and Escape clear search or selection', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    fetchMediaBlob.mockResolvedValue(new Blob(['x']));
    render(<Media />);
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search files…'), 'clip');
    expect(screen.getByText('clip.mp3')).toBeInTheDocument();
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search files…') as HTMLInputElement).value).toBe('');
    });

    await user.click(screen.getByRole('button', { name: /photo\.png/i }));
    await waitFor(() => expect(fetchMediaBlob).toHaveBeenCalled());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.getByText('Select a file to preview')).toBeInTheDocument();
    });
  });

  it('deletes a file after confirm', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    deleteMediaFile.mockResolvedValue({ ok: true });
    render(<Media />);
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());

    // delete buttons are titled Delete file
    const deletes = screen.getAllByTitle('Delete file');
    await user.click(deletes[0]!);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteMediaFile).toHaveBeenCalled();
    });
  });

  it('shows load error', async () => {
    listMediaFiles.mockResolvedValue({ ok: false, error: 'boom' });
    render(<Media />);
    await waitFor(() => {
      expect(screen.getByText('boom')).toBeInTheDocument();
    });
  });

  it('shows scrubbed load error when list media throws', async () => {
    listMediaFiles.mockRejectedValue(new Error(`media${'\n'}down${'\0'}!`));
    render(<Media />);
    await waitFor(() => {
      expect(screen.getByText(/media down!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('offers download link for other-kind files', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    fetchMediaBlob.mockResolvedValue(new Blob(['bin'], { type: 'application/octet-stream' }));
    render(<Media />);
    await waitFor(() => expect(screen.getByText('notes.bin')).toBeInTheDocument());

    await user.click(screen.getByTestId('media-kind-other'));
    expect(screen.getByText('notes.bin')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /notes\.bin/i }));
    await waitFor(() => {
      expect(fetchMediaBlob).toHaveBeenCalledWith('notes.bin');
    });
    const link = await screen.findByRole('link', { name: /Download notes\.bin/i });
    expect(link).toHaveAttribute('download', 'notes.bin');
    expect(link).toHaveAttribute('href', 'blob:mock-url');
  });

  it('previews audio files and cancels delete when confirm is false', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    fetchMediaBlob.mockResolvedValue(new Blob(['audio'], { type: 'audio/mpeg' }));
    render(<Media />);
    await waitFor(() => expect(screen.getByText('clip.mp3')).toBeInTheDocument());

    await user.click(screen.getByTestId('media-kind-audio'));
    expect(screen.getByText('clip.mp3')).toBeInTheDocument();
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clip\.mp3/i }));
    await waitFor(() => {
      expect(fetchMediaBlob).toHaveBeenCalledWith('clip.mp3');
    });
    // audio element should be present
    expect(document.querySelector('audio')).toBeTruthy();

    deleteMediaFile.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await user.click(screen.getAllByTitle('Delete file')[0]!);
    expect(deleteMediaFile).not.toHaveBeenCalled();
  });

  it('filters other kind and shows empty filter message', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    render(<Media />);
    await waitFor(() => expect(screen.getByText('notes.bin')).toBeInTheDocument());

    await user.click(screen.getByTestId('media-kind-other'));
    expect(screen.getByText('notes.bin')).toBeInTheDocument();
    expect(screen.queryByText('photo.png')).not.toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();

    await user.type(screen.getByPlaceholderText('Search files…'), 'nope');
    expect(screen.queryByText('notes.bin')).not.toBeInTheDocument();
  });

  it('scrubs control chars from filename/kind and search haystack', async () => {
    const user = userEvent.setup();
    listMediaFiles.mockResolvedValue({
      ok: true,
      data: [
        {
          filename: `photo${'\0'}.png`,
          kind: `image${'\n'}x`,
          size: 512,
          createdAt: '2026-01-03T00:00:00.000Z',
        },
        {
          filename: 'clean.txt',
          kind: 'other' as const,
          size: 8,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    render(<Media />);
    await waitFor(() => {
      // null-byte stripped from list label
      expect(screen.getByText('photo.png')).toBeInTheDocument();
    });
    // kind newlines collapsed
    expect(screen.getByText(/image x/)).toBeInTheDocument();
    expect(screen.getByText('clean.txt')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');

    // Search matches scrubbed haystack (filename without null)
    await user.type(screen.getByPlaceholderText('Search files…'), 'photo');
    await waitFor(() => {
      expect(screen.getByText('photo.png')).toBeInTheDocument();
      expect(screen.queryByText('clean.txt')).not.toBeInTheDocument();
    });
  });

  it('scrubs control chars from load error banner', async () => {
    listMediaFiles.mockResolvedValue({ ok: false, error: `load${'\n'}failed${'\0'}` });
    render(<Media />);
    await waitFor(() => {
      expect(screen.getByText(/load failed/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('rejects delete when filename has control chars without calling API', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    listMediaFiles.mockResolvedValue({
      ok: true,
      data: [
        {
          filename: `photo${'\0'}.png`,
          kind: 'image' as const,
          size: 10,
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    render(<Media />);
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('Delete file')[0]!);
    expect(alertSpy).toHaveBeenCalledWith('Filename contains invalid control characters');
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(deleteMediaFile).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('rejects preview when selected filename has control chars', async () => {
    listMediaFiles.mockResolvedValue({
      ok: true,
      data: [
        {
          filename: `photo${'\0'}.png`,
          kind: 'image' as const,
          size: 10,
          createdAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    fetchMediaBlob.mockClear();
    render(<Media />);
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());
    fireEvent.click(screen.getByText('photo.png'));
    await waitFor(() => {
      expect(screen.getByText('Filename contains invalid control characters')).toBeInTheDocument();
    });
    expect(fetchMediaBlob).not.toHaveBeenCalled();
  });

  it('surfaces scrubbed delete throw and keeps the file', async () => {
    listMediaFiles.mockResolvedValue({ ok: true, data: files });
    deleteMediaFile.mockRejectedValue(new Error(`del${'\n'}net${'\0'}!`));
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Media />);
    await waitFor(() => expect(screen.getByText('photo.png')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle('Delete file')[0]!);
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteMediaFile).toHaveBeenCalled();
      expect(screen.getByText(/del net!/)).toBeInTheDocument();
    });
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });
});
