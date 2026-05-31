import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams, useBlocker } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { Workflow, WorkflowBlock, WorkflowSSEEvent } from '../lib/engine.js';
import { NodeConfigPanel } from '../components/workflow/NodeConfigPanel.js';
import { RunHistoryPanel } from '../components/workflow/RunHistoryPanel.js';
import { RunInputsDialog } from '../components/workflow/RunInputsDialog.js';
import { ConfirmLeaveModal } from '../components/workflow/ConfirmLeaveModal.js';
import { validateWorkflowDraft } from '../components/workflow/WorkflowValidation.js';
import { autoLayout } from '../lib/layout.js';
import { RevisionPanel } from '../components/workflow/RevisionPanel.js';
import { ArtifactPreview } from '../components/workflow/ArtifactPreview.js';

// ── Node color palette ─────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  trigger:         '#6b7280',
  agent_finance:   '#10b981',
  agent_coding:    '#3b82f6',
  block:           '#f59e0b',
  gate_and:        '#f59e0b',
  gate_or:         '#f97316',
  web_search:      '#8b5cf6',
  slack_message:   '#4CAF50',
  discord_message: '#5865F2',
  output:          '#6b7280',
};

const NODE_TYPES_LIST = [
  { type: 'trigger',         label: 'Trigger',         group: 'flow' },
  { type: 'agent_finance',   label: 'Finance Agent',   group: 'agent' },
  { type: 'agent_coding',    label: 'Coding Agent',    group: 'agent' },
  { type: 'web_search',      label: 'Web Search',      group: 'tool' },
  { type: 'slack_message',   label: 'Slack Message',   group: 'tool' },
  { type: 'discord_message', label: 'Discord Message', group: 'tool' },
  { type: 'gate_and',        label: 'AND Gate',        group: 'gate' },
  { type: 'gate_or',         label: 'OR Gate',         group: 'gate' },
  { type: 'block',           label: 'Block',           group: 'block' },
  { type: 'output',          label: 'Output',          group: 'flow' },
] as const;

// ── Custom node component ─────────────────────────────────

function WorkflowNodeComponent({ data }: { data: { label: string; nodeType: string; isRunning?: boolean; isDone?: boolean; isFailed?: boolean } }) {
  const color = NODE_COLORS[data.nodeType] ?? '#6b7280';
  const borderColor = data.isFailed ? '#ef4444' : data.isDone ? '#22c55e' : data.isRunning ? '#facc15' : color;
  return (
    <div
      className="min-w-[130px] rounded-xl border-2 px-3 py-2 text-center text-xs font-medium text-white shadow-md"
      style={{ backgroundColor: color + 'cc', borderColor }}
    >
      {data.label}
      {data.isRunning && <span className="ml-1 animate-pulse">⏳</span>}
      {data.isDone && <span className="ml-1">✓</span>}
      {data.isFailed && <span className="ml-1">✗</span>}
    </div>
  );
}

const customNodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeComponent,
};

type RightPanelTab = 'config' | 'run' | 'history' | 'preview';

function buildWorkflowDraft(nodes: Node[], edges: Edge[], description?: string, designSystemId?: string) {
  return {
    description,
    designSystemId: designSystemId || undefined,
    nodes: nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType as string,
      label: n.data.label as string,
      position: n.position,
      config: (n.data.config as Record<string, unknown>) ?? {},
    })),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label as string | undefined,
    })),
  };
}

// ── WorkflowEditor ────────────────────────────────────────

function toReactFlowNodes(wf: Workflow, runStatuses: Record<string, string>): Node[] {
  return wf.nodes.map((n) => ({
    id: n.id,
    type: 'workflowNode',
    position: n.position,
    data: {
      label: n.label,
      nodeType: n.type,
      config: n.config,
      isRunning: runStatuses[n.id] === 'running',
      isDone: runStatuses[n.id] === 'completed',
      isFailed: runStatuses[n.id] === 'failed',
    },
  }));
}

function toReactFlowEdges(wf: Workflow): Edge[] {
  return wf.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label }));
}

export function WorkflowEditor() {
  const { id } = useParams<{ id: string }>();
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { client } = useEngine();
  const { fitView } = useReactFlow();

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [savedDraft, setSavedDraft] = useState<ReturnType<typeof buildWorkflowDraft> | null>(null);
  const [workflowDescription, setWorkflowDescription] = useState('');
  const [designSystemId, setDesignSystemId] = useState<string>('');
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [runStatuses, setRunStatuses] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runEvents, setRunEvents] = useState<WorkflowSSEEvent[]>([]);
  const [expandedRunLogIdx, setExpandedRunLogIdx] = useState<number | null>(null);
  const [runInputsOpen, setRunInputsOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('config');
  const [allBlocks, setAllBlocks] = useState<WorkflowBlock[]>([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [revisionPanelOpen, setRevisionPanelOpen] = useState(false);
  const [latestArtifactId, setLatestArtifactId] = useState<string | undefined>(undefined);

  const stopRef = useRef<(() => void) | null>(null);

  const loadWorkflow = useCallback(async () => {
    if (!client || !id) return;
    const res = await client.getWorkflow(id);
    if (res.ok && res.data) {
      setWorkflow(res.data);
      setWorkflowDescription(res.data.description ?? '');
      setDesignSystemId(res.data.designSystemId ?? '');
      const rfNodes = toReactFlowNodes(res.data, {});
      const rfEdges = toReactFlowEdges(res.data);
      setNodes(rfNodes);
      setEdges(rfEdges);
      setSavedDraft(buildWorkflowDraft(rfNodes, rfEdges, res.data.description ?? '', res.data.designSystemId ?? ''));
    }
  }, [client, id, setNodes, setEdges]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;

    client.listBlocks().then((res) => {
      if (!cancelled && res.ok && res.data) setAllBlocks(res.data);
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [client]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData('nodeType');
      if (!nodeType) return;
      const typeDef = NODE_TYPES_LIST.find((t) => t.type === nodeType);
      if (!typeDef) return;
      const newNode: Node = {
        id: crypto.randomUUID(),
        type: 'workflowNode',
        position: { x: e.nativeEvent.offsetX - 65, y: e.nativeEvent.offsetY - 16 },
        data: { label: typeDef.label, nodeType, config: {} },
      };
      setNodes((nds) => [...nds, newNode]);
    },
    [setNodes],
  );

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const draft = useMemo(() => buildWorkflowDraft(nodes, edges, workflowDescription, designSystemId), [nodes, edges, workflowDescription, designSystemId]);
  const validationIssues = useMemo(
    () => validateWorkflowDraft({ nodes: draft.nodes, edges: draft.edges, blocks: allBlocks }),
    [draft, allBlocks],
  );
  const hasValidationErrors = validationIssues.some((issue) => issue.severity === 'error');

  const isDirty = useMemo(() => {
    if (!savedDraft) return false;
    return JSON.stringify(draft) !== JSON.stringify(savedDraft);
  }, [draft, savedDraft]);

  const blocker = useBlocker(isDirty);

  const nodeLabelMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const n of nodes) {
      map[n.id] = String(n.data.label ?? n.id);
    }
    return map;
  }, [nodes]);

  // beforeunload 경고: dirty 상태에서 이탈 시
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const patchNodeData = useCallback((nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => {
    setNodes((current) =>
      current.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          ...node,
          data: {
            ...node.data,
            label: patch.label ?? node.data.label,
            config: patch.config ?? node.data.config,
          },
        };
      }),
    );
  }, [setNodes]);

  const handleNameCommit = async () => {
    const trimmed = nameInput.trim().slice(0, 200);
    setEditingName(false);
    if (!trimmed || !client || !workflow || trimmed === workflow.name) return;
    const res = await client.updateWorkflow(workflow.id, { ...draft, name: trimmed });
    if (res.ok && res.data) setWorkflow(res.data);
  };

  const handleSave = async () => {
    if (!client || !workflow) return;
    setSaving(true);
    const res = await client.updateWorkflow(workflow.id, draft);
    if (res.ok && res.data) {
      setWorkflow(res.data);
      setSavedDraft(draft);
    }
    setSaving(false);
    if (validationIssues.length > 0) setRightPanelTab('config');
  };

  const handleRun = async (inputs?: Record<string, unknown>) => {
    if (!client || !workflow) return;
    if (hasValidationErrors) {
      setRightPanelTab('config');
      return;
    }
    const saveRes = await client.updateWorkflow(workflow.id, draft);
    if (saveRes.ok && saveRes.data) {
      setWorkflow(saveRes.data);
      setSavedDraft(draft);
    }
    setIsRunning(true);
    setRightPanelTab('run');
    setRunEvents([]);
    setRunStatuses({});
    setExpandedRunLogIdx(null);
    const stop = client.runWorkflow(workflow.id, (event) => {
      setRunEvents((prev) => [...prev, event]);
      if (event.type === 'node.started') {
        setRunStatuses((prev) => ({ ...prev, [event.nodeId]: 'running' }));
      }
      if (event.type === 'node.completed') {
        setRunStatuses((prev) => ({ ...prev, [event.nodeId]: 'completed' }));
      }
      if (event.type === 'node.failed') {
        setRunStatuses((prev) => ({ ...prev, [event.nodeId]: 'failed' }));
      }
      if (event.type === 'run.completed') {
        setIsRunning(false);
        setHistoryRefreshKey((key) => key + 1);
        if ((event as { artifactId?: string }).artifactId) {
          setLatestArtifactId((event as { artifactId?: string }).artifactId);
          setRightPanelTab('preview');
        }
      }
      if (event.type === 'run.failed') {
        setIsRunning(false);
        setHistoryRefreshKey((key) => key + 1);
      }
    }, inputs);
    stopRef.current = stop;
  };

  const handleStop = () => {
    stopRef.current?.();
    setIsRunning(false);
  };

  const handleAutoLayout = useCallback(() => {
    setNodes((current) => {
      const laid = autoLayout(current, edges);
      // fitView needs a tick to see new positions
      setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50);
      return laid;
    });
  }, [edges, fitView, setNodes]);

  // Sync run statuses to node styles — preserve existing data (including config)
  useEffect(() => {
    if (!workflow) return;
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          isRunning: runStatuses[n.id] === 'running',
          isDone: runStatuses[n.id] === 'completed',
          isFailed: runStatuses[n.id] === 'failed',
        },
      })),
    );
  }, [runStatuses, workflow, setNodes]);

  if (!workflow) {
    return (
      <div className="flex h-full items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ backgroundColor: 'var(--bg-secondary)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-3 border-b px-4 py-2" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
        <button
          onClick={() => navigate('/workflows')}
          className="text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          ← {t('nav.workflows')}
        </button>
        <span className="mx-1 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {editingName ? (
            <input
              autoFocus
              className="rounded border px-1 text-sm font-semibold"
              style={{
                backgroundColor: 'var(--bg-tertiary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                width: '160px',
              }}
              value={nameInput}
              maxLength={200}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => void handleNameCommit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleNameCommit();
                if (e.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <span
              className="cursor-text hover:opacity-80"
              onClick={() => { setNameInput(workflow.name); setEditingName(true); }}
              title={t('workflow.rename')}
            >
              {workflow.name}
            </span>
          )}
          {isDirty && (
            <span className="ml-1 select-none text-yellow-400" title="Unsaved changes">•</span>
          )}
        </span>
        <div className="flex-1" />
        <button
          onClick={handleAutoLayout}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Auto Layout (TB)"
        >
          ⬡ Layout
        </button>
        <button
          onClick={() => setRevisionPanelOpen(true)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Version History"
        >
          🕐 History
        </button>
        <button
          onClick={() => client?.exportWorkflow(workflow.id, workflow.name)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title={t('workflow.export')}
        >
          {t('workflow.export')} (JSON)
        </button>
        <button
          onClick={() => client?.exportWorkflowZip(workflow.id, workflow.name)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Export as ZIP"
        >
          Export (ZIP)
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
        >
          {saving ? '...' : t('common.save')}
        </button>
        {isRunning ? (
          <button
            onClick={handleStop}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-400"
            style={{ backgroundColor: '#450a0a33' }}
          >
            {t('workflow.stop')}
          </button>
        ) : (
          <button
            onClick={() => setRunInputsOpen(true)}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-white"
            style={{ backgroundColor: '#10b981' }}
          >
            ▶ {t('workflow.run')}
          </button>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Node Palette */}
        <aside className="flex w-44 flex-col gap-1 overflow-y-auto border-r p-3" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
          <p className="mb-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {t('workflow.nodes')}
          </p>
          {NODE_TYPES_LIST.map((item) => (
            <div
              key={item.type}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('nodeType', item.type)}
              className="cursor-grab rounded-lg px-2 py-1.5 text-xs font-medium text-white"
              style={{ backgroundColor: NODE_COLORS[item.type] + 'cc' }}
            >
              {item.label}
            </div>
          ))}
        </aside>

        {/* React Flow Canvas */}
        <div
          className="flex-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={customNodeTypes}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id);
              setRightPanelTab('config');
            }}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Config / Run / History panel */}
        <aside className="flex w-72 flex-col border-l" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
          <div className="flex border-b" style={{ borderColor: 'var(--border-primary)' }}>
            {(['config', 'run', 'history', 'preview'] as RightPanelTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setRightPanelTab(tab)}
                className="flex-1 px-2 py-2 text-xs font-medium"
                style={{
                  color: rightPanelTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
                  backgroundColor: rightPanelTab === tab ? 'var(--bg-secondary)' : 'transparent',
                }}
              >
                {tab === 'config' && t('workflow.config')}
                {tab === 'run' && t('workflow.runLog')}
                {tab === 'history' && t('workflow.history')}
                {tab === 'preview' && '🖼 Preview'}
              </button>
            ))}
          </div>

          {rightPanelTab === 'config' && (
            <div className="flex-1 overflow-y-auto">
              <NodeConfigPanel
                selectedNode={selectedNode}
                validationIssues={validationIssues}
                onPatchNodeData={patchNodeData}
                workflowDescription={workflowDescription}
                onUpdateDescription={setWorkflowDescription}
                designSystemId={designSystemId}
                onUpdateDesignSystemId={setDesignSystemId}
              />
            </div>
          )}

          {rightPanelTab === 'run' && (
            <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
              {runEvents.map((ev, i) => {
                const nodeLabel = 'nodeId' in ev
                  ? (nodeLabelMap[(ev as { nodeId: string }).nodeId] ?? (ev as { nodeId: string }).nodeId)
                  : null;
                const isExpanded = expandedRunLogIdx === i;
                const hasOutput = ev.type === 'node.completed' && (ev as { output?: unknown }).output !== undefined;
                return (
                  <div
                    key={i}
                    className={`rounded px-2 py-1${hasOutput ? ' cursor-pointer' : ''}`}
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                    onClick={() => hasOutput && setExpandedRunLogIdx(isExpanded ? null : i)}
                  >
                    {ev.type === 'node.started' && `▶ ${nodeLabel} (${(ev as { nodeType: string }).nodeType})`}
                    {ev.type === 'node.completed' && `✓ ${nodeLabel}${hasOutput ? ' ▸' : ''}`}
                    {ev.type === 'node.failed' && `✗ ${nodeLabel}: ${(ev as { error: string }).error}`}
                    {ev.type === 'run.started' && `Run ${(ev as { runId: string }).runId.slice(0, 8)}`}
                    {ev.type === 'run.completed' && `${t('workflow.done')} (${(ev as { duration: number }).duration}ms)`}
                    {ev.type === 'run.failed' && (ev as { error: string }).error}
                    {isExpanded && hasOutput && (
                      <pre
                        className="mt-1 overflow-x-auto rounded p-1 text-[10px]"
                        style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
                      >
                        {JSON.stringify((ev as { output: unknown }).output, null, 2).slice(0, 400)}
                      </pre>
                    )}
                  </div>
                );
              })}
              {runEvents.length === 0 && (
                <p style={{ color: 'var(--text-muted)' }}>{t('workflow.noRuns')}</p>
              )}
            </div>
          )}

          {rightPanelTab === 'history' && (
            <RunHistoryPanel workflowId={workflow.id} refreshKey={historyRefreshKey} nodeLabelMap={nodeLabelMap} />
          )}

          {rightPanelTab === 'preview' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <ArtifactPreview
                workflowId={workflow.id}
                latestArtifactId={latestArtifactId}
              />
            </div>
          )}

          {rightPanelTab !== 'config' && hasValidationErrors && (
            <div className="border-t p-2 text-[11px] text-red-300" style={{ borderColor: 'var(--border-primary)', backgroundColor: '#450a0a33' }}>
              {validationIssues.filter((issue) => issue.severity === 'error').length} validation errors block execution.
            </div>
          )}
        </aside>
      </div>

      {runInputsOpen && (
        <RunInputsDialog
          defaultInputs={
            (draft.nodes.find((n) => n.type === 'trigger')?.config?.initialInputs as Record<string, unknown> | undefined)
          }
          onConfirm={(inputs) => { setRunInputsOpen(false); void handleRun(inputs); }}
          onCancel={() => setRunInputsOpen(false)}
        />
      )}

      {blocker.state === 'blocked' && (
        <ConfirmLeaveModal
          onConfirm={() => blocker.proceed?.()}
          onCancel={() => blocker.reset?.()}
        />
      )}

      {revisionPanelOpen && client && (
        <RevisionPanel
          workflowId={workflow.id}
          client={client}
          onClose={() => setRevisionPanelOpen(false)}
          onRestore={(snap) => {
            if (Array.isArray(snap.nodes) && Array.isArray(snap.edges)) {
              const rfNodes = snap.nodes.map((n: unknown) => {
                const node = n as { id: string; type: string; label: string; position: { x: number; y: number }; config?: Record<string, unknown> };
                return {
                  id: node.id,
                  type: 'workflowNode',
                  position: node.position,
                  data: { label: node.label, nodeType: node.type, config: node.config ?? {} },
                };
              });
              const rfEdges = snap.edges.map((e: unknown) => {
                const edge = e as { id: string; source: string; target: string; label?: string };
                return { id: edge.id, source: edge.source, target: edge.target, label: edge.label };
              });
              setNodes(rfNodes);
              setEdges(rfEdges);
            }
          }}
        />
      )}
    </div>
  );
}
