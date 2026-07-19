import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Node } from '@xyflow/react';
import { NodeConfigPanel } from './NodeConfigPanel.js';

const listDesignSystems = vi.fn();
const listBlocks = vi.fn();
const listHarnesses = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    client: {
      listDesignSystems,
      listBlocks,
      listHarnesses,
    },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('NodeConfigPanel', () => {
  beforeEach(() => {
    listDesignSystems.mockReset();
    listBlocks.mockReset();
    listHarnesses.mockReset();
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
  });

  it('shows empty-state copy and workflow validation when no node selected', async () => {
    render(
      <NodeConfigPanel
        selectedNode={null}
        validationIssues={[
          { code: 'no_trigger', severity: 'warning', message: 'Workflow has no trigger node.' },
        ]}
        onPatchNodeData={() => {}}
      />,
    );
    expect(screen.getByText(/Select a node to edit its settings/i)).toBeInTheDocument();
    expect(screen.getByText(/Workflow has no trigger node/i)).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });

  it('renders workflow description and design system when no node selected', async () => {
    const onUpdateDescription = vi.fn();
    const onUpdateDesignSystemId = vi.fn();
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [{ id: 'ds1', name: 'Brand', path: '/x', hasManifest: false, hasTokens: false, hasComponents: false, createdAt: '', updatedAt: '' }],
    });

    render(
      <NodeConfigPanel
        selectedNode={null}
        validationIssues={[]}
        onPatchNodeData={() => {}}
        workflowDescription="My flow"
        onUpdateDescription={onUpdateDescription}
        designSystemId=""
        onUpdateDesignSystemId={onUpdateDesignSystemId}
      />,
    );

    expect(screen.getByText('workflow.description')).toBeInTheDocument();
    expect(screen.getByDisplayValue('My flow')).toBeInTheDocument();
    expect(screen.getByText('Design System')).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });

  it('shows label field and issues for selected trigger node', async () => {
    const node = {
      id: 't1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { label: 'Start', config: {} },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={node}
        validationIssues={[
          {
            code: 'trigger_no_downstream',
            severity: 'warning',
            nodeId: 't1',
            message: 'Trigger node has no downstream connection.',
          },
        ]}
        onPatchNodeData={() => {}}
      />,
    );

    expect(screen.getByDisplayValue('Start')).toBeInTheDocument();
    expect(screen.getByText(/Trigger node has no downstream connection/i)).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });
});
