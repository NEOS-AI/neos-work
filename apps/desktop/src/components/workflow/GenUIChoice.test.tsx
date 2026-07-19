import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GenUIChoice } from './GenUIChoice.js';

describe('GenUIChoice', () => {
  it('renders prompt and options', () => {
    render(
      <GenUIChoice
        schema={{
          prompt: 'Pick a direction',
          options: [
            { label: 'Minimal', value: 'min' },
            { label: 'Bold', value: 'bold' },
          ],
        }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('Pick a direction')).toBeInTheDocument();
    expect(screen.getByText('Minimal')).toBeInTheDocument();
    expect(screen.getByText('Bold')).toBeInTheDocument();
  });

  it('calls onSelect with value or label', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <GenUIChoice
        schema={{
          options: [
            { label: 'Minimal', value: 'min' },
            { label: 'Label Only' },
          ],
        }}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByText('Minimal'));
    expect(onSelect).toHaveBeenCalledWith('min');
    await user.click(screen.getByText('Label Only'));
    expect(onSelect).toHaveBeenCalledWith('Label Only');
  });

  it('renders preview images when previewUrl is set', () => {
    render(
      <GenUIChoice
        schema={{
          options: [{ label: 'With Preview', value: 'p1', previewUrl: 'https://example.com/p.png' }],
        }}
        onSelect={() => {}}
      />,
    );
    const img = screen.getByRole('img', { name: 'With Preview' });
    expect(img).toHaveAttribute('src', 'https://example.com/p.png');
  });
});
