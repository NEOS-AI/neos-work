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

  it('shows empty state when options missing', () => {
    render(<GenUIChoice schema={{ options: [] }} onSelect={() => {}} />);
    expect(screen.getByText(/No choices available/i)).toBeInTheDocument();
  });

  it('shows empty state when all options are control-char only', () => {
    render(
      <GenUIChoice
        schema={{
          options: [
            { label: 'bad\nlabel', value: 'bad\nval' },
            { label: `x${'\0'}y`, value: `a${'\0'}b` },
          ],
        }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/No choices available/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
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

  it('skips control-char values and non-http preview urls', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <GenUIChoice
        schema={{
          options: [
            { label: 'Ok', value: 'ok' },
            // Both label and value control-char → hidden
            { label: 'bad\nlabel', value: 'bad\nval' },
            { label: '\nLead', value: '\nok' },
            {
              label: 'Js Preview',
              value: 'js',
              previewUrl: 'javascript:alert(1)',
            },
          ],
        }}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByText('Ok')).toBeInTheDocument();
    expect(screen.getByText('Js Preview')).toBeInTheDocument();
    // Fully control-char options hidden
    expect(screen.queryByText('Lead')).not.toBeInTheDocument();
    // Non-http preview not rendered as img
    expect(screen.queryByRole('img', { name: 'Js Preview' })).not.toBeInTheDocument();
    await user.click(screen.getByText('Ok'));
    expect(onSelect).toHaveBeenCalledWith('ok');
  });

  it('hides null-byte prompts and collapses multi-line prompts', () => {
    const { rerender } = render(
      <GenUIChoice
        schema={{
          prompt: 'line1\nline2',
          options: [{ label: 'A', value: 'a' }],
        }}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText('line1 line2')).toBeInTheDocument();

    rerender(
      <GenUIChoice
        schema={{
          prompt: `bad${'\0'}prompt`,
          options: [{ label: 'A', value: 'a' }],
        }}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByText(/prompt/i)).not.toBeInTheDocument();
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('rejects file: and overlong preview urls', () => {
    render(
      <GenUIChoice
        schema={{
          options: [
            {
              label: 'File',
              value: 'f',
              previewUrl: 'file:///etc/passwd',
            },
            {
              label: 'Long',
              value: 'l',
              previewUrl: `https://example.com/${'x'.repeat(3_000)}`,
            },
            {
              label: 'Https',
              value: 'h',
              previewUrl: 'https://cdn.example/ok.png',
            },
          ],
        }}
        onSelect={() => {}}
      />,
    );
    expect(screen.queryByRole('img', { name: 'File' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Long' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Https' })).toHaveAttribute(
      'src',
      'https://cdn.example/ok.png',
    );
  });

  it('caps overlong choice labels', () => {
    const long = 'x'.repeat(250);
    render(
      <GenUIChoice
        schema={{ options: [{ label: long, value: 'v1' }] }}
        onSelect={() => {}}
      />,
    );
    const shown = screen.getByRole('button').textContent ?? '';
    expect(shown.length).toBeLessThanOrEqual(200);
  });

  it('caps prompt length after multi-line collapse and caps overlong values on select', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const longPrompt = ('line\n'.repeat(40) + 'tail').repeat(2); // multi-line, >500 after collapse
    const longValue = 'v'.repeat(250);
    render(
      <GenUIChoice
        schema={{
          prompt: longPrompt,
          options: [{ label: 'Pick', value: longValue }],
        }}
        onSelect={onSelect}
      />,
    );
    // Prompt collapsed + capped at 500
    const body = document.body.textContent ?? '';
    expect(body).not.toContain('\nline\n');
    // The prompt paragraph itself is capped
    const promptEl = screen.getByText((_, el) => {
      if (!el || el.tagName !== 'P') return false;
      const t = el.textContent ?? '';
      return t.includes('line') && t.includes('tail') && t.length <= 500;
    });
    expect(promptEl).toBeTruthy();
    expect((promptEl.textContent ?? '').length).toBeLessThanOrEqual(500);

    await user.click(screen.getByRole('button', { name: 'Pick' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]![0]).toHaveLength(200);
  });

});
