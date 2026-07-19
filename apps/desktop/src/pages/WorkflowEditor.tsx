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
import { summarizeValidationIssues, validateWorkflowDraft } from '../components/workflow/WorkflowValidation.js';
import { autoLayout } from '../lib/layout.js';
import {
  EDITOR_RIGHT_PANEL_TABS,
  loadEditorRightPanelTab,
  loadLayoutDirection,
  saveEditorRightPanelTab,
  saveLayoutDirection,
  type EditorRightPanelTab,
} from '../lib/layout-prefs.js';
import {
  buildWorkflowDraft,
  toReactFlowEdges,
  toReactFlowNodes,
} from '../lib/workflow-draft.js';
import { RevisionPanel } from '../components/workflow/RevisionPanel.js';
import { ArtifactPreview } from '../components/workflow/ArtifactPreview.js';
import { RunLogPanel } from '../components/workflow/RunLogPanel.js';

// ── Node color palette ─────────────────────────────────────

const NODE_COLORS: Record<string, string> = {
  trigger:         '#6b7280',
  agent_finance:   '#10b981',
  agent_coding:    '#3b82f6',
  block:           '#f59e0b',
  gate_and:        '#f59e0b',
  gate_or:         '#f97316',
  parallel_start:  '#0ea5e9',
  parallel_end:    '#0ea5e9',
  or_gate:         '#f97316',
  web_search:      '#8b5cf6',
  slack_message:   '#4CAF50',
  discord_message: '#5865F2',
  media:           '#ec4899',
  deploy:          '#14b8a6',
  output:          '#6b7280',
};

const NODE_TYPES_LIST = [
  { type: 'trigger',         label: 'Trigger',         group: 'flow' },
  { type: 'agent_finance',   label: 'Finance Agent',   group: 'agent' },
  { type: 'agent_coding',    label: 'Coding Agent',    group: 'agent' },
  { type: 'web_search',      label: 'Web Search',      group: 'tool' },
  { type: 'slack_message',   label: 'Slack Message',   group: 'tool' },
  { type: 'discord_message', label: 'Discord Message', group: 'tool' },
  { type: 'media',           label: 'Media',           group: 'tool' },
  { type: 'deploy',          label: 'Deploy',          group: 'tool' },
  { type: 'gate_and',        label: 'AND Gate',        group: 'gate' },
  { type: 'gate_or',         label: 'OR Gate',         group: 'gate' },
  { type: 'parallel_start',  label: 'Parallel Start',  group: 'gate' },
  { type: 'parallel_end',    label: 'Parallel End',    group: 'gate' },
  { type: 'or_gate',         label: 'OR Gate (race)',  group: 'gate' },
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

type RightPanelTab = EditorRightPanelTab;

// ── WorkflowEditor ────────────────────────────────────────

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
  const [runInputsOpen, setRunInputsOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [rightPanelTab, setRightPanelTabState] = useState<RightPanelTab>(() => loadEditorRightPanelTab());
  const [allBlocks, setAllBlocks] = useState<WorkflowBlock[]>([]);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const [revisionPanelOpen, setRevisionPanelOpen] = useState(false);
  const [latestArtifactId, setLatestArtifactId] = useState<string | undefined>(undefined);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleCron, setScheduleCron] = useState('0 9 * * *');
  const [scheduleName, setScheduleName] = useState('');
  const [scheduleBusy, setScheduleBusy] = useState(false);
  const [layoutDirection, setLayoutDirection] = useState<'TB' | 'LR'>(() => loadLayoutDirection());
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  /** User-initiated tab choice — persists across reloads. */
  const selectRightPanelTab = useCallback((tab: RightPanelTab) => {
    setRightPanelTabState(tab);
    saveEditorRightPanelTab(tab);
  }, []);

  /** Transient tab switch (run / validation / preview) — does not overwrite prefs. */
  const showRightPanelTab = useCallback((tab: RightPanelTab) => {
    setRightPanelTabState(tab);
  }, []);

  const stopRef = useRef<(() => void) | null>(null);
  /** When true, name-field blur must not persist (Escape cancel). */
  const skipNameBlurCommitRef = useRef(false);
  /** Prevent Enter+blur double commit. */
  const nameCommitInFlightRef = useRef(false);

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
      // Fit graph after positions apply
      setTimeout(() => fitView({ padding: 0.12, duration: 250 }), 50);
    }
  }, [client, id, setNodes, setEdges, fitView]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  // Escape closes Schedule modal and/or shortcuts help (plan Task 2 / UX)
  useEffect(() => {
    if (!scheduleOpen && !shortcutsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (scheduleOpen) setScheduleOpen(false);
      if (shortcutsOpen) setShortcutsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scheduleOpen, shortcutsOpen]);

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
  const validationSummary = useMemo(
    () => summarizeValidationIssues(validationIssues),
    [validationIssues],
  );

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
    if (skipNameBlurCommitRef.current) {
      skipNameBlurCommitRef.current = false;
      return;
    }
    if (nameCommitInFlightRef.current) return;
    const trimmed = nameInput.trim().slice(0, 200);
    nameCommitInFlightRef.current = true;
    setEditingName(false);
    try {
      if (!trimmed || !client || !workflow || trimmed === workflow.name) return;
      const res = await client.updateWorkflow(workflow.id, { ...draft, name: trimmed });
      if (res.ok && res.data) setWorkflow(res.data);
    } finally {
      nameCommitInFlightRef.current = false;
    }
  };

  const cancelNameEdit = () => {
    skipNameBlurCommitRef.current = true;
    setEditingName(false);
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
    if (validationIssues.length > 0) showRightPanelTab('config');
  };

  const handleRun = async (inputs?: Record<string, unknown>) => {
    if (!client || !workflow) return;
    if (hasValidationErrors) {
      showRightPanelTab('config');
      return;
    }
    // Soft preflight: block hard errors unless user confirms (plan polish)
    try {
      const pf = await client.preflightWorkflow(workflow.id);
      if (pf.ok && pf.data && !pf.data.ok) {
        const errs = pf.data.issues.filter((i) => i.severity === 'error');
        if (errs.length > 0) {
          const msg = errs.map((i) => `• ${i.message}`).join('\n');
          const proceed = window.confirm(
            `Preflight found ${errs.length} issue(s):\n\n${msg}\n\nRun anyway?`,
          );
          if (!proceed) {
            showRightPanelTab('config');
            return;
          }
        }
      }
    } catch {
      // non-blocking if preflight endpoint unavailable
    }
    const saveRes = await client.updateWorkflow(workflow.id, draft);
    if (saveRes.ok && saveRes.data) {
      setWorkflow(saveRes.data);
      setSavedDraft(draft);
    }
    setIsRunning(true);
    showRightPanelTab('run');
    setRunEvents([]);
    setRunStatuses({});
    const stop = client.runWorkflow(workflow.id, (event) => {
      // Collapse consecutive node.progress for the same node into one log row
      setRunEvents((prev) => {
        if (event.type === 'node.progress') {
          const last = prev[prev.length - 1];
          if (last && last.type === 'node.progress' && last.nodeId === event.nodeId) {
            return [...prev.slice(0, -1), event];
          }
        }
        return [...prev, event];
      });
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
          showRightPanelTab('preview');
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

  // Keyboard shortcuts: Cmd/Ctrl+S save, Cmd/Ctrl+Enter run
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (!meta) return;
      if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        void handleSave();
      } else if (e.key === 'Enter' && !isRunning) {
        e.preventDefault();
        void handleRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isRunning, workflow, client, draft, hasValidationErrors, isDirty]);

  const handleAutoLayout = useCallback((direction?: 'TB' | 'LR') => {
    const dir = direction ?? layoutDirection;
    setLayoutDirection(dir);
    saveLayoutDirection(dir);
    setNodes((current) => {
      const laid = autoLayout(current, edges, dir);
      // fitView needs a tick to see new positions
      setTimeout(() => fitView({ padding: 0.1, duration: 300 }), 50);
      return laid;
    });
  }, [edges, fitView, setNodes, layoutDirection]);

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
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleNameCommit();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancelNameEdit();
                }
              }}
            />
          ) : (
            <span
              className="cursor-text hover:opacity-80"
              onClick={() => {
                skipNameBlurCommitRef.current = false;
                setNameInput(workflow.name);
                setEditingName(true);
              }}
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
        {validationSummary.total > 0 && (
          <button
            type="button"
            onClick={() => selectRightPanelTab('config')}
            className="rounded-lg px-2.5 py-1.5 text-[10px] font-medium"
            style={{
              backgroundColor: validationSummary.errors > 0 ? '#7f1d1d40' : 'var(--bg-tertiary)',
              color: validationSummary.errors > 0 ? '#fca5a5' : 'var(--text-muted)',
            }}
            title="Open Config panel for validation issues"
          >
            {validationSummary.errors > 0
              ? `${validationSummary.errors} error${validationSummary.errors === 1 ? '' : 's'}`
              : `${validationSummary.warnings} warning${validationSummary.warnings === 1 ? '' : 's'}`}
          </button>
        )}
        <button
          onClick={() => setShortcutsOpen((v) => !v)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Keyboard shortcuts"
        >
          ⌨
        </button>
        <button
          onClick={() => {
            setScheduleName(workflow ? `${workflow.name} schedule` : 'Scheduled run');
            setScheduleCron('0 9 * * *');
            setScheduleOpen(true);
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Create automation routine for this workflow"
        >
          ⏱ Schedule
        </button>
        <button
          onClick={() => handleAutoLayout(layoutDirection === 'TB' ? 'LR' : 'TB')}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title={`Switch layout direction (current: ${layoutDirection})`}
        >
          {layoutDirection === 'TB' ? '↓' : '→'} Dir
        </button>
        <button
          onClick={() => handleAutoLayout()}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title={`Auto Layout (${layoutDirection})`}
        >
          ⬡ Layout
        </button>
        <button
          onClick={async () => {
            if (!client || !workflow) return;
            const res = await client.preflightWorkflow(workflow.id);
            if (!res.ok || !res.data) {
              window.alert((res as { error?: string }).error ?? 'Preflight failed');
              return;
            }
            const { ok, issues } = res.data;
            if (issues.length === 0) {
              window.alert('Preflight OK — ready to run.');
              return;
            }
            const lines = issues.map((i) => `[${i.severity}] ${i.message}${i.nodeId ? ` (${i.nodeId})` : ''}`);
            window.alert(`${ok ? 'Preflight warnings' : 'Preflight blocked'}:\n\n${lines.join('\n')}`);
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title="Check graph structure and required settings"
        >
          ✓ Preflight
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
              // Selecting a node should surface config without rewriting the saved default tab
              showRightPanelTab('config');
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
            {EDITOR_RIGHT_PANEL_TABS.map((tab) => (
              <button
                key={tab}
                onClick={() => selectRightPanelTab(tab)}
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
            <RunLogPanel events={runEvents} nodeLabelMap={nodeLabelMap} />
          )}

          {rightPanelTab === 'history' && (
            <RunHistoryPanel workflowId={workflow.id} refreshKey={historyRefreshKey} nodeLabelMap={nodeLabelMap} />
          )}

          {rightPanelTab === 'preview' && (
            <div className="flex-1 min-h-0 overflow-hidden">
              <ArtifactPreview
                workflowId={workflow.id}
                latestArtifactId={latestArtifactId}
                isRunning={isRunning}
                onRerunWorkflow={() => {
                  showRightPanelTab('run');
                  void handleRun();
                }}
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
          isDirty={isDirty}
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
              if (typeof snap.description === 'string') setWorkflowDescription(snap.description);
              if (typeof snap.designSystemId === 'string') setDesignSystemId(snap.designSystemId);
              else if (snap.designSystemId === undefined || snap.designSystemId === null) setDesignSystemId('');
            }
          }}
        />
      )}

      {scheduleOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setScheduleOpen(false); }}
        >
          <div
            className="w-full max-w-md rounded-xl border p-5 space-y-4"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}
          >
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Schedule this workflow
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Creates an automation routine linked to this workflow. Manage it under Routines.
            </p>
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Name</label>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                value={scheduleName}
                onChange={(e) => setScheduleName(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Cron (UTC)</label>
              <select
                className="w-full rounded border px-3 py-1.5 text-sm mb-1"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                value={scheduleCron}
                onChange={(e) => setScheduleCron(e.target.value)}
              >
                <option value="0 * * * *">Every hour</option>
                <option value="0 9 * * *">Daily 09:00 UTC</option>
                <option value="0 9 * * 1">Weekly Monday 09:00 UTC</option>
                <option value="*/15 * * * *">Every 15 minutes</option>
              </select>
              <input
                className="w-full rounded border px-3 py-1.5 text-sm font-mono"
                style={{ borderColor: 'var(--border-secondary)', backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
                value={scheduleCron}
                onChange={(e) => setScheduleCron(e.target.value)}
                placeholder="0 9 * * *"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded px-3 py-1.5 text-xs"
                style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-secondary)' }}
                onClick={() => setScheduleOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={scheduleBusy || !scheduleName.trim() || !scheduleCron.trim()}
                className="rounded px-3 py-1.5 text-xs text-white disabled:opacity-40"
                style={{ backgroundColor: '#10b981' }}
                onClick={async () => {
                  if (!client || !workflow) return;
                  setScheduleBusy(true);
                  const res = await client.createRoutine({
                    name: scheduleName.trim(),
                    workflowId: workflow.id,
                    schedule: scheduleCron.trim(),
                    enabled: true,
                  });
                  setScheduleBusy(false);
                  if (res.ok) {
                    setScheduleOpen(false);
                    if (confirm('Routine created. Open Routines page?')) {
                      navigate('/routines');
                    }
                  } else {
                    alert((res as { error?: string }).error ?? 'Failed to create routine');
                  }
                }}
              >
                {scheduleBusy ? '…' : 'Create routine'}
              </button>
            </div>
          </div>
        </div>
      )}

      {shortcutsOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShortcutsOpen(false); }}
        >
          <div
            className="w-full max-w-sm rounded-xl border p-5 space-y-3"
            style={{ backgroundColor: 'var(--bg-primary)', borderColor: 'var(--border-primary)' }}
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Keyboard shortcuts
              </h3>
              <button
                type="button"
                className="text-xs"
                style={{ color: 'var(--text-muted)' }}
                onClick={() => setShortcutsOpen(false)}
              >
                ✕
              </button>
            </div>
            <ul className="space-y-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <li className="flex justify-between gap-4">
                <span>Save workflow</span>
                <kbd className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  ⌘/Ctrl+S
                </kbd>
              </li>
              <li className="flex justify-between gap-4">
                <span>Run workflow</span>
                <kbd className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  ⌘/Ctrl+Enter
                </kbd>
              </li>
              <li className="flex justify-between gap-4">
                <span>Close History panel</span>
                <kbd className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  Esc
                </kbd>
              </li>
              <li className="flex justify-between gap-4">
                <span>Close Schedule / Shortcuts</span>
                <kbd className="rounded px-1.5 py-0.5 font-mono text-[10px]" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                  Esc
                </kbd>
              </li>
              <li className="flex justify-between gap-4">
                <span>Confirm leave dialog</span>
                <span style={{ color: 'var(--text-muted)' }}>when dirty</span>
              </li>
            </ul>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              Toolbar: Schedule, Layout, Preflight, History, Export, and Preview tabs.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
