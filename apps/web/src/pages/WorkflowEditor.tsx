/**
 * Web Workflow graph editor (v0.24 + v0.27 v2).
 * Palette (desktop types) · per-type config · run history · save · run SSE.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ALL_MODELS } from '@neos-work/shared';
import { clearConnection, loadConnection } from '../lib/auth.js';
import { ApiError, WebApiClient } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';
import {
  buildWorkflowDraft,
  toReactFlowEdges,
  toReactFlowNodes,
} from '../lib/workflow-draft.js';

const NODE_COLORS: Record<string, string> = {
  trigger: '#6b7280',
  agent: '#8b5cf6',
  block: '#f59e0b',
  output: '#6b7280',
  gate_and: '#f59e0b',
  gate_or: '#f97316',
  or_gate: '#f97316',
  parallel_start: '#0ea5e9',
  parallel_end: '#0ea5e9',
  web_search: '#8b5cf6',
  slack_message: '#4CAF50',
  discord_message: '#5865F2',
  media: '#ec4899',
  deploy: '#14b8a6',
};

type PaletteItem = {
  type: string;
  label: string;
  group: 'control' | 'agent' | 'block' | 'delivery';
  pack: string;
  paletteKey?: string;
  defaultWorkerId?: string;
  defaultMode?: string;
  defaultConfig?: Record<string, unknown>;
};

/** Desktop-aligned palette (v0.27). Agent variants drop as type `agent`. */
const PALETTE: PaletteItem[] = [
  { type: 'trigger', label: 'Trigger', group: 'control', pack: 'control' },
  { type: 'output', label: 'Output', group: 'control', pack: 'control' },
  { type: 'gate_and', label: 'AND Gate', group: 'control', pack: 'control' },
  { type: 'gate_or', label: 'OR Gate (logic)', group: 'control', pack: 'control' },
  { type: 'or_gate', label: 'OR Gate (race)', group: 'control', pack: 'control' },
  { type: 'parallel_start', label: 'Parallel Start', group: 'control', pack: 'control' },
  { type: 'parallel_end', label: 'Parallel End', group: 'control', pack: 'control' },
  {
    type: 'agent',
    label: 'Agent',
    group: 'agent',
    pack: 'general',
    defaultWorkerId: 'general_generalist',
    defaultMode: 'solo',
  },
  {
    type: 'agent',
    label: 'Coordinator',
    group: 'agent',
    pack: 'general',
    paletteKey: 'agent_coordinator',
    defaultWorkerId: 'general_coordinator',
    defaultMode: 'coordinator',
  },
  {
    type: 'agent',
    label: 'Finance Analyst',
    group: 'agent',
    pack: 'finance',
    paletteKey: 'agent_finance',
    defaultWorkerId: 'finance_analyst',
    defaultMode: 'solo',
  },
  {
    type: 'agent',
    label: 'Coding Reviewer',
    group: 'agent',
    pack: 'coding',
    paletteKey: 'agent_coding',
    defaultWorkerId: 'coding_reviewer',
    defaultMode: 'solo',
  },
  {
    type: 'agent',
    label: 'Research Web',
    group: 'agent',
    pack: 'research',
    paletteKey: 'agent_research',
    defaultWorkerId: 'research_web',
    defaultMode: 'solo',
  },
  { type: 'block', label: 'Block', group: 'block', pack: 'general' },
  { type: 'web_search', label: 'Web Search', group: 'delivery', pack: 'research' },
  { type: 'slack_message', label: 'Slack Message', group: 'delivery', pack: 'delivery' },
  { type: 'discord_message', label: 'Discord Message', group: 'delivery', pack: 'delivery' },
  {
    type: 'media',
    label: 'Media',
    group: 'delivery',
    pack: 'delivery',
    defaultConfig: { mediaType: 'image', mediaProvider: 'openai' },
  },
  {
    type: 'deploy',
    label: 'Deploy',
    group: 'delivery',
    pack: 'delivery',
    defaultConfig: { provider: 'vercel' },
  },
];

const PALETTE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'control', label: 'Control' },
  { id: 'agent', label: 'Agents' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'finance', label: 'Finance' },
  { id: 'coding', label: 'Coding' },
  { id: 'research', label: 'Research' },
  { id: 'general', label: 'General' },
] as const;

type PaletteTabId = (typeof PALETTE_TABS)[number]['id'];

const LLM_PROVIDERS = [
  'anthropic',
  'google',
  'openai',
  'ollama',
  'cli-claude',
  'cli-gemini',
  'cli-codex',
] as const;

function scrubText(raw: unknown, max = 200): string {
  if (raw == null) return '';
  const s = typeof raw === 'string' ? raw : String(raw);
  return s.replace(/[\0\r\n]+/g, ' ').slice(0, max).trim();
}

function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

type NodeData = {
  label: string;
  nodeType: string;
  config?: Record<string, unknown>;
  isRunning?: boolean;
  isDone?: boolean;
  isFailed?: boolean;
};

export function WorkflowNodeComponent({ data }: NodeProps) {
  const d = data as NodeData;
  const color = NODE_COLORS[d.nodeType] ?? '#6b7280';
  const borderColor = d.isFailed
    ? '#ef4444'
    : d.isDone
      ? '#22c55e'
      : d.isRunning
        ? '#facc15'
        : color;
  const label =
    scrubText(d.label, 80) || scrubText(d.nodeType, 40) || 'node';
  return (
    <div
      data-testid="workflow-canvas-node"
      style={{
        minWidth: 120,
        borderRadius: 12,
        border: `2px solid ${borderColor}`,
        padding: '8px 12px',
        textAlign: 'center',
        fontSize: 12,
        fontWeight: 600,
        color: '#fff',
        backgroundColor: color + 'cc',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}
    >
      <Handle type="target" position={Position.Left} />
      {label}
      {d.isRunning ? ' ⏳' : ''}
      {d.isDone ? ' ✓' : ''}
      {d.isFailed ? ' ✗' : ''}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const customNodeTypes: NodeTypes = {
  workflowNode: WorkflowNodeComponent,
};

export function WorkflowEditor() {
  return (
    <ReactFlowProvider>
      <WorkflowEditorInner />
    </ReactFlowProvider>
  );
}

function WorkflowEditorInner() {
  const { id: routeId } = useParams<{ id: string }>();
  const nav = useNavigate();
  const conn = loadConnection();
  const client = useMemo(
    () => new WebApiClient(conn.serverUrl, conn.token),
    [conn.serverUrl, conn.token],
  );

  const workflowId =
    typeof routeId === 'string' && routeId.trim() && !/[\0\r\n]/.test(routeId)
      ? routeId.trim()
      : '';

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteTab, setPaletteTab] = useState<PaletteTabId>('all');
  const [workers, setWorkers] = useState<Array<{ id: string; name: string; domain?: string }>>([]);
  const [blocks, setBlocks] = useState<Array<{ id: string; name: string; domain?: string }>>([]);
  const [runs, setRuns] = useState<
    Array<{ id: string; status: string; startedAt?: string; completedAt?: string; error?: string }>
  >([]);
  const [runsError, setRunsError] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const stopRunRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  const requestLeave = useCallback(
    (to: string) => {
      if (!dirty) {
        nav(to);
        return;
      }
      setLeaveTo(to);
    },
    [dirty, nav],
  );

  const handleAuthError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        clearConnection();
        nav('/');
        return true;
      }
      return false;
    },
    [nav],
  );

  const loadRuns = useCallback(async () => {
    if (!workflowId || !conn.token) return;
    setRunsLoading(true);
    setRunsError(null);
    try {
      const res = await client.listWorkflowRuns(workflowId, 20, 0);
      if (!res.ok) {
        setRuns([]);
        setRunsError(scrubError(res.error, 'Failed to load runs'));
        return;
      }
      setRuns(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      setRuns([]);
      setRunsError(scrubError(err, 'Failed to load runs'));
    } finally {
      setRunsLoading(false);
    }
  }, [client, conn.token, workflowId]);

  useEffect(() => {
    if (!conn.token) return;
    void client.listWorkers().then((res) => {
      if (res.ok && Array.isArray(res.data)) setWorkers(res.data);
    }).catch(() => {});
    void client.listBlocks().then((res) => {
      if (res.ok && Array.isArray(res.data)) setBlocks(res.data);
    }).catch(() => {});
  }, [client, conn.token]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const load = useCallback(async () => {
    if (!conn.token) {
      nav('/');
      return;
    }
    if (!workflowId) {
      setError('Invalid workflow id');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await client.getWorkflow(workflowId);
      if (!res.ok || !res.data) {
        setError(scrubError(res.error, 'Failed to load workflow'));
        setLoading(false);
        return;
      }
      const wf = res.data;
      setName(scrubText(wf.name, 200) || workflowId);
      setDescription(
        typeof wf.description === 'string' && !/\0/.test(wf.description)
          ? wf.description
          : '',
      );
      const graph = {
        nodes: Array.isArray(wf.nodes)
          ? wf.nodes.map((n) => ({
              id: String(n.id),
              type: String(n.type ?? 'trigger'),
              label: String(n.label ?? n.id),
              position: n.position ?? { x: 0, y: 0 },
              config:
                n.config && typeof n.config === 'object'
                  ? (n.config as Record<string, unknown>)
                  : {},
            }))
          : [],
        edges: Array.isArray(wf.edges)
          ? wf.edges.map((e) => ({
              id: String(e.id),
              source: String(e.source),
              target: String(e.target),
              label: e.label,
            }))
          : [],
      };
      setNodes(toReactFlowNodes(graph, {}));
      setEdges(toReactFlowEdges(graph));
      setDirty(false);
      setSelectedId(null);
    } catch (err) {
      setError(scrubError(err, 'Failed to load workflow'));
      if (handleAuthError(err)) return;
    } finally {
      setLoading(false);
    }
  }, [client, conn.token, workflowId, nav, handleAuthError, setNodes, setEdges]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      stopRunRef.current?.();
      stopRunRef.current = null;
    };
  }, []);

  const markDirty = useCallback(() => setDirty(true), []);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, id: newId('e') }, eds));
      markDirty();
    },
    [setEdges, markDirty],
  );

  const onNodeClick = useCallback((_: ReactMouseEvent, node: Node) => {
    setSelectedId(node.id);
  }, []);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId],
  );

  const updateSelected = (patch: {
    label?: string;
    config?: Record<string, unknown>;
  }) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const data = { ...(n.data as NodeData) };
        if (patch.label !== undefined) {
          data.label = patch.label;
        }
        if (patch.config) {
          data.config = { ...(data.config ?? {}), ...patch.config };
        }
        return { ...n, data };
      }),
    );
    markDirty();
  };

  const cfg = (selectedNode?.data as NodeData | undefined)?.config ?? {};
  const nodeType = String((selectedNode?.data as NodeData | undefined)?.nodeType ?? '');

  const onDragStart = (e: DragEvent, item: PaletteItem) => {
    e.dataTransfer.setData('application/neos-node-type', item.type);
    e.dataTransfer.setData('application/neos-node-label', item.label);
    if (item.defaultWorkerId) {
      e.dataTransfer.setData('application/neos-worker-id', item.defaultWorkerId);
    }
    if (item.defaultMode) {
      e.dataTransfer.setData('application/neos-mode', item.defaultMode);
    }
    if (item.defaultConfig) {
      e.dataTransfer.setData('application/neos-config', JSON.stringify(item.defaultConfig));
    }
    e.dataTransfer.effectAllowed = 'move';
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const nodeType = e.dataTransfer.getData('application/neos-node-type');
    if (!nodeType || /[\0\r\n]/.test(nodeType)) return;
    const labelRaw = e.dataTransfer.getData('application/neos-node-label');
    const label =
      labelRaw && !/[\0\r\n]/.test(labelRaw) ? labelRaw.trim() || nodeType : nodeType;
    const workerId = e.dataTransfer.getData('application/neos-worker-id');
    const mode = e.dataTransfer.getData('application/neos-mode');
    const extraRaw = e.dataTransfer.getData('application/neos-config');
    const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = {
      x: e.clientX - bounds.left - 60,
      y: e.clientY - bounds.top - 20,
    };
    const config: Record<string, unknown> = {};
    if (extraRaw && extraRaw.startsWith('{')) {
      try {
        Object.assign(config, JSON.parse(extraRaw) as Record<string, unknown>);
      } catch {
        /* ignore */
      }
    }
    if (workerId && !/[\0\r\n]/.test(workerId) && workerId.trim()) {
      config.workerId = workerId.trim();
    }
    if (mode && (mode === 'solo' || mode === 'coordinator')) {
      config.mode = mode;
    }
    const id = newId('n');
    const node: Node = {
      id,
      type: 'workflowNode',
      position,
      data: {
        label,
        nodeType,
        config,
      },
    };
    setNodes((nds) => nds.concat(node));
    setSelectedId(id);
    markDirty();
  };

  const handleSave = async () => {
    if (saving || !workflowId) return;
    setSaving(true);
    setSaveStatus(null);
    setError(null);
    try {
      const draft = buildWorkflowDraft(nodes, edges, description || undefined);
      const res = await client.updateWorkflow(workflowId, {
        name: name.trim() || undefined,
        description: draft.description,
        nodes: draft.nodes,
        edges: draft.edges,
      });
      if (!res.ok) {
        setError(scrubError(res.error, 'Save failed'));
        setSaveStatus(null);
        return;
      }
      setDirty(false);
      setSaveStatus('Saved');
      window.setTimeout(() => setSaveStatus((s) => (s === 'Saved' ? null : s)), 2000);
    } catch (err) {
      if (handleAuthError(err)) return;
      setError(scrubError(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleRun = () => {
    if (running || !workflowId) return;
    stopRunRef.current?.();
    setRunning(true);
    setRunStatus('Starting…');
    setError(null);
    const stop = client.runWorkflow(workflowId, (event) => {
      const t = event.type;
      if (t === 'run.started') {
        setRunStatus(`Running${event.runId ? ` (${scrubText(event.runId, 12)})` : ''}…`);
      } else if (t === 'node.started' && event.nodeId) {
        setRunStatus(`Node ${scrubText(event.nodeId, 24)}…`);
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? {
                  ...n,
                  data: {
                    ...(n.data as NodeData),
                    isRunning: true,
                    isDone: false,
                    isFailed: false,
                  },
                }
              : n,
          ),
        );
      } else if (t === 'node.completed' && event.nodeId) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? {
                  ...n,
                  data: {
                    ...(n.data as NodeData),
                    isRunning: false,
                    isDone: true,
                    isFailed: false,
                  },
                }
              : n,
          ),
        );
      } else if (t === 'node.failed' && event.nodeId) {
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? {
                  ...n,
                  data: {
                    ...(n.data as NodeData),
                    isRunning: false,
                    isDone: false,
                    isFailed: true,
                  },
                }
              : n,
          ),
        );
      } else if (t === 'run.completed') {
        setRunStatus('Completed');
        setRunning(false);
        stopRunRef.current = null;
        void loadRuns();
      } else if (t === 'run.failed') {
        setRunStatus(null);
        setError(scrubError(event.error, 'Run failed'));
        setRunning(false);
        stopRunRef.current = null;
        void loadRuns();
      }
    });
    stopRunRef.current = stop;
  };

  const handleStopRun = () => {
    stopRunRef.current?.();
    stopRunRef.current = null;
    setRunning(false);
    setRunStatus('Cancelled');
  };

  if (loading) {
    return (
      <div className="layout stack">
        <p className="muted" data-testid="workflow-editor-loading">
          Loading workflow…
        </p>
      </div>
    );
  }

  return (
    <div
      className="stack"
      style={{ height: '100%', minHeight: '100vh', padding: 0, gap: 0 }}
      data-testid="workflow-editor"
    >
      <div
        className="row"
        style={{
          justifyContent: 'space-between',
          padding: '0.75rem 1rem',
          borderBottom: '1px solid var(--border)',
          background: 'var(--bg-elevated)',
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <div className="row" style={{ gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="workflow-editor-back"
            onClick={() => requestLeave('/workflows')}
          >
            ← Workflows
          </button>
          <input
            className="input"
            style={{ width: 220 }}
            data-testid="workflow-editor-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
            aria-label="Workflow name"
          />
          {dirty && (
            <span className="muted" data-testid="workflow-editor-dirty">
              Unsaved
            </span>
          )}
        </div>
        <div className="row">
          <button
            type="button"
            className="btn"
            data-testid="workflow-editor-save"
            disabled={saving}
            onClick={() => void handleSave()}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {running ? (
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="workflow-editor-stop"
              onClick={handleStopRun}
            >
              Stop
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              data-testid="workflow-editor-run"
              onClick={handleRun}
            >
              Run
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="workflow-editor-nav-projects"
            onClick={() => requestLeave('/projects')}
          >
            Projects
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            data-testid="workflow-editor-nav-settings"
            onClick={() => requestLeave('/settings')}
          >
            Settings
          </button>
        </div>
      </div>

      {leaveTo && (
        <div
          className="card stack"
          data-testid="workflow-leave-modal"
          style={{ margin: '0.75rem 1rem', maxWidth: 360 }}
        >
          <strong>Unsaved changes</strong>
          <p className="muted" style={{ margin: 0 }}>
            Leave this workflow and discard unsaved edits?
          </p>
          <div className="row">
            <button
              type="button"
              className="btn btn-ghost"
              data-testid="workflow-leave-stay"
              onClick={() => setLeaveTo(null)}
            >
              Stay
            </button>
            <button
              type="button"
              className="btn"
              data-testid="workflow-leave-discard"
              onClick={() => {
                const to = leaveTo;
                setLeaveTo(null);
                setDirty(false);
                nav(to);
              }}
            >
              Leave
            </button>
          </div>
        </div>
      )}

      {(error || saveStatus || runStatus) && (
        <div className="row" style={{ padding: '0.5rem 1rem', gap: 12 }}>
          {error && (
            <p className="err" role="alert" data-testid="workflow-editor-error" style={{ margin: 0 }}>
              {error}
            </p>
          )}
          {saveStatus && (
            <p className="muted" data-testid="workflow-editor-save-status" style={{ margin: 0 }}>
              {saveStatus}
            </p>
          )}
          {runStatus && (
            <p className="muted" data-testid="workflow-editor-run-status" style={{ margin: 0 }}>
              {runStatus}
            </p>
          )}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 480,
          borderTop: '1px solid var(--border)',
        }}
      >
        {/* Palette */}
        <aside
          data-testid="workflow-palette"
          style={{
            width: 176,
            borderRight: '1px solid var(--border)',
            padding: '0.75rem',
            background: 'var(--bg-elevated)',
            overflowY: 'auto',
          }}
        >
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: 11 }}>
            Drag onto canvas
          </p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4, marginBottom: 8 }} data-testid="palette-tabs">
            {PALETTE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="btn btn-ghost"
                data-testid={`palette-tab-${tab.id}`}
                aria-pressed={paletteTab === tab.id}
                onClick={() => setPaletteTab(tab.id)}
                style={{ fontSize: 10, padding: '2px 6px', fontWeight: paletteTab === tab.id ? 700 : 400 }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <div className="stack" style={{ gap: 6 }}>
            {PALETTE.filter((item) => {
              if (paletteTab === 'all') return true;
              if (paletteTab === 'control' || paletteTab === 'agent' || paletteTab === 'delivery') {
                return item.group === paletteTab;
              }
              return item.pack === paletteTab;
            }).map((item) => {
              const key = item.paletteKey ?? item.type;
              return (
                <div
                  key={key}
                  draggable
                  data-testid={`palette-${key}`}
                  onDragStart={(e) => onDragStart(e, item)}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid var(--border)',
                    background: (NODE_COLORS[item.type] ?? '#6b7280') + '33',
                    cursor: 'grab',
                    fontSize: 12,
                    fontWeight: 500,
                  }}
                >
                  {item.label}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Canvas */}
        <div
          style={{ flex: 1, position: 'relative', minWidth: 0 }}
          data-testid="workflow-canvas"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={(changes) => {
              onNodesChange(changes);
              if (changes.some((c) => c.type === 'position' || c.type === 'remove')) {
                markDirty();
              }
            }}
            onEdgesChange={(changes) => {
              onEdgesChange(changes);
              if (changes.some((c) => c.type === 'remove')) markDirty();
            }}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={customNodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Config + run history */}
        <aside
          data-testid="workflow-config-panel"
          style={{
            width: 280,
            borderLeft: '1px solid var(--border)',
            padding: '0.75rem',
            background: 'var(--bg-elevated)',
            overflowY: 'auto',
          }}
        >
          <p style={{ margin: '0 0 0.75rem', fontWeight: 600, fontSize: 13 }}>
            Node config
          </p>
          {!selectedNode ? (
            <p className="muted" data-testid="workflow-config-empty">
              Select a node to edit its settings.
            </p>
          ) : (
            <div className="stack" data-testid="workflow-config-form">
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                Type:{' '}
                <span data-testid="workflow-config-type">
                  {scrubText(nodeType, 40)}
                </span>
              </p>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Label</span>
                <input
                  className="input"
                  data-testid="workflow-config-label"
                  value={String((selectedNode.data as NodeData).label ?? '')}
                  onChange={(e) => {
                    if (/[\0\r\n]/.test(e.target.value)) return;
                    updateSelected({ label: e.target.value });
                  }}
                />
              </label>
              {nodeType === 'agent' && (
                <>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Worker</span>
                    <select
                      className="input"
                      data-testid="workflow-config-worker-id"
                      value={String(cfg.workerId ?? '')}
                      onChange={(e) => {
                        const workerId = e.target.value;
                        const next: Record<string, unknown> = { workerId: workerId || undefined };
                        if (workerId === 'general_coordinator' && cfg.mode !== 'solo') {
                          next.mode = 'coordinator';
                        }
                        updateSelected({ config: next });
                      }}
                    >
                      <option value="">Select worker…</option>
                      {workers.map((w) => (
                        <option key={w.id} value={w.id}>
                          {String(w.name || w.id)}
                        </option>
                      ))}
                      {typeof cfg.workerId === 'string'
                        && cfg.workerId
                        && !workers.some((w) => w.id === cfg.workerId)
                        && (
                          <option value={cfg.workerId}>{cfg.workerId}</option>
                        )}
                    </select>
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Mode</span>
                    <select
                      className="input"
                      data-testid="workflow-config-mode"
                      value={
                        cfg.mode === 'coordinator' || cfg.mode === 'solo'
                          ? String(cfg.mode)
                          : cfg.workerId === 'general_coordinator'
                            ? 'coordinator'
                            : 'solo'
                      }
                      onChange={(e) =>
                        updateSelected({
                          config: { mode: e.target.value === 'coordinator' ? 'coordinator' : 'solo' },
                        })
                      }
                    >
                      <option value="solo">Solo</option>
                      <option value="coordinator">Coordinator</option>
                    </select>
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Provider</span>
                    <select
                      className="input"
                      data-testid="workflow-config-provider"
                      value={typeof cfg.llmProvider === 'string' ? cfg.llmProvider : 'anthropic'}
                      onChange={(e) =>
                        updateSelected({
                          config: {
                            llmProvider: e.target.value,
                            provider: e.target.value,
                            llmModel: '',
                          },
                        })
                      }
                    >
                      {LLM_PROVIDERS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                  {!(typeof cfg.llmProvider === 'string' && cfg.llmProvider.startsWith('cli-')) && (
                    <label className="stack" style={{ gap: 4 }}>
                      <span className="muted">Model</span>
                      <select
                        className="input"
                        data-testid="workflow-config-model"
                        value={typeof cfg.llmModel === 'string' ? cfg.llmModel : ''}
                        onChange={(e) =>
                          updateSelected({ config: { llmModel: e.target.value || undefined } })
                        }
                      >
                        <option value="">Select model…</option>
                        {ALL_MODELS.filter((m) => {
                          const p =
                            typeof cfg.llmProvider === 'string' ? cfg.llmProvider : 'anthropic';
                          return m.providerId === p;
                        }).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              )}
              {nodeType === 'block' && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Block</span>
                  <select
                    className="input"
                    data-testid="workflow-config-block-id"
                    value={String(cfg.blockId ?? '')}
                    onChange={(e) => updateSelected({ config: { blockId: e.target.value || undefined } })}
                  >
                    <option value="">Select block…</option>
                    {blocks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || b.id}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {nodeType === 'trigger' && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Initial inputs (JSON)</span>
                  <textarea
                    className="input"
                    data-testid="workflow-config-initial-inputs"
                    rows={4}
                    defaultValue={
                      cfg.initialInputs && typeof cfg.initialInputs === 'object'
                        ? JSON.stringify(cfg.initialInputs, null, 2)
                        : ''
                    }
                    onChange={(e) => {
                      const next = e.target.value;
                      if (/\0/.test(next)) return;
                      if (!next.trim()) {
                        updateSelected({ config: { initialInputs: undefined } });
                        return;
                      }
                      try {
                        const parsed = JSON.parse(next) as unknown;
                        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                          updateSelected({ config: { initialInputs: parsed } });
                        }
                      } catch {
                        /* keep typing */
                      }
                    }}
                  />
                </label>
              )}
              {nodeType === 'web_search' && (
                <>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Query</span>
                    <input
                      className="input"
                      data-testid="workflow-config-query"
                      value={typeof cfg.query === 'string' ? cfg.query : ''}
                      onChange={(e) => {
                        if (/[\0\r\n]/.test(e.target.value)) return;
                        updateSelected({ config: { query: e.target.value } });
                      }}
                    />
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Max results</span>
                    <input
                      className="input"
                      data-testid="workflow-config-max-results"
                      type="number"
                      min={1}
                      max={20}
                      value={typeof cfg.maxResults === 'number' ? cfg.maxResults : ''}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        updateSelected({
                          config: { maxResults: Number.isFinite(n) ? n : undefined },
                        });
                      }}
                    />
                  </label>
                </>
              )}
              {nodeType === 'slack_message' && (
                <>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Channel</span>
                    <input
                      className="input"
                      data-testid="workflow-config-channel"
                      value={typeof cfg.channel === 'string' ? cfg.channel : ''}
                      onChange={(e) => {
                        if (/[\0\r\n]/.test(e.target.value)) return;
                        updateSelected({ config: { channel: e.target.value } });
                      }}
                      placeholder="#alerts"
                    />
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Text template</span>
                    <textarea
                      className="input"
                      data-testid="workflow-config-text-template"
                      rows={3}
                      value={typeof cfg.textTemplate === 'string' ? cfg.textTemplate : ''}
                      onChange={(e) => {
                        if (/\0/.test(e.target.value)) return;
                        updateSelected({ config: { textTemplate: e.target.value } });
                      }}
                    />
                  </label>
                </>
              )}
              {nodeType === 'discord_message' && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Text template</span>
                  <textarea
                    className="input"
                    data-testid="workflow-config-text-template"
                    rows={3}
                    value={typeof cfg.textTemplate === 'string' ? cfg.textTemplate : ''}
                    onChange={(e) => {
                      if (/\0/.test(e.target.value)) return;
                      updateSelected({ config: { textTemplate: e.target.value } });
                    }}
                  />
                </label>
              )}
              {nodeType === 'media' && (
                <>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Media type</span>
                    <select
                      className="input"
                      data-testid="workflow-config-media-type"
                      value={typeof cfg.mediaType === 'string' ? cfg.mediaType : 'image'}
                      onChange={(e) => updateSelected({ config: { mediaType: e.target.value } })}
                    >
                      <option value="image">Image</option>
                      <option value="audio">Audio</option>
                      <option value="video">Video</option>
                    </select>
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Provider</span>
                    <select
                      className="input"
                      data-testid="workflow-config-media-provider"
                      value={typeof cfg.mediaProvider === 'string' ? cfg.mediaProvider : 'openai'}
                      onChange={(e) => updateSelected({ config: { mediaProvider: e.target.value } })}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="google">Google</option>
                      <option value="xai">xAI</option>
                      <option value="stub">Stub</option>
                    </select>
                  </label>
                  <label className="stack" style={{ gap: 4 }}>
                    <span className="muted">Prompt</span>
                    <textarea
                      className="input"
                      data-testid="workflow-config-media-prompt"
                      rows={3}
                      value={typeof cfg.prompt === 'string' ? cfg.prompt : ''}
                      onChange={(e) => {
                        if (/\0/.test(e.target.value)) return;
                        updateSelected({ config: { prompt: e.target.value } });
                      }}
                    />
                  </label>
                </>
              )}
              {nodeType === 'deploy' && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">Provider</span>
                  <select
                    className="input"
                    data-testid="workflow-config-deploy-provider"
                    value={typeof cfg.provider === 'string' ? cfg.provider : 'vercel'}
                    onChange={(e) => updateSelected({ config: { provider: e.target.value } })}
                  >
                    <option value="vercel">vercel</option>
                    <option value="cloudflare">cloudflare</option>
                  </select>
                </label>
              )}
            </div>
          )}

          <div className="stack" data-testid="workflow-run-history" style={{ marginTop: 16 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <p style={{ margin: 0, fontWeight: 600, fontSize: 13 }}>Run history</p>
              <button
                type="button"
                className="btn btn-ghost"
                data-testid="workflow-runs-refresh"
                disabled={runsLoading}
                onClick={() => void loadRuns()}
              >
                {runsLoading ? '…' : 'Refresh'}
              </button>
            </div>
            {runsError && (
              <p className="err" role="alert" style={{ fontSize: 12 }}>
                {runsError}
              </p>
            )}
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }} data-testid="workflow-run-list">
              {runs.map((r) => (
                <li key={r.id} className="muted" data-testid={`workflow-run-${r.id}`} style={{ fontSize: 12, marginBottom: 6 }}>
                  <span className="mono">{r.id.slice(0, 8)}</span>
                  {' · '}
                  {r.status}
                  {r.startedAt ? ` · ${scrubText(r.startedAt, 24)}` : ''}
                </li>
              ))}
              {runs.length === 0 && !runsLoading && <li className="muted">No runs yet</li>}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
