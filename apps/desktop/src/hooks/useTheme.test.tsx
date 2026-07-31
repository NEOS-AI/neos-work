import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseThemeMode, ThemeProvider, useTheme } from './useTheme.js';

function Probe() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolvedTheme}</span>
      <button type="button" onClick={() => setTheme('light')}>light</button>
      <button type="button" onClick={() => setTheme('dark')}>dark</button>
      <button type="button" onClick={() => setTheme('system')}>system</button>
    </div>
  );
}

function mockMatchMedia(matchesDark: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: matchesDark && query.includes('dark'),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('useTheme / ThemeProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(true);
  });

  it('throws outside provider', () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });

  it('defaults to dark and persists selection', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    await user.click(screen.getByRole('button', { name: 'light' }));
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(localStorage.getItem('neos-theme')).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('restores saved theme from localStorage', () => {
    localStorage.setItem('neos-theme', 'light');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('light');
  });

  it('system mode resolves via matchMedia', async () => {
    const user = userEvent.setup();
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'system' }));
    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(localStorage.getItem('neos-theme')).toBe('system');
  });

  it('parseThemeMode rejects control-char and accepts padded values', () => {
    expect(parseThemeMode(`dark${'\0'}`)).toBeNull();
    expect(parseThemeMode('\nlight')).toBeNull();
    expect(parseThemeMode('  system  ')).toBe('system');
    expect(parseThemeMode('neon')).toBeNull();
  });

  it('ignores control-char stored theme and defaults to dark', () => {
    localStorage.setItem('neos-theme', `light${'\0'}`);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme').textContent).toBe('dark');
  });
});
describe('ThemeProvider storage / system change edges', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    mockMatchMedia(false);
  });

  it('defaults to dark when localStorage getItem throws', () => {
    const orig = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error('denied');
    };
    try {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
      expect(screen.getByTestId('theme').textContent).toBe('dark');
    } finally {
      Storage.prototype.getItem = orig;
    }
  });

  it('setTheme ignores setItem failures', async () => {
    const user = userEvent.setup();
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('quota');
    };
    try {
      render(
        <ThemeProvider>
          <Probe />
        </ThemeProvider>,
      );
      await user.click(screen.getByRole('button', { name: 'light' }));
      expect(screen.getByTestId('theme').textContent).toBe('light');
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    } finally {
      Storage.prototype.setItem = orig;
    }
  });

  it('reacts to system preference changes while in system mode', async () => {
    const user = userEvent.setup();
    let matchesDark = true;
    const listeners: Array<() => void> = [];
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: (query: string) => ({
        matches: matchesDark && query.includes('dark'),
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: (_: string, handler: () => void) => {
          listeners.push(handler);
        },
        removeEventListener: (_: string, handler: () => void) => {
          const i = listeners.indexOf(handler);
          if (i >= 0) listeners.splice(i, 1);
        },
        dispatchEvent: () => false,
      }),
    });

    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'system' }));
    expect(screen.getByTestId('resolved').textContent).toBe('dark');

    matchesDark = false;
    act(() => {
      for (const h of [...listeners]) h();
    });
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});
