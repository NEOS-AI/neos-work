import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listPlugins = vi.fn();
const fetchMarketplaceCatalog = vi.fn();
const installMarketplaceEntry = vi.fn();
const getMarketplaceCatalogUrl = vi.fn();
const setMarketplaceCatalogUrl = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));

vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listPlugins = listPlugins;
    fetchMarketplaceCatalog = fetchMarketplaceCatalog;
    installMarketplaceEntry = installMarketplaceEntry;
    getMarketplaceCatalogUrl = getMarketplaceCatalogUrl;
    setMarketplaceCatalogUrl = setMarketplaceCatalogUrl;
  },
}));

const { Plugins } = await import('./Plugins.js');

describe('Web Plugins page', () => {
  beforeEach(() => {
    listPlugins.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'hello-plugin', name: 'Hello', version: '1.0.0', channel: 'community' }],
    });
    fetchMarketplaceCatalog.mockReset().mockResolvedValue({
      ok: true,
      data: {
        entries: [{ id: 'cat-1', name: 'Catalog One', version: '0.1.0', trust: 'community', packageUrl: 'https://x' }],
      },
    });
    installMarketplaceEntry.mockReset().mockResolvedValue({ ok: true, data: { id: 'cat-1' } });
    getMarketplaceCatalogUrl.mockReset().mockResolvedValue({ ok: true, data: { url: null } });
    setMarketplaceCatalogUrl.mockReset().mockResolvedValue({ ok: true, data: { url: null } });
  });

  it('lists installed plugins and installs from catalog', async () => {
    render(
      <MemoryRouter initialEntries={['/plugins']}>
        <Routes>
          <Route path="/plugins" element={<Plugins />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('plugin-hello-plugin')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('plugin-install-cat-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('plugin-install-cat-1'));
    await waitFor(() => expect(installMarketplaceEntry).toHaveBeenCalledWith({ id: 'cat-1' }));
  });
});
