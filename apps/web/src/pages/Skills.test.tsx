import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { skillsCopy } from '../lib/skills-i18n.js';

const listSkills = vi.fn();
const scanSkills = vi.fn();
const toggleSkill = vi.fn();
const deleteSkill = vi.fn();
const getSettings = vi.fn();
const searchSkillCatalog = vi.fn();
const previewRemoteSkill = vi.fn();
const installRemoteSkill = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listSkills = listSkills;
    scanSkills = scanSkills;
    toggleSkill = toggleSkill;
    deleteSkill = deleteSkill;
    getSettings = getSettings;
    searchSkillCatalog = searchSkillCatalog;
    previewRemoteSkill = previewRemoteSkill;
    installRemoteSkill = installRemoteSkill;
  },
}));

const { Skills } = await import('./Skills.js');

describe('Web Skills page', () => {
  beforeEach(() => {
    listSkills.mockReset().mockResolvedValue({
      ok: true,
      data: [{ id: 'code-review', name: 'Code review', enabled: true }],
    });
    scanSkills.mockReset().mockResolvedValue({ ok: true, data: { scanned: 1, total: 7 } });
    toggleSkill.mockReset().mockResolvedValue({ ok: true });
    deleteSkill.mockReset().mockResolvedValue({ ok: true });
    getSettings.mockReset().mockResolvedValue({ ok: true, data: {} });
    searchSkillCatalog.mockReset().mockResolvedValue({
      ok: true,
      data: { query: '', searchType: 'fuzzy', count: 0, skills: [] },
    });
    previewRemoteSkill.mockReset().mockResolvedValue({ ok: false, error: 'upstream_unavailable' });
    installRemoteSkill.mockReset().mockResolvedValue({
      ok: true,
      data: { id: 'inst-1', name: 'find-skills', source: 'remote' },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  function renderSkills() {
    return render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('lists skills and scans', async () => {
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('skill-code-review')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('skills-scan'));
    await waitFor(() => expect(scanSkills).toHaveBeenCalled());
  });

  it('confirms registry-only delete with i18n copy', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('skill-delete-code-review')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('skill-delete-code-review'));
    expect(confirm).toHaveBeenCalledWith(skillsCopy.deleteRegistryConfirm);
    expect(deleteSkill).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByTestId('skill-delete-code-review'));
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith('code-review'));
  });

  it('confirms remote file delete with i18n copy', async () => {
    listSkills.mockResolvedValue({
      ok: true,
      data: [{ id: 'remote-1', name: 'Remote', enabled: true, source: 'remote' }],
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(
      <MemoryRouter initialEntries={['/skills']}>
        <Routes>
          <Route path="/skills" element={<Skills />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('skill-delete-remote-1')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('skill-delete-remote-1'));
    expect(confirm).toHaveBeenCalledWith(skillsCopy.deleteRemoteFilesConfirm);
    await waitFor(() => expect(deleteSkill).toHaveBeenCalledWith('remote-1'));
  });

  it('searches the catalog and renders hits', async () => {
    searchSkillCatalog.mockResolvedValue({
      ok: true,
      data: {
        query: 'find',
        searchType: 'fuzzy',
        count: 1,
        skills: [
          {
            id: 'vercel-labs/skills/find-skills',
            slug: 'find-skills',
            name: 'find-skills',
            source: 'vercel-labs/skills',
            installs: 12,
            sourceType: 'github',
            installUrl: null,
            url: 'https://skills.sh/vercel-labs/skills/find-skills',
            installed: false,
          },
        ],
      },
    });
    previewRemoteSkill.mockResolvedValue({
      ok: true,
      data: {
        id: 'vercel-labs/skills/find-skills',
        slug: 'find-skills',
        name: 'find-skills',
        description: 'Find skills',
        skillMd: '---\nname: find-skills\n---\n',
        truncated: false,
        trust: 'unverified',
        sourceUrl: 'https://github.com/vercel-labs/skills',
        skillsShUrl: 'https://skills.sh/vercel-labs/skills/find-skills',
      },
    });
    renderSkills();
    await waitFor(() => expect(screen.getByTestId('skills-catalog-search')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('skills-catalog-search'), { target: { value: 'find' } });
    await waitFor(() => {
      expect(searchSkillCatalog).toHaveBeenCalledWith('find');
    });
    expect(screen.getByText('find-skills')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('skills-catalog-preview-vercel-labs/skills/find-skills'));
    await waitFor(() => expect(screen.getByTestId('skills-preview-drawer')).toBeInTheDocument());
    expect(screen.getByText(skillsCopy.licenseUnknown)).toBeInTheDocument();
    expect(screen.getByText(skillsCopy.thirdPartyDisclaimer)).toBeInTheDocument();
    expect(screen.getByTestId('skills-preview-drawer').querySelector('pre')?.textContent).toBe(
      '---\nname: find-skills\n---\n',
    );
  });

  it('does not POST install when confirm is cancelled', async () => {
    searchSkillCatalog.mockResolvedValue({
      ok: true,
      data: {
        query: 'find',
        searchType: 'fuzzy',
        count: 1,
        skills: [
          {
            id: 'vercel-labs/skills/find-skills',
            slug: 'find-skills',
            name: 'find-skills',
            source: 'vercel-labs/skills',
            installs: 1,
            sourceType: 'github',
            installUrl: null,
            url: 'https://skills.sh/vercel-labs/skills/find-skills',
            installed: false,
          },
        ],
      },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderSkills();
    await waitFor(() => expect(screen.getByTestId('skills-catalog-search')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('skills-catalog-search'), { target: { value: 'find' } });
    await waitFor(() =>
      expect(screen.getByTestId('skills-catalog-install-vercel-labs/skills/find-skills')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('skills-catalog-install-vercel-labs/skills/find-skills'));
    expect(confirm).toHaveBeenCalledWith(skillsCopy.installConfirm);
    expect(installRemoteSkill).not.toHaveBeenCalled();
  });

  it('POSTs confirm:true after install confirm', async () => {
    searchSkillCatalog.mockResolvedValue({
      ok: true,
      data: {
        query: 'find',
        searchType: 'fuzzy',
        count: 1,
        skills: [
          {
            id: 'vercel-labs/skills/find-skills',
            slug: 'find-skills',
            name: 'find-skills',
            source: 'vercel-labs/skills',
            installs: 1,
            sourceType: 'github',
            installUrl: null,
            url: 'https://skills.sh/vercel-labs/skills/find-skills',
            installed: false,
          },
        ],
      },
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderSkills();
    await waitFor(() => expect(screen.getByTestId('skills-catalog-search')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('skills-catalog-search'), { target: { value: 'find' } });
    await waitFor(() =>
      expect(screen.getByTestId('skills-catalog-install-vercel-labs/skills/find-skills')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('skills-catalog-install-vercel-labs/skills/find-skills'));
    await waitFor(() => {
      expect(installRemoteSkill).toHaveBeenCalledWith({
        id: 'vercel-labs/skills/find-skills',
        confirm: true,
      });
    });
  });

  it('hides catalog search when remoteCatalogEnabled is false', async () => {
    getSettings.mockResolvedValue({
      ok: true,
      data: { 'skills.remoteCatalogEnabled': 'false' },
    });
    renderSkills();
    await waitFor(() => expect(screen.getByTestId('skills-catalog-disabled')).toBeInTheDocument());
    expect(screen.getByText(skillsCopy.catalogDisabled)).toBeInTheDocument();
    expect(screen.queryByTestId('skills-catalog-search')).not.toBeInTheDocument();
    expect(searchSkillCatalog).not.toHaveBeenCalled();
    expect(previewRemoteSkill).not.toHaveBeenCalled();
  });

  it('shows ambiguous candidates and retries with the chosen slug', async () => {
    searchSkillCatalog.mockResolvedValue({
      ok: true,
      data: {
        query: 'agent',
        searchType: 'fuzzy',
        count: 1,
        skills: [
          {
            id: 'vercel-labs/agent-skills',
            slug: 'agent-skills',
            name: 'agent-skills',
            source: 'vercel-labs/agent-skills',
            installs: 3,
            sourceType: 'github',
            installUrl: null,
            url: 'https://skills.sh/vercel-labs/agent-skills',
            installed: false,
          },
        ],
      },
    });
    installRemoteSkill
      .mockResolvedValueOnce({
        ok: false,
        error: 'skill_ambiguous',
        candidates: [
          { slug: 'alpha', name: 'Alpha' },
          { slug: 'beta', name: 'Beta' },
        ],
      })
      .mockResolvedValueOnce({
        ok: true,
        data: { id: 'inst-2', name: 'Alpha', source: 'remote' },
      });
    renderSkills();
    await waitFor(() => expect(screen.getByTestId('skills-catalog-search')).toBeInTheDocument());
    fireEvent.change(screen.getByTestId('skills-catalog-search'), { target: { value: 'agent' } });
    await waitFor(() =>
      expect(screen.getByTestId('skills-catalog-install-vercel-labs/agent-skills')).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('skills-catalog-install-vercel-labs/agent-skills'));
    await waitFor(() => expect(screen.getByTestId('skills-ambiguous')).toBeInTheDocument());
    expect(screen.getByText(skillsCopy.skillAmbiguous)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('skills-ambiguous-pick-alpha'));
    await waitFor(() => {
      expect(installRemoteSkill).toHaveBeenLastCalledWith({
        id: 'vercel-labs/agent-skills',
        slug: 'alpha',
        confirm: true,
      });
    });
  });
});
