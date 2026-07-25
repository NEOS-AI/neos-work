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
});
