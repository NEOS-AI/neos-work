import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Node } from '@xyflow/react';
import { NodeConfigPanel } from './NodeConfigPanel.js';

const listDesignSystems = vi.fn();
const listBlocks = vi.fn();
const listHarnesses = vi.fn();
const getWebhookSecret = vi.fn();
const regenerateWebhookSecret = vi.fn();
const testWebhookFire = vi.fn();
const deployPreflight = vi.fn();

vi.mock('../../hooks/useEngine.js', () => ({
  useEngine: () => ({
    serverUrl: 'http://127.0.0.1:57286',
    client: {
      listDesignSystems,
      listBlocks,
      listHarnesses,
      getWebhookSecret,
      regenerateWebhookSecret,
      testWebhookFire,
      deployPreflight,
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
    getWebhookSecret.mockReset();
    regenerateWebhookSecret.mockReset();
    deployPreflight.mockReset();
    testWebhookFire.mockReset();
    listDesignSystems.mockResolvedValue({ ok: true, data: [] });
    listBlocks.mockResolvedValue({ ok: true, data: [] });
    listHarnesses.mockResolvedValue({ ok: true, data: [] });
    getWebhookSecret.mockResolvedValue({
      ok: true,
      data: {
        secret: 'whsec_test_secret_value',
        rateLimit: { limit: 60, remaining: 59, resetAt: Date.now() + 60_000 },
      },
    });
    regenerateWebhookSecret.mockResolvedValue({
      ok: true,
      data: { secret: 'whsec_regenerated' },
    });
    testWebhookFire.mockResolvedValue({ ok: true, status: 200 });
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

  it('rejects control-char label and null-byte initial inputs JSON', async () => {
    const onPatchNodeData = vi.fn();
    const node = {
      id: 't1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { nodeType: 'trigger', label: 'Start', config: {} },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={node}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    const label = screen.getByDisplayValue('Start');
    fireEvent.change(label, { target: { value: `bad${'\0'}label` } });
    expect(onPatchNodeData).not.toHaveBeenCalled();

    const ta = screen.getByRole('textbox', { name: /Initial inputs/i });
    fireEvent.change(ta, { target: { value: `{"a":1${'\0'}}` } });
    // null-byte JSON never applied (no config patch)
    expect(
      onPatchNodeData.mock.calls.every(
        (c) => !(c[1] as { config?: { initialInputs?: unknown } })?.config?.initialInputs,
      ),
    ).toBe(true);
  });

  it('rejects null-byte workflow description when no node selected', async () => {
    const onUpdateDescription = vi.fn();
    render(
      <NodeConfigPanel
        selectedNode={null}
        validationIssues={[]}
        onPatchNodeData={() => {}}
        workflowDescription="ok"
        onUpdateDescription={onUpdateDescription}
      />,
    );
    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
    const ta = screen.getByRole('textbox');
    fireEvent.change(ta, { target: { value: `desc${'\0'}x` } });
    expect(onUpdateDescription).not.toHaveBeenCalled();
  });

  it('omits control-char design system options and rejects control-char selection', async () => {
    const onUpdateDesignSystemId = vi.fn();
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds-ok',
          name: 'Safe DS',
          path: '/x',
          hasManifest: false,
          hasTokens: false,
          hasComponents: false,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: `bad${'\0'}ds`,
          name: 'Evil DS',
          path: '/y',
          hasManifest: false,
          hasTokens: false,
          hasComponents: false,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '\nds-lead',
          name: 'Lead Ctrl',
          path: '/z',
          hasManifest: false,
          hasTokens: false,
          hasComponents: false,
          createdAt: '',
          updatedAt: '',
        },
        {
          id: '  pad-ds  ',
          name: 'Padded DS',
          path: '/p',
          hasManifest: false,
          hasTokens: false,
          hasComponents: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    render(
      <NodeConfigPanel
        selectedNode={null}
        validationIssues={[]}
        onPatchNodeData={() => {}}
        designSystemId=""
        onUpdateDesignSystemId={onUpdateDesignSystemId}
      />,
    );

    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
    const select = screen.getByRole('combobox');
    const values = Array.from(select.querySelectorAll('option')).map(
      (o) => (o as HTMLOptionElement).value,
    );
    expect(values).toContain('ds-ok');
    expect(values).toContain('pad-ds');
    expect(values.some((v) => v.includes('\0') || v.includes('\n'))).toBe(false);
    expect(values).not.toContain('ds-lead');
    expect(screen.queryByText('Evil DS')).not.toBeInTheDocument();
    expect(screen.queryByText('Lead Ctrl')).not.toBeInTheDocument();
    // Safe option labels present
    expect(screen.getByText('Safe DS')).toBeInTheDocument();
    expect(screen.getByText('Padded DS')).toBeInTheDocument();

    // Valid selection trims and applies
    fireEvent.change(select, { target: { value: 'ds-ok' } });
    expect(onUpdateDesignSystemId).toHaveBeenCalledWith('ds-ok');

    onUpdateDesignSystemId.mockClear();
    fireEvent.change(select, { target: { value: 'pad-ds' } });
    expect(onUpdateDesignSystemId).toHaveBeenCalledWith('pad-ds');

    // Clearing selection (None) is allowed
    onUpdateDesignSystemId.mockClear();
    fireEvent.change(select, { target: { value: '' } });
    expect(onUpdateDesignSystemId).toHaveBeenCalledWith('');
  });

  it('scrubs control-char design system option labels', async () => {
    listDesignSystems.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'ds-1',
          name: `Brand${'\0'}X${'\n'}Y`,
          path: '/x',
          hasManifest: false,
          hasTokens: false,
          hasComponents: false,
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    render(
      <NodeConfigPanel
        selectedNode={null}
        validationIssues={[]}
        onPatchNodeData={() => {}}
        designSystemId=""
        onUpdateDesignSystemId={() => {}}
      />,
    );

    await waitFor(() => expect(listDesignSystems).toHaveBeenCalled());
    // null stripped; newline collapsed
    expect(screen.getByRole('option', { name: 'BrandX Y' })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

  it('rejects null-byte system prompt and control-char web_search query', async () => {
    const onPatchNodeData = vi.fn();
    const agentNode = {
      id: 'a1',
      type: 'agent_coding',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'agent_coding',
        label: 'Agent',
        config: { systemPrompt: 'base' },
      },
    } as unknown as Node;

    const { rerender } = render(
      <NodeConfigPanel
        selectedNode={agentNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    const prompt = screen.getByDisplayValue('base');
    fireEvent.change(prompt, { target: { value: `sys${'\0'}prompt` } });
    expect(
      onPatchNodeData.mock.calls.every(
        (c) => !(c[1] as { config?: { systemPrompt?: string } })?.config?.systemPrompt?.includes('\0'),
      ),
    ).toBe(true);

    onPatchNodeData.mockClear();
    const searchNode = {
      id: 's1',
      type: 'web_search',
      position: { x: 0, y: 0 },
      data: { nodeType: 'web_search', label: 'Search', config: { query: 'neos' } },
    } as unknown as Node;
    rerender(
      <NodeConfigPanel
        selectedNode={searchNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );
    const query = screen.getByDisplayValue('neos');
    // Null-byte only — single-line inputs may strip bare \n/\r in jsdom
    fireEvent.change(query, { target: { value: `bad${'\0'}q` } });
    expect(onPatchNodeData).not.toHaveBeenCalled();
    // Valid update still works
    fireEvent.change(query, { target: { value: 'safe query' } });
    expect(onPatchNodeData).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ config: expect.objectContaining({ query: 'safe query' }) }),
    );
  });

  it('rejects control-char slack channel and null-byte text templates / media / deploy', async () => {
    const onPatchNodeData = vi.fn();
    const slackNode = {
      id: 'sl1',
      type: 'slack_message',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'slack_message',
        label: 'Slack',
        config: { channel: '#ok', textTemplate: 'hi' },
      },
    } as unknown as Node;

    const { rerender } = render(
      <NodeConfigPanel
        selectedNode={slackNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );

    fireEvent.change(screen.getByDisplayValue('#ok'), {
      target: { value: `ch${'\0'}x` },
    });
    expect(onPatchNodeData).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue('hi'), {
      target: { value: `tmpl${'\0'}x` },
    });
    expect(onPatchNodeData).not.toHaveBeenCalled();

    onPatchNodeData.mockClear();
    const mediaNode = {
      id: 'm1',
      type: 'media',
      position: { x: 0, y: 0 },
      data: { nodeType: 'media', label: 'Img', config: { mediaType: 'image', prompt: 'cat' } },
    } as unknown as Node;
    rerender(
      <NodeConfigPanel
        selectedNode={mediaNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('cat'), {
      target: { value: `p${'\0'}rompt` },
    });
    expect(onPatchNodeData).not.toHaveBeenCalled();

    onPatchNodeData.mockClear();
    const deployNode = {
      id: 'd1',
      type: 'deploy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'deploy',
        label: 'Deploy',
        config: { projectName: 'my-app', content: '<html/>' },
      },
    } as unknown as Node;
    rerender(
      <NodeConfigPanel
        selectedNode={deployNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );
    fireEvent.change(screen.getByDisplayValue('my-app'), {
      target: { value: `proj${'\0'}x` },
    });
    expect(onPatchNodeData).not.toHaveBeenCalled();
    fireEvent.change(screen.getByDisplayValue('<html/>'), {
      target: { value: `<html>${'\0'}</html>` },
    });
    expect(onPatchNodeData).not.toHaveBeenCalled();
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

  it('scrubs control chars in deploy preflight alert messages', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    deployPreflight.mockResolvedValue({
      ok: true,
      data: {
        ready: false,
        provider: `vercel${'\0'}x`,
        checks: [
          { ok: false, message: `token${'\n'}missing${'\0'}!` },
          { ok: true, message: 'project ok' },
        ],
      },
    });

    const deploy = {
      id: 'd1',
      type: 'deploy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'deploy',
        label: 'Deploy',
        config: { provider: 'vercel', projectName: 'site' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel selectedNode={deploy} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: /Run deploy preflight/i }));
    await waitFor(() => expect(deployPreflight).toHaveBeenCalled());
    expect(alertSpy).toHaveBeenCalled();
    const msg = String(alertSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toContain('vercelx');
    expect(msg).toContain('token missing!');
    expect(msg).not.toContain('\0');
    alertSpy.mockRestore();
  });

  it('scrubs control-char deploy preflight API errors', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    deployPreflight.mockResolvedValue({
      ok: false,
      error: `down${'\0'}err\nnext`,
    });

    const deploy = {
      id: 'd1',
      type: 'deploy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'deploy',
        label: 'Deploy',
        config: { provider: 'vercel', projectName: 'site' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel selectedNode={deploy} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: /Run deploy preflight/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('downerr next'));
    alertSpy.mockRestore();
  });

  it('falls back when deploy preflight error/check messages scrub empty; caps checks', async () => {
    const user = userEvent.setup();
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    deployPreflight.mockResolvedValueOnce({
      ok: false,
      error: String.fromCharCode(0) + String.fromCharCode(10),
    });

    const deploy = {
      id: 'd1',
      type: 'deploy',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'deploy',
        label: 'Deploy',
        config: { provider: 'vercel', projectName: 'site' },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel selectedNode={deploy} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    await user.click(screen.getByRole('button', { name: /Run deploy preflight/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Preflight failed'));

    // Empty check message → "check"; more than 40 checks truncated in alert body
    const checks = Array.from({ length: 45 }, (_, i) => ({
      ok: i % 2 === 0,
      message:
        i === 0
          ? String.fromCharCode(0) + String.fromCharCode(10)
          : `check-${i}`,
    }));
    deployPreflight.mockResolvedValueOnce({
      ok: true,
      data: { ready: true, provider: 'netlify', checks },
    });
    alertSpy.mockClear();
    await user.click(screen.getByRole('button', { name: /Run deploy preflight/i }));
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    const msg = String(alertSpy.mock.calls[0]?.[0] ?? '');
    expect(msg).toMatch(/Ready for netlify/);
    expect(msg).toContain('✓ check'); // empty message fallback
    // Cap 40: last indices beyond 40 not all present
    expect(msg).toContain('check-1');
    expect(msg).not.toContain('check-44');
    alertSpy.mockRestore();
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

  it('renders block node selector fields when blockId set', async () => {
    listBlocks.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'price_lookup',
          name: 'Price Lookup',
          domain: 'finance',
          category: 'market',
          description: 'lookup',
          isBuiltIn: true,
          implementationType: 'native',
          paramDefs: [{ key: 'symbol', label: 'Symbol', type: 'string' }],
        },
      ],
    });
    const onPatchNodeData = vi.fn();
    const blockNode = {
      id: 'b1',
      type: 'block',
      position: { x: 0, y: 0 },
      data: {
        nodeType: 'block',
        label: 'Price',
        config: { blockId: 'price_lookup', params: { symbol: '005930' } },
      },
    } as unknown as Node;

    render(
      <NodeConfigPanel
        selectedNode={blockNode}
        validationIssues={[]}
        onPatchNodeData={onPatchNodeData}
      />,
    );
    await waitFor(() => expect(listBlocks).toHaveBeenCalled());
    // Label and/or block-related UI should appear
    expect(screen.getByDisplayValue('Price')).toBeInTheDocument();
  });

  it('shows gate helper copy for parallel_end, or_gate, and output', () => {
    for (const [nodeType, copy] of [
      ['parallel_end', /Fan-in: waits for all upstream/i],
      ['or_gate', /first completed upstream/i],
      ['output', /no required settings/i],
      ['gate_or', /no required settings/i],
    ] as const) {
      const node = {
        id: `${nodeType}-1`,
        type: nodeType,
        position: { x: 0, y: 0 },
        data: { nodeType, label: nodeType, config: {} },
      } as unknown as Node;
      const { unmount } = render(
        <NodeConfigPanel selectedNode={node} validationIssues={[]} onPatchNodeData={() => {}} />,
      );
      expect(screen.getByText(copy)).toBeInTheDocument();
      unmount();
    }
  });

  it('renders webhook section when no node selected under /workflows/:id', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const prev = window.location.pathname;
    window.history.pushState({}, '', '/workflows/wf-webhook-1');

    render(
      <NodeConfigPanel selectedNode={null} validationIssues={[]} onPatchNodeData={() => {}} />,
    );

    await waitFor(() => expect(getWebhookSecret).toHaveBeenCalledWith('wf-webhook-1'));
    expect(screen.getByText('Webhook')).toBeInTheDocument();
    expect(screen.getByText(/POST http:\/\/127\.0\.0\.1:57286\/api\/webhook\/wf-webhook-1/)).toBeInTheDocument();
    expect(screen.getByText(/Rate limit: 59\/60 remaining/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy URL' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.getByText('URL copied')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show' }));
    expect(screen.getByText('whsec_test_secret_value')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Test fire' }));
    await waitFor(() => expect(testWebhookFire).toHaveBeenCalledWith('wf-webhook-1', { source: 'config-test-fire' }));
    await waitFor(() => expect(screen.getByText(/Webhook fired/)).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(regenerateWebhookSecret).toHaveBeenCalledWith('wf-webhook-1');
    });
    // After regenerate, masked or full secret should still be present
    expect(screen.getByRole('button', { name: 'Hide' })).toBeInTheDocument();
    expect(screen.getByText(/whsec_/)).toBeInTheDocument();

    window.history.pushState({}, '', prev || '/');
  });

  it('scrubs control-char webhook fire error flash messages', async () => {
    const user = userEvent.setup();
    const prev = window.location.pathname + window.location.search;
    window.history.pushState({}, '', '/workflows/wf-webhook-2');
    testWebhookFire.mockResolvedValue({
      ok: false,
      error: `rate${'\n'}limited${'\0'}!`,
    });

    render(
      <NodeConfigPanel
        selectedNode={null}
        validationIssues={[]}
        onPatchNodeData={() => {}}
      />,
    );
    await waitFor(() => expect(getWebhookSecret).toHaveBeenCalledWith('wf-webhook-2'));
    await user.click(screen.getByRole('button', { name: 'Test fire' }));
    await waitFor(() => {
      expect(screen.getByText(/rate limited!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    window.history.pushState({}, '', prev || '/');
  });

  it('flashes scrubbed error when webhook secret regenerate fails', async () => {
    const user = userEvent.setup();
    const prev = window.location.pathname + window.location.search;
    window.history.pushState({}, '', '/workflows/wf-webhook-regen-fail');
    regenerateWebhookSecret.mockResolvedValue({
      ok: false,
      error: `regen${'\n'}denied${'\0'}!`,
    });

    render(
      <NodeConfigPanel selectedNode={null} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    await waitFor(() =>
      expect(getWebhookSecret).toHaveBeenCalledWith('wf-webhook-regen-fail'),
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(regenerateWebhookSecret).toHaveBeenCalledWith('wf-webhook-regen-fail');
      expect(screen.getByText(/regen denied!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    window.history.pushState({}, '', prev || '/');
  });

  it('flashes scrubbed error when webhook regenerate throws', async () => {
    const user = userEvent.setup();
    const prev = window.location.pathname + window.location.search;
    window.history.pushState({}, '', '/workflows/wf-webhook-regen-throw');
    regenerateWebhookSecret.mockRejectedValue(new Error(`net${'\n'}down${'\0'}!`));

    render(
      <NodeConfigPanel selectedNode={null} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    await waitFor(() =>
      expect(getWebhookSecret).toHaveBeenCalledWith('wf-webhook-regen-throw'),
    );
    await user.click(screen.getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => {
      expect(regenerateWebhookSecret).toHaveBeenCalled();
      expect(screen.getByText(/net down!/)).toBeInTheDocument();
    });
    expect(document.body.textContent).not.toContain('\0');
    window.history.pushState({}, '', prev || '/');
  });

  it('scrubs webhook secret display and empty fire error fallback; copies scrubbed secret', async () => {
    const user = userEvent.setup();
    const prev = window.location.pathname + window.location.search;
    window.history.pushState({}, '', '/workflows/wf-webhook-3');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    getWebhookSecret.mockResolvedValue({
      ok: true,
      data: {
        secret: 'whsec_' + String.fromCharCode(0) + 'abc' + String.fromCharCode(10) + 'xyz',
        rateLimit: { limit: 60, remaining: 59, resetAt: Date.now() + 60_000 },
      },
    });
    testWebhookFire.mockResolvedValue({
      ok: false,
      error: String.fromCharCode(0) + String.fromCharCode(10),
    });

    render(
      <NodeConfigPanel selectedNode={null} validationIssues={[]} onPatchNodeData={() => {}} />,
    );
    await waitFor(() => expect(getWebhookSecret).toHaveBeenCalledWith('wf-webhook-3'));

    // Store-time sanitize drops null/CR/LF from secret
    expect(document.body.textContent).not.toContain('\0');
    await user.click(screen.getByRole('button', { name: /^Show$/i }));
    // Control chars stripped at store → continuous secret
    expect(document.body.textContent).toMatch(/whsec_abcxyz/);
    expect(document.body.textContent).not.toContain('\0');

    await user.click(screen.getByRole('button', { name: 'Test fire' }));
    await waitFor(() => {
      expect(screen.getByText(/Fire failed/)).toBeInTheDocument();
    });

    // Secret row "Copy" (not "Copy URL" / "Copy curl")
    const copyBtns = screen.getAllByRole('button', { name: /^Copy$/i });
    expect(copyBtns.length).toBeGreaterThan(0);
    await user.click(copyBtns[copyBtns.length - 1]!);
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0]?.[0] ?? '');
    expect(copied).not.toContain('\0');
    expect(copied).not.toMatch(/[\r\n]/);
    expect(copied).toBe('whsec_abcxyz');

    window.history.pushState({}, '', prev || '/');
  });

  it('scrubs control-char validation issue messages', () => {
    const node = {
      id: 't1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { nodeType: 'trigger', label: 'Start', config: {} },
    } as unknown as import('@xyflow/react').Node;
    render(
      <NodeConfigPanel
        selectedNode={node}
        validationIssues={[
          {
            code: 'test',
            severity: 'error',
            nodeId: 't1',
            message: 'bad' + String.fromCharCode(0) + 'msg' + String.fromCharCode(10) + 'line',
          },
        ]}
        onPatchNodeData={() => {}}
      />,
    );
    expect(screen.getByText(/badmsg line/)).toBeInTheDocument();
  });

  it('falls back to issue code when message scrubs empty', () => {
    const node = {
      id: 't1',
      type: 'trigger',
      position: { x: 0, y: 0 },
      data: { nodeType: 'trigger', label: 'Start', config: {} },
    } as unknown as import('@xyflow/react').Node;
    render(
      <NodeConfigPanel
        selectedNode={node}
        validationIssues={[
          {
            code: 'MISSING_TRIGGER',
            severity: 'error',
            nodeId: 't1',
            message: String.fromCharCode(0) + String.fromCharCode(10) + String.fromCharCode(13),
          },
        ]}
        onPatchNodeData={() => {}}
      />,
    );
    expect(screen.getByText('MISSING_TRIGGER')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('\0');
  });

});
