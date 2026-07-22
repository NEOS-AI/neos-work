import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listMediaFiles = vi.fn();
const deleteMediaFile = vi.fn();
const fetchMediaBlob = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listMediaFiles, deleteMediaFile, fetchMediaBlob },
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

    await user.click(screen.getByRole('button', { name: 'image' }));
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
});
