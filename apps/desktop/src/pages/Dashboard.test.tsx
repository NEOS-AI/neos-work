import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const listSessions = vi.fn();
const listWorkflows = vi.fn();
const listSkills = vi.fn();
const listPlugins = vi.fn();
const listRoutines = vi.fn();
const listDesignSystems = vi.fn();
const listDeployments = vi.fn();
const listMediaFiles = vi.fn();
const health = vi.fn();

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    mode: 'host',
    serverUrl: 'http://127.0.0.1:57286',
    client: {
      listSessions,
      listWorkflows,
      listSkills,
      listPlugins,
      listRoutines,
      listDesignSystems,
      listDeployments,
      listMediaFiles,
      health,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const { Dashboard } = await import('./Dashboard.js');

function renderPage() {
  return render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
}

describe('Dashboard page', () => {
  beforeEach(() => {
    listSessions.mockReset().mockResolvedValue({ ok: true, data: [{ id: 's1' }] });
    listWorkflows.mockReset().mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'w1',
          name: 'WF One',
          domain: 'general',
          nodes: [],
          edges: [],
          createdAt: '2026-01-02T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    });
    listSkills.mockReset().mockResolvedValue({ ok: true, data: [{ id: 'sk' }, { id: 'sk2' }] });
    listPlugins.mockReset().mockResolvedValue({ ok: true, data: [] });
    listRoutines.mockReset().mockResolvedValue({ ok: true, data: [] });
    listDesignSystems.mockReset().mockResolvedValue({ ok: true, data: [{ id: 'ds' }] });
    listDeployments.mockReset().mockResolvedValue({ ok: true, data: [] });
    listMediaFiles.mockReset().mockResolvedValue({ ok: true, data: [{ id: 'm1' }] });
    health.mockReset().mockResolvedValue({ status: 'ok', version: '0.3.55', uptime: 3661 });
  });

  it('loads stats and shows engine/host cards', async () => {
    renderPage();
    expect(screen.getByText('nav.dashboard')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(/v0\.3\.55/)).toBeInTheDocument();
    });

    // Engine mode
    expect(screen.getByText('Local')).toBeInTheDocument();
    await waitFor(() => {
      expect(listSessions).toHaveBeenCalled();
      expect(listWorkflows).toHaveBeenCalled();
      expect(health).toHaveBeenCalled();
    });
    // uptime formatted from 3661 sec → "1h up" (joined into Engine detail)
    expect(screen.getByText(/1h up/)).toBeInTheDocument();
    // recent workflow name
    expect(screen.getByText('WF One')).toBeInTheDocument();
  });

  it('tolerates API failures without crashing', async () => {
    listSessions.mockRejectedValue(new Error('down'));
    listWorkflows.mockRejectedValue(new Error('down'));
    listSkills.mockRejectedValue(new Error('down'));
    listPlugins.mockRejectedValue(new Error('down'));
    listRoutines.mockRejectedValue(new Error('down'));
    listDesignSystems.mockRejectedValue(new Error('down'));
    listDeployments.mockRejectedValue(new Error('down'));
    listMediaFiles.mockRejectedValue(new Error('down'));
    health.mockRejectedValue(new Error('down'));

    renderPage();
    await waitFor(() => {
      expect(health).toHaveBeenCalled();
    });
    expect(screen.getByText('nav.dashboard')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
  });
});
