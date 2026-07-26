import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const listDesignSystems = vi.fn();
const createDesignSystem = vi.fn();
const deleteDesignSystem = vi.fn();
const navigate = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: { listDesignSystems, createDesignSystem, deleteDesignSystem },
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const { DesignSystems } = await import('./DesignSystems.js');

const systems = [
  {
    id: 'ds-b',
    name: 'Beta Brand',
    description: 'B',
    updatedAt: '2026-01-01T00:00:00.000Z',
    hasTokens: true,
    hasComponents: false,
  },
  {
    id: 'ds-a',
    name: 'Alpha Brand',
    description: 'A',
    updatedAt: '2026-02-01T00:00:00.000Z',
    hasTokens: false,
    hasComponents: true,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <DesignSystems />
    </MemoryRouter>,
  );
}

describe('DesignSystems page', () => {
  beforeEach(() => {
    listDesignSystems.mockReset();
    createDesignSystem.mockReset();
    deleteDesignSystem.mockReset();
    navigate.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('shows empty state', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No design systems found.')).toBeInTheDocument();
    });
  });

  it('lists sorted systems and navigates to edit', async () => {
    const user = userEvent.setup();
    listDesignSystems.mockResolvedValue({ ok: true, data: systems });
    renderPage();

    await waitFor(() => expect(screen.getByText('Alpha Brand')).toBeInTheDocument());
    const names = screen.getAllByText(/Brand$/).map((el) => el.textContent);
    expect(names[0]).toBe('Alpha Brand');
    expect(screen.getByText('tokens')).toBeInTheDocument();
    expect(screen.getByText('components')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Edit' })[0]!);
    expect(navigate).toHaveBeenCalledWith('/design-systems/ds-a');
  });

  it('creates a design system from the form', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    createDesignSystem.mockResolvedValue({
      ok: true,
      data: {
        id: 'ds-new',
        name: 'NewDS',
        description: 'desc',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('No design systems found.')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New Design System' }));
    fireEvent.change(screen.getByPlaceholderText('my-design-system'), { target: { value: 'NewDS' } });
    fireEvent.change(screen.getByPlaceholderText('Brand guidelines and component styles'), {
      target: { value: 'desc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      expect(createDesignSystem).toHaveBeenCalledWith('NewDS', 'desc');
    });
  });

  it('shows create error', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    createDesignSystem.mockResolvedValue({ ok: false, error: 'invalid name' });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Design System' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New Design System' }));
    fireEvent.change(screen.getByPlaceholderText('my-design-system'), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(screen.getByText('invalid name')).toBeInTheDocument();
    });
  });

  it('rejects control-char name and description without calling API', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Design System' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New Design System' }));
    fireEvent.change(screen.getByPlaceholderText('my-design-system'), {
      target: { value: `bad${'\0'}name` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Name contains invalid control characters')).toBeInTheDocument();
    expect(createDesignSystem).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('my-design-system'), {
      target: { value: 'ValidDS' },
    });
    fireEvent.change(screen.getByPlaceholderText('Brand guidelines and component styles'), {
      target: { value: `desc${'\0'}line` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(screen.getByText('Description contains invalid control characters')).toBeInTheDocument();
    expect(createDesignSystem).not.toHaveBeenCalled();
  });

  it('deletes after confirm', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: systems });
    deleteDesignSystem.mockResolvedValue({ ok: true });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Brand')).toBeInTheDocument());

    const deletes = screen.getAllByRole('button', { name: 'Delete' });
    // Alpha is first in sort order
    fireEvent.click(deletes[0]!);

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => {
      expect(deleteDesignSystem).toHaveBeenCalledWith('ds-a');
    });
  });

  it('shows scrubbed page error when delete fails', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: systems });
    deleteDesignSystem.mockResolvedValue({
      ok: false,
      error: `in${'\n'}use${'\0'}!`,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Brand')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    await waitFor(() => {
      expect(deleteDesignSystem).toHaveBeenCalledWith('ds-a');
      expect(screen.getByText('in use!')).toBeInTheDocument();
    });
    expect(screen.getByText('Alpha Brand')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('search filter and Escape cancel create / clear search', async () => {
    const user = userEvent.setup();
    listDesignSystems.mockResolvedValue({ ok: true, data: systems });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Brand')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search design systems…'), 'Beta');
    expect(screen.getByText('Beta Brand')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Brand')).not.toBeInTheDocument();
    expect(screen.getByText('1/2')).toBeInTheDocument();

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search design systems…') as HTMLInputElement).value).toBe('');
    });

    fireEvent.click(screen.getByRole('button', { name: '+ New Design System' }));
    expect(screen.getByRole('heading', { name: 'New Design System' })).toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'New Design System' })).not.toBeInTheDocument();
    });
  });

  it('cancels delete when confirm is false and shows no-match empty state', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: systems });
    deleteDesignSystem.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderPage();
    await waitFor(() => expect(screen.getByText('Alpha Brand')).toBeInTheDocument());

    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]!);
    expect(deleteDesignSystem).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('Search design systems…'), {
      target: { value: 'zzzz-none' },
    });
    await waitFor(() => {
      expect(screen.queryByText('Alpha Brand')).not.toBeInTheDocument();
      expect(screen.getByText('0/2')).toBeInTheDocument();
      expect(screen.getByText(/No design systems match your search/)).toBeInTheDocument();
    });
  });

  it('scrubs control-char design system name/description in list', async () => {
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds1',
          name: `Brand${'\0'}X`,
          description: `desc${'\n'}line`,
          path: '/x',
          hasManifest: false,
          hasTokens: true,
          hasComponents: false,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    });
    render(
      <MemoryRouter>
        <DesignSystems />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('BrandX')).toBeInTheDocument());
    expect(screen.getByText(/desc line/)).toBeInTheDocument();
  });

  it('scrubs control chars from create error banner', async () => {
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    createDesignSystem.mockResolvedValue({ ok: false, error: `invalid${'\n'}name${'\0'}` });
    renderPage();
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New Design System' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '+ New Design System' }));
    fireEvent.change(screen.getByPlaceholderText('my-design-system'), { target: { value: 'ok-name' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => {
      expect(screen.getByText(/invalid name/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
  });

  it('scrubs control-char name in delete confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds-del',
          name: 'Brand' + String.fromCharCode(0) + 'X' + String.fromCharCode(10) + 'Y',
          description: 'd',
          path: '/x',
          hasManifest: false,
          hasTokens: true,
          hasComponents: false,
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/BrandX/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(confirmSpy).toHaveBeenCalled();
    const msg = String(confirmSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('BrandX Y');
    expect(msg).not.toContain('\0');
    expect(deleteDesignSystem).not.toHaveBeenCalled();
  });

});
