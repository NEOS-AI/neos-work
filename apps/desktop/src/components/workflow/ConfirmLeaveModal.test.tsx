import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmLeaveModal } from './ConfirmLeaveModal.js';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('ConfirmLeaveModal', () => {
  it('renders unsaved changes copy', () => {
    render(<ConfirmLeaveModal onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText('workflow.unsavedChanges')).toBeInTheDocument();
    expect(screen.getByText('workflow.leaveConfirm')).toBeInTheDocument();
  });

  it('calls onCancel when staying', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmLeaveModal onConfirm={() => {}} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: /common.stay|stay/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onConfirm when leaving', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmLeaveModal onConfirm={onConfirm} onCancel={() => {}} />);
    await user.click(screen.getByRole('button', { name: /workflow.leave|leave/i }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
