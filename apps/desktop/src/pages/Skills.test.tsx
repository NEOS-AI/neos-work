import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listSkills = vi.fn();
const scanSkills = vi.fn();
const toggleSkill = vi.fn();
const deleteSkill = vi.fn();
const upgradeSkillToPlugin = vi.fn();

const client = { listSkills, scanSkills, toggleSkill, deleteSkill, upgradeSkillToPlugin };

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { Skills } = await import('./Skills.js');

const skills = [
  {
    id: 'sk-b',
    name: 'Beta Skill',
    description: 'B desc',
    category: 'coding',
    enabled: true,
    featured: false,
    source: 'global',
    examplePrompt: 'Try beta',
  },
  {
    id: 'sk-a',
    name: 'Alpha Skill',
    description: 'A desc',
    category: 'writing',
    enabled: false,
    featured: true,
    source: 'local',
  },
];

describe('Skills page', () => {
  beforeEach(() => {
    listSkills.mockReset();
    scanSkills.mockReset();
    toggleSkill.mockReset();
    deleteSkill.mockReset();
    upgradeSkillToPlugin.mockReset();
    localStorage.clear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});
  });

  it('shows empty installed state', async () => {
    listSkills.mockResolvedValue({ ok: true, data: [] });
    render(<Skills />);
    await waitFor(() => {
      expect(screen.getByText(/No skills installed/)).toBeInTheDocument();
    });
  });

  it('lists skills featured first and filters by category/enabled/search', async () => {
    const user = userEvent.setup();
    listSkills.mockResolvedValue({ ok: true, data: skills });
    render(<Skills />);

    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());
    // featured first
    const cards = screen.getAllByText(/Alpha Skill|Beta Skill/);
    expect(cards[0]!.textContent).toContain('Alpha');
    expect(screen.getByText('1/2 on')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'coding' }));
    expect(screen.getByText('Beta Skill')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Skill')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'all' }));
    await user.click(screen.getByRole('button', { name: 'OFF' }));
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument();
    expect(screen.queryByText('Beta Skill')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.type(screen.getByPlaceholderText('Search skills…'), 'Beta');
    expect(screen.getByText('Beta Skill')).toBeInTheDocument();
    expect(screen.queryByText('Alpha Skill')).not.toBeInTheDocument();
  });

  it('scans skills and shows result', async () => {
    listSkills.mockResolvedValue({ ok: true, data: [] });
    scanSkills.mockResolvedValue({ ok: true, data: { scanned: 2, total: 5 } });
    render(<Skills />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Scan/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Scan/i }));
    await waitFor(() => {
      expect(scanSkills).toHaveBeenCalled();
      expect(screen.getByText(/Scanned 2 skills/)).toBeInTheDocument();
    });
  });

  it('shows scan failure message when scanSkills is non-ok', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    scanSkills.mockResolvedValue({ ok: false, error: 'disk full' });
    render(<Skills />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Scan/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Scan/i }));
    await waitFor(() => {
      expect(scanSkills).toHaveBeenCalled();
      expect(screen.getByText(/Scan failed: disk full/)).toBeInTheDocument();
    });
  });

  it('toggles and deletes a skill', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    toggleSkill.mockResolvedValue({ ok: true });
    deleteSkill.mockResolvedValue({ ok: true });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());

    // Alpha is disabled → Enable; Beta is enabled → Disable
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(toggleSkill).toHaveBeenCalledWith('sk-a', true));

    fireEvent.click(screen.getAllByRole('button', { name: 'Remove skill' })[0]!);
    await waitFor(() => expect(deleteSkill).toHaveBeenCalled());
  });

  it('alerts scrubbed error when skill delete fails and keeps the skill', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    deleteSkill.mockResolvedValue({
      ok: false,
      error: `locked${'\n'}skill${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove skill' })[0]!);
    await waitFor(() => {
      expect(deleteSkill).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('locked skill!');
    });
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument();
    expect((window.alert as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).not.toContain('\0');
  });

  it('alerts scrubbed error when skill toggle fails and keeps prior state', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    toggleSkill.mockResolvedValue({
      ok: false,
      error: `toggle${'\n'}denied${'\0'}!`,
    });
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => {
      expect(toggleSkill).toHaveBeenCalledWith('sk-a', true);
      expect(window.alert).toHaveBeenCalledWith('toggle denied!');
    });
    // Still shows Enable (not flipped optimistically)
    expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument();
  });

  it('disables an enabled skill and shows no-match search', async () => {
    const user = userEvent.setup();
    listSkills.mockResolvedValue({ ok: true, data: skills });
    toggleSkill.mockResolvedValue({ ok: true });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Beta Skill')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(toggleSkill).toHaveBeenCalledWith('sk-b', false));

    await user.type(screen.getByPlaceholderText('Search skills…'), 'zzzz-none');
    expect(screen.queryByText('Alpha Skill')).not.toBeInTheDocument();
    expect(screen.queryByText('Beta Skill')).not.toBeInTheDocument();
    expect(screen.getByText('0/2')).toBeInTheDocument();
  });

  it('opens try-prompt modal and Escape closes it', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Beta Skill')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'skill.tryPrompt' }));
    await waitFor(() => {
      expect(screen.getByText('Try beta')).toBeInTheDocument();
    });

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect(screen.queryByText('Try beta')).not.toBeInTheDocument();
    });
  });

  it('Escape clears search', async () => {
    const user = userEvent.setup();
    listSkills.mockResolvedValue({ ok: true, data: skills });
    render(<Skills />);
    await waitFor(() => expect(screen.getByPlaceholderText('Search skills…')).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText('Search skills…'), 'xx');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await waitFor(() => {
      expect((screen.getByPlaceholderText('Search skills…') as HTMLInputElement).value).toBe('');
    });
  });

  it('upgrades skill to plugin after confirm and cancels when confirm is false', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    upgradeSkillToPlugin.mockResolvedValue({ ok: true, data: { name: 'Beta Plugin' } });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Beta Skill')).toBeInTheDocument());

    const upgradeBtns = screen.getAllByTitle(/open-design\.json|Plugin/i);
    expect(upgradeBtns.length).toBeGreaterThan(0);
    fireEvent.click(upgradeBtns[0]!);
    await waitFor(() => {
      expect(upgradeSkillToPlugin).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalled();
    });

    upgradeSkillToPlugin.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    fireEvent.click(upgradeBtns[0]!);
    expect(upgradeSkillToPlugin).not.toHaveBeenCalled();
  });

  it('alerts when upgrade to plugin fails', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    upgradeSkillToPlugin.mockResolvedValue({ ok: false, error: 'upgrade failed hard' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Beta Skill')).toBeInTheDocument());

    fireEvent.click(screen.getAllByTitle(/open-design\.json|Plugin/i)[0]!);
    await waitFor(() => {
      expect(upgradeSkillToPlugin).toHaveBeenCalled();
      expect(window.alert).toHaveBeenCalledWith('upgrade failed hard');
    });
  });

  it('falls back to all when persisted category is missing from skills', async () => {
    localStorage.setItem('neos-skills-category', 'legacy-gone');
    listSkills.mockResolvedValue({ ok: true, data: skills });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());
    // Both categories visible after fallback; chip "all" active
    expect(screen.getByText('Beta Skill')).toBeInTheDocument();
    expect(localStorage.getItem('neos-skills-category')).toBe('all');
  });

  it('shows scan unknown-error message and featured/source badges', async () => {
    listSkills.mockResolvedValue({
      ok: true,
      data: [
        {
          ...skills[1]!,
          version: '2.1.0',
          mode: 'agent',
          installedAt: '2026-01-15T12:00:00.000Z',
        },
        skills[0]!,
      ],
    });
    scanSkills.mockResolvedValue({ ok: false });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());

    // Featured star + source/version/mode badges (category appears as chip + badge)
    expect(screen.getByText('★')).toBeInTheDocument();
    expect(screen.getByText('local')).toBeInTheDocument();
    expect(screen.getAllByText('writing').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('v2.1.0')).toBeInTheDocument();
    expect(screen.getByText('agent')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Scan/i }));
    await waitFor(() => {
      expect(screen.getByText(/Scan failed: unknown error/)).toBeInTheDocument();
    });
  });

  it('removes skill from list after delete and tolerates non-ok list', async () => {
    listSkills
      .mockResolvedValueOnce({ ok: true, data: skills })
      .mockResolvedValueOnce({ ok: false, error: 'boom' });
    deleteSkill.mockResolvedValue({ ok: true });
    const { unmount } = render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());

    // Delete Alpha (first Remove skill among cards after featured sort: Alpha first)
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove skill' })[0]!);
    await waitFor(() => {
      expect(deleteSkill).toHaveBeenCalledWith('sk-a');
      expect(screen.queryByText('Alpha Skill')).not.toBeInTheDocument();
    });
    expect(screen.getByText('Beta Skill')).toBeInTheDocument();
    unmount();

    // Non-ok listSkills leaves empty without crashing
    render(<Skills />);
    await waitFor(() => {
      expect(screen.getByText(/No skills installed/)).toBeInTheDocument();
    });
  });

  it('alerts Upgrade failed when upgrade response has no error field', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    upgradeSkillToPlugin.mockResolvedValue({ ok: false });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Beta Skill')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle(/open-design\.json|Plugin/i)[0]!);
    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith('Upgrade failed');
    });
  });

  it('persists category chip selection via skills prefs', async () => {
    const user = userEvent.setup();
    listSkills.mockResolvedValue({ ok: true, data: skills });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Alpha Skill')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'writing' }));
    expect(localStorage.getItem('neos-skills-category')).toBe('writing');
    expect(screen.getByText('Alpha Skill')).toBeInTheDocument();
    expect(screen.queryByText('Beta Skill')).not.toBeInTheDocument();
  });

  it('omits control-char skill categories from chips', async () => {
    listSkills.mockResolvedValue({
      ok: true,
      data: [
        ...skills,
        {
          id: 'evil',
          name: 'Evil Skill',
          description: 'x',
          category: `bad${'\0'}cat`,
          enabled: true,
          featured: false,
          source: 'local',
        },
        {
          id: 'pad',
          name: 'Pad Skill',
          description: 'x',
          category: '  tools  ',
          enabled: true,
          featured: false,
          source: 'local',
        },
      ],
    });
    render(<Skills />);
    await waitFor(() => expect(screen.getByText('Evil Skill')).toBeInTheDocument());
    // Control-char category never becomes a chip label
    expect(screen.queryByRole('button', { name: /bad/i })).not.toBeInTheDocument();
    // Padded category trimmed to chip
    expect(screen.getByRole('button', { name: 'tools' })).toBeInTheDocument();

    // Selecting trimmed chip still matches padded skill.category
    fireEvent.click(screen.getByRole('button', { name: 'tools' }));
    expect(screen.getByText('Pad Skill')).toBeInTheDocument();
    expect(screen.queryByText('Evil Skill')).not.toBeInTheDocument();
    expect(screen.queryByText('Alpha Skill')).not.toBeInTheDocument();
  });

  it('scrubs control chars from scan failure and upgrade alert messages', async () => {
    listSkills.mockResolvedValue({ ok: true, data: skills });
    scanSkills.mockResolvedValue({ ok: false, error: `disk${'\n'}full${'\0'}!` });
    upgradeSkillToPlugin.mockResolvedValue({
      ok: false,
      error: `upgrade${'\0'}denied\nnow`,
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<Skills />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Scan/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Scan/i }));
    await waitFor(() => {
      expect(screen.getByText(/Scan failed: disk full!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');

    await waitFor(() => expect(screen.getByText('Beta Skill')).toBeInTheDocument());
    fireEvent.click(screen.getAllByTitle(/open-design\.json|Plugin/i)[0]!);
    await waitFor(() => expect(upgradeSkillToPlugin).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalled();
    const msg = String(alertSpy.mock.calls.at(-1)?.[0] ?? '');
    // null-byte stripped (no space inserted); newlines collapsed to spaces
    expect(msg).toBe('upgradedenied now');
    expect(msg).not.toContain('\0');
  });
});
