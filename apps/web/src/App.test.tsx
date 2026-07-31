import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Connect } from './pages/Connect.js';

describe('Connect page', () => {
  it('renders token UX', () => {
    render(
      <MemoryRouter>
        <Connect />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('connect-token')).toBeInTheDocument();
    expect(screen.getByTestId('connect-submit')).toBeInTheDocument();
  });
});
