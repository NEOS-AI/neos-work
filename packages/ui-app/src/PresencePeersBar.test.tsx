import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PresencePeersBar } from './PresencePeersBar.js';

describe('PresencePeersBar', () => {
  it('shows Solo when no peers', () => {
    const { container } = render(
      <PresencePeersBar peers={[]} self={{ sessionId: 's1', displayName: 'Me', colorHint: 10 }} />,
    );
    const root = container.querySelector('[data-testid="collab-peers"]') as HTMLElement;
    expect(within(root).getByTestId('collab-peers-label').textContent).toBe('Solo');
  });

  it('lists peers in popover with names', () => {
    const { container } = render(
      <PresencePeersBar
        self={{ sessionId: 's1', displayName: 'Me', colorHint: 10 }}
        peers={[
          { sessionId: 'abc123xyz', displayName: 'Alice', colorHint: 40 },
          { sessionId: 'def456uvw', displayName: 'Bob', colorHint: 200 },
        ]}
      />,
    );
    const root = container.querySelector('[data-testid="collab-peers"]') as HTMLElement;
    expect(within(root).getByTestId('collab-peers-label').textContent).toMatch(/2 peers/);
    fireEvent.click(within(root).getByTestId('collab-peers-toggle'));
    expect(within(root).getByTestId('collab-peers-list')).toBeTruthy();
    expect(within(root).getByText('Alice')).toBeTruthy();
    expect(within(root).getByText('Bob')).toBeTruthy();
    expect(within(root).getByText(/\(you\)/)).toBeTruthy();
  });

  it('shows selection hints for peers (v0.7 M2)', () => {
    const { container } = render(
      <PresencePeersBar
        self={{ sessionId: 's1', displayName: 'Me', colorHint: 10 }}
        peers={[{ sessionId: 'abc123xyz', displayName: 'Alice', colorHint: 40 }]}
        selections={{
          abc123xyz: {
            sessionId: 'abc123xyz',
            path: 'pages/index.html',
            selector: '#hero > h1',
          },
        }}
      />,
    );
    const root = container.querySelector('[data-testid="collab-peers"]') as HTMLElement;
    expect(within(root).getByTestId('collab-peers-label').textContent).toMatch(/selecting/);
    fireEvent.click(within(root).getByTestId('collab-peers-toggle'));
    expect(within(root).getByTestId('collab-peer-selection-abc123').textContent).toMatch(
      /index\.html/,
    );
    expect(within(root).getByTestId('collab-peer-selection-abc123').textContent).toMatch(/#hero/);
  });

  it('shows multi-select count in peer hint (v0.8 M3)', () => {
    const { container } = render(
      <PresencePeersBar
        self={{ sessionId: 's1', displayName: 'Me', colorHint: 10 }}
        peers={[{ sessionId: 'abc123xyz', displayName: 'Alice', colorHint: 40 }]}
        selections={{
          abc123xyz: {
            sessionId: 'abc123xyz',
            path: 'index.html',
            selector: '#b',
            selectors: ['#a', '#b', '#c'],
          },
        }}
      />,
    );
    const root = container.querySelector('[data-testid="collab-peers"]') as HTMLElement;
    fireEvent.click(within(root).getByTestId('collab-peers-toggle'));
    expect(within(root).getByTestId('collab-peer-selection-abc123').textContent).toMatch(
      /3 sel/,
    );
  });
});
