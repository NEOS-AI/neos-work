import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenUIConfirmation } from './GenUIConfirmation.js';

describe('GenUIConfirmation', () => {
  it('renders prompt and default labels', () => {
    render(
      <GenUIConfirmation
        schema={{ prompt: 'Proceed with deploy?' }}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText('Proceed with deploy?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /continue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('calls onConfirm with true/false', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <GenUIConfirmation
        schema={{ confirmLabel: 'Yes', cancelLabel: 'No' }}
        onConfirm={onConfirm}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });

  it('works without schema (default labels only)', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<GenUIConfirmation onConfirm={onConfirm} />);
    await user.click(screen.getByRole('button', { name: /continue/i }));
    expect(onConfirm).toHaveBeenCalledWith(true);
  });
});
