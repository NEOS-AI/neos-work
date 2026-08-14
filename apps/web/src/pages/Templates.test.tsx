import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const listTemplates = vi.fn();
const createWorkflow = vi.fn();

vi.mock('../lib/auth.js', () => ({
  loadConnection: () => ({ serverUrl: 'http://127.0.0.1:3000', token: 'tok' }),
  clearConnection: vi.fn(),
}));
vi.mock('../lib/api.js', () => ({
  ApiError: class extends Error {
    status = 400;
  },
  WebApiClient: class {
    listTemplates = listTemplates;
    createWorkflow = createWorkflow;
  },
}));

const { Templates } = await import('./Templates.js');

describe('Web Templates page', () => {
  beforeEach(() => {
    listTemplates.mockReset().mockResolvedValue({
      ok: true,
      data: [{ name: 'Stock Price Monitor', domain: 'finance', nodes: [], edges: [] }],
    });
    createWorkflow.mockReset().mockResolvedValue({ ok: true, data: { id: 'wf-new' } });
  });

  it('uses a template to create a workflow', async () => {
    render(
      <MemoryRouter initialEntries={['/templates']}>
        <Routes>
          <Route path="/templates" element={<Templates />} />
          <Route path="/workflows/:id" element={<div data-testid="wf-editor">ed</div>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId('template-Stock Price Monitor')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('template-use-Stock Price Monitor'));
    await waitFor(() => expect(createWorkflow).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('wf-editor')).toBeInTheDocument());
  });
});
