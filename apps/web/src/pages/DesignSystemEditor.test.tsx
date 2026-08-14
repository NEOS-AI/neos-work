import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listDesignSystems = vi.fn();
const getDesignSystemContent = vi.fn();
const saveDesignSystemContent = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listDesignSystems = listDesignSystems;
    getDesignSystemContent = getDesignSystemContent;
    saveDesignSystemContent = saveDesignSystemContent;
  },
}));

const { DesignSystemEditor } = await import('./DesignSystemEditor.js');

describe('Web Design System editor', () => {
  beforeEach(() => {
    listDesignSystems.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'ds1', name: 'Mine' }],
    });
    getDesignSystemContent.mockReset().mockResolvedValue({
      ok: true,
      data: { content: '# Design' },
    });
    saveDesignSystemContent.mockReset().mockResolvedValue({ ok: true });
  });

  it('loads and saves DESIGN.md', async () => {
    render(
      <MemoryRouter initialEntries={['/design-systems/ds1']}>
        <Routes>
          <Route path="/design-systems/:id" element={<DesignSystemEditor />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('ds-editor-content')).toHaveValue('# Design'));
    fireEvent.change(screen.getByTestId('ds-editor-content'), { target: { value: '# Next' } });
    fireEvent.click(screen.getByTestId('ds-editor-save'));
    await waitFor(() => expect(saveDesignSystemContent).toHaveBeenCalledWith('ds1', '# Next'));
  });
});
