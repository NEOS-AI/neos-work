import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

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
});
