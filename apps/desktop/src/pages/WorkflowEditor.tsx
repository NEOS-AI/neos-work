import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useTranslation } from 'react-i18next';

import { useEngine } from '../hooks/useEngine.js';
import type { Workflow, WorkflowSSEEvent } from '../lib/engine.js';

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

  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [runStatuses, setRunStatuses] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [runEvents, setRunEvents] = useState<WorkflowSSEEvent[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stopRef = useRef<(() => void) | null>(null);

  const loadWorkflow = useCallback(async () => {
    if (!client || !id) return;
    const res = await client.getWorkflow(id);
    if (res.ok && res.data) {
      setWorkflow(res.data);
      setNodes(toReactFlowNodes(res.data, {}));
      setEdges(toReactFlowEdges(res.data));
    }
  }, [client, id, setNodes, setEdges]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  const onConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge(connection, eds)),
    [setEdges],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
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

  const handleSave = async () => {
    if (!client || !workflow) return;
    setSaving(true);
    await client.updateWorkflow(workflow.id, {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: n.data.nodeType as string,
        label: n.data.label as string,
        position: n.position,
        config: (n.data.config as Record<string, unknown>) ?? {},
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.label as string | undefined })),
    });
    setSaving(false);
  };

  const handleRun = () => {
    if (!client || !workflow) return;
    setIsRunning(true);
    setRunEvents([]);
    setRunStatuses({});
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
      if (event.type === 'run.completed' || event.type === 'run.failed') {
        setIsRunning(false);
      }
    });
    stopRef.current = stop;
  };

  const handleStop = () => {
    stopRef.current?.();
    setIsRunning(false);
  };

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
          {workflow.name}
        </span>
        <div className="flex-1" />
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
            onClick={handleRun}
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
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        {/* Run events / Config panel */}
        <aside className="flex w-72 flex-col border-l" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
          <p className="border-b px-4 py-2 text-xs font-semibold" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
            {t('workflow.runLog')}
          </p>
          <div className="flex-1 overflow-y-auto p-3 text-xs space-y-1" style={{ color: 'var(--text-secondary)' }}>
            {runEvents.map((ev, i) => (
              <div key={i} className="rounded px-2 py-1" style={{ backgroundColor: 'var(--bg-secondary)' }}>
                {ev.type === 'node.started' && `▶ ${ev.nodeId} (${ev.nodeType})`}
                {ev.type === 'node.completed' && `✓ ${ev.nodeId}`}
                {ev.type === 'node.failed' && `✗ ${ev.nodeId}: ${ev.error}`}
                {ev.type === 'run.started' && `🚀 Run ${ev.runId.slice(0, 8)}`}
                {ev.type === 'run.completed' && `✅ ${t('workflow.done')} (${ev.duration}ms)`}
                {ev.type === 'run.failed' && `❌ ${ev.error}`}
              </div>
            ))}
            {runEvents.length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>{t('workflow.noRuns')}</p>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
