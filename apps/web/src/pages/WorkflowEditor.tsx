/**
 * Web Workflow graph editor (v0.24) — simplified React Flow surface vs desktop.
 * Core: load · palette · connect · config · save · run (SSE).
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
import { Link, useNavigate, useParams } from 'react-router-dom';
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
  output: '#6b7280',
  gate_and: '#f59e0b',
  gate_or: '#f97316',
  web_search: '#8b5cf6',
};

/** Minimal palette for web editor (subset of desktop). */
const PALETTE = [
  { type: 'trigger', label: 'Trigger' },
  { type: 'agent', label: 'Agent', defaultWorkerId: 'general_generalist' },
  { type: 'output', label: 'Output' },
  { type: 'gate_and', label: 'AND Gate' },
  { type: 'gate_or', label: 'OR Gate' },
  { type: 'web_search', label: 'Web Search' },
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const stopRunRef = useRef<(() => void) | null>(null);

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
    workerId?: string;
  }) => {
    if (!selectedId) return;
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id !== selectedId) return n;
        const data = { ...(n.data as NodeData) };
        if (patch.label !== undefined) {
          data.label = patch.label;
        }
        if (patch.workerId !== undefined) {
          const cfg = { ...(data.config ?? {}) };
          if (patch.workerId.trim()) {
            cfg.workerId = patch.workerId.trim();
          } else {
            delete cfg.workerId;
          }
          data.config = cfg;
        }
        return { ...n, data };
      }),
    );
    markDirty();
  };

  const onDragStart = (e: DragEvent, item: (typeof PALETTE)[number]) => {
    e.dataTransfer.setData('application/neos-node-type', item.type);
    e.dataTransfer.setData('application/neos-node-label', item.label);
    if ('defaultWorkerId' in item && item.defaultWorkerId) {
      e.dataTransfer.setData('application/neos-worker-id', item.defaultWorkerId);
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
    const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const position = {
      x: e.clientX - bounds.left - 60,
      y: e.clientY - bounds.top - 20,
    };
    const config: Record<string, unknown> = {};
    if (workerId && !/[\0\r\n]/.test(workerId) && workerId.trim()) {
      config.workerId = workerId.trim();
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
      } else if (t === 'run.failed') {
        setRunStatus(null);
        setError(scrubError(event.error, 'Run failed'));
        setRunning(false);
        stopRunRef.current = null;
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
          <Link to="/workflows" className="btn btn-ghost" data-testid="workflow-editor-back">
            ← Workflows
          </Link>
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
          <Link to="/projects" className="btn btn-ghost" data-testid="workflow-editor-nav-projects">
            Projects
          </Link>
          <Link to="/settings" className="btn btn-ghost" data-testid="workflow-editor-nav-settings">
            Settings
          </Link>
        </div>
      </div>

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
            width: 160,
            borderRight: '1px solid var(--border)',
            padding: '0.75rem',
            background: 'var(--bg-elevated)',
            overflowY: 'auto',
          }}
        >
          <p className="muted" style={{ margin: '0 0 0.5rem', fontSize: 11 }}>
            Drag onto canvas
          </p>
          <div className="stack" style={{ gap: 6 }}>
            {PALETTE.map((item) => (
              <div
                key={item.type}
                draggable
                data-testid={`palette-${item.type}`}
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
            ))}
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

        {/* Config panel */}
        <aside
          data-testid="workflow-config-panel"
          style={{
            width: 240,
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
              Select a node to edit label and agent workerId.
            </p>
          ) : (
            <div className="stack" data-testid="workflow-config-form">
              <p className="muted" style={{ margin: 0, fontSize: 11 }}>
                Type:{' '}
                <span data-testid="workflow-config-type">
                  {scrubText((selectedNode.data as NodeData).nodeType, 40)}
                </span>
              </p>
              <label className="stack" style={{ gap: 4 }}>
                <span className="muted">Label</span>
                <input
                  className="input"
                  data-testid="workflow-config-label"
                  value={String((selectedNode.data as NodeData).label ?? '')}
                  onChange={(e) => updateSelected({ label: e.target.value })}
                />
              </label>
              {(selectedNode.data as NodeData).nodeType === 'agent' && (
                <label className="stack" style={{ gap: 4 }}>
                  <span className="muted">workerId</span>
                  <input
                    className="input"
                    data-testid="workflow-config-worker-id"
                    value={String(
                      ((selectedNode.data as NodeData).config?.workerId as string) ?? '',
                    )}
                    onChange={(e) => updateSelected({ workerId: e.target.value })}
                    placeholder="general_generalist"
                  />
                </label>
              )}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
