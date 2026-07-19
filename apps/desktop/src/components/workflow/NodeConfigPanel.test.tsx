import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
      data: { nodeType: 'trigger', label: 'Start', config: {} },
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
    expect(screen.getByText(/Initial inputs/i)).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });

  it('renders agent provider/model fields and patches label', async () => {
    const user = userEvent.setup();
    const onPatchNodeData = vi.fn();
    listHarnesses.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'h-code',
          name: 'Coder',
          domain: 'coding',
          description: 'd',
          systemPrompt: 'p',
          allowedTools: [],
          isBuiltIn: true,
        },
      ],
    });

    const node = {
      id: 'a1',
      type: 'agent_coding',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'agent_coding',
        label: 'Agent',
        config: { llmProvider: 'anthropic', harnessId: 'h-code' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={node}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    expect(screen.getByText('Provider')).toBeInTheDocument();
    expect(screen.getByText('Model')).toBeInTheDocument();
    expect(screen.getByText('Additional system prompt')).toBeInTheDocument();

    const label = screen.getByDisplayValue('Agent');
    await user.clear(label);
    await user.type(label, 'X');
    expect(onPatchNodeData).toHaveBeenCalled();
  });

  it('shows CLI hint when agent provider is cli-*', async () => {
    const node = {
      id: 'a2',
      type: 'agent_coding',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'agent_coding',
        label: 'CLI Agent',
        config: { llmProvider: 'cli-claude' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel selectedNode={node} validationIssues={[]} onPatchNodeData={() => {}} />,
    );

    expect(screen.getByText(/External CLI agent will be spawned/i)).toBeInTheDocument();
    expect(screen.queryByText('Model')).not.toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
    await waitFor(() => expect(listHarnesses).toHaveBeenCalled());
  });

  it('renders web_search and media config fields', async () => {
    const searchNode = {
      id: 's1',
      type: 'web_search',
      position: { x: 0, y: 0 },
      data: { nodeType: 'web_search', label: 'Search', config: { query: 'neos' } },
    } as unknown as Node;

    const { rerender } = render(
      <NodeConfigPanel selectedNode={searchNode} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByDisplayValue('neos')).toBeInTheDocument();
    expect(screen.getByText('Max results')).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());

    const mediaNode = {
      id: 'm1',
      type: 'media',
      position: { x: 0, y: 0 },
      data: { nodeType: 'media', label: 'Img', config: { mediaType: 'image', prompt: 'cat' } },
    } as unknown as Node;

    rerender(
      <NodeConfigPanel selectedNode={mediaNode} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByText('Media type')).toBeInTheDocument();
    expect(screen.getByDisplayValue('cat')).toBeInTheDocument();
  });

  it('shows gate helper copy for parallel_start and gate_and', async () => {
    const ps = {
      id: 'ps',
      type: 'parallel_start',
      position: { x: 0, y: 0 },
      data: { nodeType: 'parallel_start', label: 'Fan', config: {} },
    } as unknown as Node;

    const { rerender } = render(
      <NodeConfigPanel selectedNode={ps} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByText(/Fan-out: successors run as parallel branches/i)).toBeInTheDocument();

    const and = {
      id: 'and',
      type: 'gate_and',
      position: { x: 0, y: 0 },
      data: { nodeType: 'gate_and', label: 'AND', config: {} },
    } as unknown as Node;
    rerender(
      <NodeConfigPanel selectedNode={and} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByText(/no required settings/i)).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });

  it('renders slack and deploy node fields', async () => {
    const slack = {
      id: 'sl',
      type: 'slack_message',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'slack_message',
        label: 'Slack',
        config: { channel: '#alerts', textTemplate: 'hi' },
      },
    } as unknown as Node;

    const { rerender } = render(
      <NodeConfigPanel selectedNode={slack} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByDisplayValue('#alerts')).toBeInTheDocument();
    expect(screen.getByDisplayValue('hi')).toBeInTheDocument();

    const deploy = {
      id: 'd1',
      type: 'deploy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'deploy',
        label: 'Deploy',
        config: { provider: 'cloudflare', projectName: 'site' },
      },
    } as unknown as Node;
    rerender(
      <NodeConfigPanel selectedNode={deploy} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByText('Provider')).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });

  it('renders media audio fields when mediaType is audio', async () => {
    const audio = {
      id: 'm2',
      type: 'media',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'media',
        label: 'TTS',
        config: { mediaType: 'audio', text: 'hello world', voice: 'nova' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel selectedNode={audio} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByDisplayValue('hello world')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText(/Requires OPENAI_API_KEY/i)).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });

  it('patches agent maxSteps via NumberField (1–200)', async () => {
    const onPatchNodeData = vi.fn();
    const node = {
      id: 'a3',
      type: 'agent_coding',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'agent_coding',
        label: 'Agent',
        config: { llmProvider: 'anthropic', maxSteps: 10 },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={node}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    expect(screen.getByText('Max steps')).toBeInTheDocument();
    const steps = screen.getByDisplayValue('10');
    // Controlled value is not re-rendered from the mock parent; fire a single change.
    fireEvent.change(steps, { target: { value: '25' } });
    expect(onPatchNodeData).toHaveBeenCalled();
    const last = onPatchNodeData.mock.calls.at(-1)?.[1] as { config?: { maxSteps?: number } };
    expect(last?.config?.maxSteps).toBe(25);
  });

  it('renders image quality select and patches quality', async () => {
    const user = userEvent.setup();
    const onPatchNodeData = vi.fn();
    const mediaNode = {
      id: 'm3',
      type: 'media',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'media',
        label: 'Img',
        config: { mediaType: 'image', prompt: 'cat', quality: 'standard' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={mediaNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    expect(screen.getByText('Quality')).toBeInTheDocument();
    const quality = screen.getByDisplayValue('standard');
    await user.selectOptions(quality, 'hd');
    expect(onPatchNodeData).toHaveBeenCalled();
    const last = onPatchNodeData.mock.calls.at(-1)?.[1] as { config?: { quality?: string } };
    expect(last?.config?.quality).toBe('hd');
  });

  it('renders TTS model select and patches model for audio media', async () => {
    const user = userEvent.setup();
    const onPatchNodeData = vi.fn();
    const audio = {
      id: 'm4',
      type: 'media',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'media',
        label: 'TTS',
        config: { mediaType: 'audio', text: 'hi', model: 'tts-1' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={audio}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    expect(screen.getByText('TTS model')).toBeInTheDocument();
    const model = screen.getByDisplayValue('tts-1');
    await user.selectOptions(model, 'tts-1-hd');
    const last = onPatchNodeData.mock.calls.at(-1)?.[1] as { config?: { model?: string } };
    expect(last?.config?.model).toBe('tts-1-hd');
  });

  it('renders discord message fields', async () => {
    const discord = {
      id: 'dc1',
      type: 'discord_message',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'discord_message',
        label: 'Discord',
        config: { textTemplate: 'ping' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel selectedNode={discord} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    expect(screen.getByDisplayValue('ping')).toBeInTheDocument();
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
  });
});
