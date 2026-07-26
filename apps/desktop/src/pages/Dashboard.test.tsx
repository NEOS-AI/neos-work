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

let engineMode: 'host' | 'client' | null = 'host';

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({
    mode: engineMode,
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
    engineMode = 'host';
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

  it('scrubs control chars from engine version and recent names', async () => {
    health.mockResolvedValue({
      status: 'ok',
      version: `0.3.99${'\n'}evil`,
      uptime: 10,
    });
    listWorkflows.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'w1',
          name: `Bad${'\0'}Name`,
          domain: `coding${'\n'}x`,
          nodes: [],
          edges: [],
          updatedAt: '2020-01-02T00:00:00.000Z',
        },
      ],
    });
    listRoutines.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'r1',
          name: `Rtn${'\0'}X`,
          schedule: `0 9 * * *${'\n'}extra`,
          enabled: true,
          workflowId: 'w1',
          updatedAt: '2020-01-03T00:00:00.000Z',
        },
      ],
    });
    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd1',
          projectName: `proj${'\0'}ect`,
          provider: 'vercel',
          status: 'success',
          workflowId: 'w1',
          createdAt: '2020-01-04T00:00:00.000Z',
        },
      ],
    });
    renderPage();
    await waitFor(() => {
      // newlines collapsed in version display
      expect(screen.getByText(/v0\.3\.99 evil/)).toBeInTheDocument();
    });
    // null-byte stripped from name; domain collapsed
    expect(screen.getByText('BadName')).toBeInTheDocument();
    expect(screen.getByText(/coding x/)).toBeInTheDocument();
    // routine name/schedule scrubbed
    expect(screen.getByText('RtnX')).toBeInTheDocument();
    expect(screen.getByText(/0 9 \* \* \* extra/)).toBeInTheDocument();
    // deployment projectName scrubbed
    expect(screen.getByText('project')).toBeInTheDocument();
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

  it('renders resource counts and recent routines/deployments', async () => {
    listPlugins.mockResolvedValue({ ok: true, data: [{ id: 'p1' }, { id: 'p2' }] });
    listRoutines.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'r1',
          name: 'Nightly Report',
          workflowId: 'w1',
          schedule: '0 9 * * *',
          enabled: true,
          updatedAt: '2026-01-03T00:00:00.000Z',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    listDeployments.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'd1',
          provider: 'vercel',
          projectName: 'neos-preview',
          status: 'success',
          createdAt: '2026-01-04T00:00:00.000Z',
          updatedAt: '2026-01-04T00:00:00.000Z',
        },
      ],
    });
    listMediaFiles.mockResolvedValue({ ok: true, data: [{ id: 'm1' }, { id: 'm2' }] });
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [{ id: 'ds1' }, { id: 'ds2' }, { id: 'ds3' }],
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Nightly Report')).toBeInTheDocument();
    });
    expect(screen.getByText('neos-preview')).toBeInTheDocument();
    // Status cards show counts from list lengths (plugins=2, media=2, designSystems=3)
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(listDeployments).toHaveBeenCalled();
    expect(listRoutines).toHaveBeenCalled();
  });

  it('shows em-dash counts when API returns non-ok payloads', async () => {
    listSessions.mockResolvedValue({ ok: false, error: 'nope' });
    listWorkflows.mockResolvedValue({ ok: false, error: 'nope' });
    listSkills.mockResolvedValue({ ok: false });
    listPlugins.mockResolvedValue({ ok: false });
    listRoutines.mockResolvedValue({ ok: false });
    listDesignSystems.mockResolvedValue({ ok: false });
    listDeployments.mockResolvedValue({ ok: false });
    listMediaFiles.mockResolvedValue({ ok: false });
    health.mockResolvedValue({ status: 'error' });

    renderPage();
    await waitFor(() => {
      expect(health).toHaveBeenCalled();
    });
    // Counts fall back to "—" when responses are not ok
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText(/v0\./)).not.toBeInTheDocument();
  });

  it('shows Remote engine label in client mode', async () => {
    engineMode = 'client';
    renderPage();
    await waitFor(() => expect(health).toHaveBeenCalled());
    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
  });

  it('renders quick actions and status card links', async () => {
    renderPage();
    await waitFor(() => expect(health).toHaveBeenCalled());

    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    for (const title of [
      'New Session',
      'Templates',
      'Blocks',
      'Settings',
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    // Labels that also appear on status cards exist at least once
    expect(screen.getAllByText('Workflows').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Deployments').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Media').length).toBeGreaterThanOrEqual(1);

    // Quick action link for Templates
    const templateLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/templates');
    expect(templateLinks.length).toBeGreaterThan(0);
    const workflowLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/workflows');
    expect(workflowLinks.length).toBeGreaterThan(0);
    const sessionLinks = screen.getAllByRole('link').filter((a) => a.getAttribute('href') === '/sessions');
    expect(sessionLinks.length).toBeGreaterThan(0);
  });

  it('shows em-dash engine mode when mode is null and includes server URL detail', async () => {
    engineMode = null;
    renderPage();
    // Wait until stats resolve so only Engine (mode=null) still shows "—" among cards
    await waitFor(() => {
      expect(health).toHaveBeenCalled();
      expect(screen.getByText(/v0\.3\.55/)).toBeInTheDocument();
    });
    // Multiple status cards may briefly show "—"; Engine mode null is one of them
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
    // Engine detail includes server URL from useEngine
    expect(screen.getByText(/127\.0\.0\.1:57286/)).toBeInTheDocument();
  });

  it('hides recent sections when lists are empty and shows plugin count on skills card', async () => {
    listWorkflows.mockResolvedValue({ ok: true, data: [] });
    listRoutines.mockResolvedValue({ ok: true, data: [] });
    listDeployments.mockResolvedValue({ ok: true, data: [] });
    listPlugins.mockResolvedValue({ ok: true, data: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }] });
    listSkills.mockResolvedValue({ ok: true, data: [{ id: 's1' }] });
    renderPage();
    await waitFor(() => expect(listPlugins).toHaveBeenCalled());
    expect(screen.queryByText('Nightly Report')).not.toBeInTheDocument();
    expect(screen.queryByText('neos-preview')).not.toBeInTheDocument();
    expect(screen.getByText('3 plugin(s)')).toBeInTheDocument();
  });

  it('passes listDeployments limit of 200 for dashboard recents', async () => {
    renderPage();
    await waitFor(() => expect(listDeployments).toHaveBeenCalled());
    expect(listDeployments).toHaveBeenCalledWith(undefined, 200);
    expect(listMediaFiles).toHaveBeenCalledWith(200);
  });
});
