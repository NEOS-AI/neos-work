import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { skillsCopy } from '../lib/skills-i18n.js';

const listSkills = vi.fn();
const scanSkills = vi.fn();
const toggleSkill = vi.fn();
const deleteSkill = vi.fn();

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
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

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
});
