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
import { safeEntityId, scrubDisplayText } from '../lib/format-duration.js';
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
  agent:           '#8b5cf6',
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

/**
 * Palette entries grouped by Domain Pack / control surface (PLAN_FOR_V0_4_0 Task 8).
 * Agent variants always drop as canonical `type: 'agent'` with a default workerId.
 */
const NODE_TYPES_LIST = [
  { type: 'trigger',         label: 'Trigger',              group: 'control',  pack: 'control' as const },
  { type: 'output',          label: 'Output',               group: 'control',  pack: 'control' as const },
  { type: 'gate_and',        label: 'AND Gate',             group: 'control',  pack: 'control' as const },
  { type: 'gate_or',         label: 'OR Gate (logic)',      group: 'control',  pack: 'control' as const },
  { type: 'or_gate',         label: 'OR Gate (race)',       group: 'control',  pack: 'control' as const },
  { type: 'parallel_start',  label: 'Parallel Start',       group: 'control',  pack: 'control' as const },
  { type: 'parallel_end',    label: 'Parallel End',         group: 'control',  pack: 'control' as const },
  { type: 'agent',           label: 'Agent',                group: 'agent',    pack: 'general' as const, defaultWorkerId: 'general_generalist', defaultMode: 'solo' as const },
  { type: 'agent',           label: 'Coordinator',          group: 'agent',    pack: 'general' as const, defaultWorkerId: 'general_coordinator', defaultMode: 'coordinator' as const, paletteKey: 'agent_coordinator' },
  { type: 'agent',           label: 'Finance Analyst',      group: 'agent',    pack: 'finance' as const, defaultWorkerId: 'finance_analyst', defaultMode: 'solo' as const, paletteKey: 'agent_finance' },
  { type: 'agent',           label: 'Coding Reviewer',      group: 'agent',    pack: 'coding' as const, defaultWorkerId: 'coding_reviewer', defaultMode: 'solo' as const, paletteKey: 'agent_coding' },
  { type: 'agent',           label: 'Research Web',         group: 'agent',    pack: 'research' as const, defaultWorkerId: 'research_web', defaultMode: 'solo' as const, paletteKey: 'agent_research' },
  { type: 'block',           label: 'Block',                group: 'block',    pack: 'general' as const },
  { type: 'web_search',      label: 'Web Search',           group: 'delivery', pack: 'research' as const },
  { type: 'slack_message',   label: 'Slack Message',        group: 'delivery', pack: 'delivery' as const },
  { type: 'discord_message', label: 'Discord Message',      group: 'delivery', pack: 'delivery' as const },
  { type: 'media',           label: 'Media',                group: 'delivery', pack: 'delivery' as const },
  { type: 'deploy',          label: 'Deploy',               group: 'delivery', pack: 'delivery' as const },
] as const;

const PALETTE_TABS = [
  { id: 'all', label: 'All' },
  { id: 'finance', label: 'Finance' },
  { id: 'coding', label: 'Coding' },
  { id: 'research', label: 'Research' },
  { id: 'general', label: 'General' },
  { id: 'control', label: 'Control' },
  { id: 'delivery', label: 'Delivery' },
] as const;

type PaletteTabId = (typeof PALETTE_TABS)[number]['id'];

// ── Custom node component ─────────────────────────────────

/** Canvas node chrome — exported for unit tests (label scrub). */
export function WorkflowNodeComponent({ data }: {
  data: {
    label: string;
    nodeType: string;
    isRunning?: boolean;
    isDone?: boolean;
    isFailed?: boolean;
    /** Typed-ports mismatch / soft warning (Task 9) */
    isPortWarning?: boolean;
    config?: Record<string, unknown>;
  };
}) {
  const color = NODE_COLORS[data.nodeType] ?? '#6b7280';
  const borderColor = data.isFailed
    ? '#ef4444'
    : data.isDone
      ? '#22c55e'
      : data.isRunning
        ? '#facc15'
        : data.isPortWarning
          ? '#eab308'
          : color;
  // Scrub hostile / multi-line labels for canvas chrome (fall back to node type)
  const label =
    scrubDisplayText(data.label, { collapseLines: true, maxChars: 80 })
    || scrubDisplayText(data.nodeType, { collapseLines: true, maxChars: 40 })
    || 'node';
  const isCoordinator =
    data.config?.mode === 'coordinator'
    || (data.config?.mode !== 'solo' && data.config?.workerId === 'general_coordinator');
  return (
    <div
      className="min-w-[130px] rounded-xl border-2 px-3 py-2 text-center text-xs font-medium text-white shadow-md"
      style={{ backgroundColor: color + 'cc', borderColor }}
      title={isCoordinator ? 'Coordinator mode' : undefined}
    >
      {isCoordinator && <span className="mr-1 opacity-90" aria-label="coordinator">◎</span>}
      {label}
      {data.isPortWarning && !data.isFailed && (
        <span className="ml-1 text-yellow-300" title="Port type warning" aria-label="port warning">
          ⚠
        </span>
      )}
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
  const [blocksLoadError, setBlocksLoadError] = useState<string | null>(null);
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
  const [paletteTab, setPaletteTab] = useState<PaletteTabId>('all');
  const [migrationToast, setMigrationToast] = useState<string | null>(null);

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

  const [loadError, setLoadError] = useState<string | null>(null);

  const loadWorkflow = useCallback(async () => {
    if (!client || !id) return;
    setLoadError(null);
    // Control-char / blank / overlong route ids never sent to get-workflow API
    const safeId = safeEntityId(id);
    if (!safeId) {
      setWorkflow(null);
      setLoadError('Workflow id contains invalid control characters');
      return;
    }
    try {
      const res = await client.getWorkflow(safeId);
      if (res.ok && res.data) {
        setWorkflow(res.data);
        // Multi-line description OK; strip null bytes. Control-char designSystemId dropped.
        const descRaw = typeof res.data.description === 'string' ? res.data.description : '';
        const descSafe = /\0/.test(descRaw) ? descRaw.replace(/\0/g, '') : descRaw;
        const dsRaw = typeof res.data.designSystemId === 'string' ? res.data.designSystemId : '';
        const dsSafe =
          dsRaw && !/[\0\r\n]/.test(dsRaw) ? dsRaw.trim() : '';
        setWorkflowDescription(descSafe);
        setDesignSystemId(dsSafe);
        const rfNodes = toReactFlowNodes(res.data, {});
        const rfEdges = toReactFlowEdges(res.data);
        setNodes(rfNodes);
        setEdges(rfEdges);
        setSavedDraft(buildWorkflowDraft(rfNodes, rfEdges, descSafe, dsSafe));
        // One-time toast when server returned schemaVersion 2 after v1 migrate (Task 8)
        try {
          const toastKey = `neos.workflow.migrated.v2.${safeId}`;
          const hasLegacyAgent = (res.data.nodes ?? []).some(
            (n) => n.type === 'agent_finance' || n.type === 'agent_coding',
          );
          const isV2 = res.data.schemaVersion === 2 || res.data.primaryDomain != null;
          if (isV2 && !hasLegacyAgent && sessionStorage.getItem(toastKey) !== '1') {
            sessionStorage.setItem(toastKey, '1');
            // Show only if graph looks freshly normalized (has agent + workerId)
            const hasWorkerId = (res.data.nodes ?? []).some(
              (n) =>
                n.type === 'agent'
                && n.config
                && typeof (n.config as { workerId?: unknown }).workerId === 'string',
            );
            if (hasWorkerId) {
              setMigrationToast('Workflow converted to v2 (Domain Workers).');
              setTimeout(() => setMigrationToast(null), 6_000);
            }
          }
        } catch {
          // sessionStorage may be unavailable
        }
        // Fit graph after positions apply
        setTimeout(() => fitView({ padding: 0.12, duration: 250 }), 50);
      } else {
        setWorkflow(null);
        setLoadError(
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Failed to load workflow',
        );
      }
    } catch (err) {
      setWorkflow(null);
      const msg = err instanceof Error ? err.message : 'Failed to load workflow';
      setLoadError(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load workflow',
      );
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
    setBlocksLoadError(null);

    client
      .listBlocks()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setAllBlocks(res.data);
          setBlocksLoadError(null);
        } else {
          setAllBlocks([]);
          setBlocksLoadError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load blocks for validation',
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setAllBlocks([]);
        const msg = err instanceof Error ? err.message : 'Failed to load blocks for validation';
        setBlocksLoadError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || 'Failed to load blocks for validation',
        );
      });

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
      // Prefer paletteKey when present so agent pack presets resolve correctly
      const paletteKey = e.dataTransfer.getData('paletteKey');
      const nodeType = e.dataTransfer.getData('nodeType');
      if (!nodeType && !paletteKey) return;
      const typeDef =
        (paletteKey
          ? NODE_TYPES_LIST.find((t) => {
              const k =
                'paletteKey' in t && (t as { paletteKey?: string }).paletteKey
                  ? (t as { paletteKey?: string }).paletteKey!
                  : `${t.type}:${t.label}`;
              return k === paletteKey;
            })
          : undefined)
        ?? NODE_TYPES_LIST.find((t) => t.type === nodeType);
      if (!typeDef) return;
      const config: Record<string, unknown> = {};
      const workerId = (typeDef as { defaultWorkerId?: string }).defaultWorkerId;
      const mode = (typeDef as { defaultMode?: string }).defaultMode;
      if (workerId) config.workerId = workerId;
      if (mode) config.mode = mode;
      const newNode: Node = {
        id: crypto.randomUUID(),
        type: 'workflowNode',
        position: { x: e.nativeEvent.offsetX - 65, y: e.nativeEvent.offsetY - 16 },
        data: { label: typeDef.label, nodeType: typeDef.type, config },
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
      const id = String(n.id ?? '');
      const raw = n.data.label ?? id;
      map[id] =
        scrubDisplayText(raw, { collapseLines: true, maxChars: 200 })
        || scrubDisplayText(id, { collapseLines: true, maxChars: 80 })
        || 'node';
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
    // Control-char names rejected (check before trim; align with workflow API)
    if (/[\0\r\n]/.test(nameInput)) {
      setEditingName(false);
      window.alert('Name contains invalid control characters');
      return;
    }
    const trimmed = nameInput.trim().slice(0, 200);
    nameCommitInFlightRef.current = true;
    setEditingName(false);
    try {
      if (!trimmed || !client || !workflow || trimmed === workflow.name) return;
      const wfId = safeEntityId(workflow.id);
      if (!wfId) {
        window.alert('Workflow id contains invalid control characters');
        return;
      }
      const res = await client.updateWorkflow(wfId, { ...draft, name: trimmed });
      if (res.ok && res.data) {
        setWorkflow(res.data);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Rename failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Rename failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Rename failed',
      );
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
    const wfId = safeEntityId(workflow.id);
    if (!wfId) {
      window.alert('Workflow id contains invalid control characters');
      return;
    }
    setSaving(true);
    try {
      const res = await client.updateWorkflow(wfId, draft);
      if (res.ok && res.data) {
        setWorkflow(res.data);
        setSavedDraft(draft);
      } else {
        const err =
          scrubDisplayText((res as { error?: string }).error, {
            collapseLines: true,
            maxChars: 300,
          }) || 'Save failed';
        window.alert(err);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Save failed',
      );
    } finally {
      setSaving(false);
    }
    if (validationIssues.length > 0) showRightPanelTab('config');
  };

  const handleRun = async (inputs?: Record<string, unknown>) => {
    if (!client || !workflow) return;
    const wfId = safeEntityId(workflow.id);
    if (!wfId) {
      window.alert('Workflow id contains invalid control characters');
      return;
    }
    if (hasValidationErrors) {
      showRightPanelTab('config');
      return;
    }
    // Soft preflight: block hard errors unless user confirms (plan polish)
    try {
      const pf = await client.preflightWorkflow(wfId);
      if (pf.ok && pf.data && !pf.data.ok) {
        const errs = pf.data.issues.filter((i) => i.severity === 'error');
        if (errs.length > 0) {
          const msg = errs
            .slice(0, 20)
            .map((i) => {
              const line =
                scrubDisplayText(i.message, { collapseLines: true, maxChars: 200 })
                || scrubDisplayText(i.code, { collapseLines: true, maxChars: 80 })
                || 'issue';
              return `• ${line}`;
            })
            .join('\n');
          const more = errs.length > 20 ? `\n…and ${errs.length - 20} more` : '';
          const proceed = window.confirm(
            `Preflight found ${errs.length} issue(s):\n\n${msg}${more}\n\nRun anyway?`,
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
    let saveRes: Awaited<ReturnType<typeof client.updateWorkflow>>;
    try {
      saveRes = await client.updateWorkflow(wfId, draft);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      window.alert(
        scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Save failed',
      );
      return;
    }
    if (saveRes.ok && saveRes.data) {
      setWorkflow(saveRes.data);
      setSavedDraft(draft);
    } else {
      const err =
        scrubDisplayText((saveRes as { error?: string }).error, {
          collapseLines: true,
          maxChars: 300,
        }) || 'Save failed';
      window.alert(err);
      return;
    }
    setIsRunning(true);
    showRightPanelTab('run');
    setRunEvents([]);
    setRunStatuses({});
    const stop = client.runWorkflow(wfId, (event) => {
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

  // Sync run statuses to node styles — preserve existing data (including config).
  // Only allocate new node/data objects when flags actually change, otherwise
  // draft/validation memos churn and this effect can loop (setNodes → draft → issues → setNodes).
  useEffect(() => {
    if (!workflow) return;
    const portWarnIds = new Set(
      validationIssues
        .filter((i) => i.code.startsWith('port_') && i.nodeId)
        .map((i) => i.nodeId as string),
    );
    setNodes((prev) => {
      let changed = false;
      const next = prev.map((n) => {
        const isRunning = runStatuses[n.id] === 'running';
        const isDone = runStatuses[n.id] === 'completed';
        const isFailed = runStatuses[n.id] === 'failed';
        const isPortWarning = portWarnIds.has(n.id);
        const d = n.data as {
          isRunning?: boolean;
          isDone?: boolean;
          isFailed?: boolean;
          isPortWarning?: boolean;
        };
        if (
          d.isRunning === isRunning
          && d.isDone === isDone
          && d.isFailed === isFailed
          && d.isPortWarning === isPortWarning
        ) {
          return n;
        }
        changed = true;
        return {
          ...n,
          data: {
            ...n.data,
            isRunning,
            isDone,
            isFailed,
            isPortWarning,
          },
        };
      });
      return changed ? next : prev;
    });
  }, [runStatuses, workflow, setNodes, validationIssues]);

  if (!workflow) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3" style={{ color: 'var(--text-muted)' }}>
        {loadError ? (
          <>
            <p className="text-sm text-red-400">
              {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
            </p>
            <button
              type="button"
              onClick={() => navigate('/workflows')}
              className="text-sm"
              style={{ color: 'var(--text-secondary)' }}
            >
              ← {t('nav.workflows')}
            </button>
          </>
        ) : (
          t('common.loading')
        )}
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
                // Seed editor with scrubbed name (control-char / empty never re-enter the input)
                setNameInput(
                  scrubDisplayText(workflow.name, { collapseLines: true, maxChars: 200 })
                  || 'Workflow',
                );
                setEditingName(true);
              }}
              title={t('workflow.rename')}
            >
              {scrubDisplayText(workflow.name, { collapseLines: true, maxChars: 200 }) || 'Workflow'}
            </span>
          )}
          {isDirty && (
            <span className="ml-1 select-none text-yellow-400" title="Unsaved changes">•</span>
          )}
        </span>
        <div className="flex-1" />
        {blocksLoadError && (
          <span
            className="max-w-[12rem] truncate rounded-lg px-2.5 py-1.5 text-[10px] font-medium text-amber-300"
            style={{ backgroundColor: '#78350f40' }}
            title={blocksLoadError}
          >
            {scrubDisplayText(blocksLoadError, { collapseLines: true, maxChars: 80 })
              || 'Blocks unavailable'}
          </span>
        )}
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
            // Scrub workflow name seed so control chars never enter the schedule form
            const base =
              scrubDisplayText(workflow?.name, { collapseLines: true, maxChars: 160 })
              || 'Workflow';
            setScheduleName(workflow ? `${base} schedule` : 'Scheduled run');
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
            const wfId = safeEntityId(workflow.id);
            if (!wfId) {
              window.alert('Workflow id contains invalid control characters');
              return;
            }
            try {
              const res = await client.preflightWorkflow(wfId);
              if (!res.ok || !res.data) {
                const err = scrubDisplayText(
                  (res as { error?: string }).error ?? 'Preflight failed',
                  { collapseLines: true, maxChars: 500 },
                );
                window.alert(err || 'Preflight failed');
                return;
              }
              const { ok, issues } = res.data;
              if (issues.length === 0) {
                window.alert('Preflight OK — ready to run.');
                return;
              }
              const lines = issues.slice(0, 40).map((i) => {
                const sev = scrubDisplayText(i.severity, { collapseLines: true, maxChars: 20 }) || 'info';
                const msg =
                  scrubDisplayText(i.message, { collapseLines: true, maxChars: 300 })
                  || scrubDisplayText(i.code, { collapseLines: true, maxChars: 80 })
                  || 'issue';
                const nid = i.nodeId
                  ? scrubDisplayText(i.nodeId, { collapseLines: true, maxChars: 80 })
                  : '';
                return `[${sev}] ${msg}${nid ? ` (${nid})` : ''}`;
              });
              const more =
                issues.length > 40 ? `\n…and ${issues.length - 40} more` : '';
              window.alert(
                `${ok ? 'Preflight warnings' : 'Preflight blocked'}:\n\n${lines.join('\n')}${more}`,
              );
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Preflight failed';
              window.alert(
                scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Preflight failed',
              );
            }
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
          onClick={() => {
            // Scrub before download filename sanitization (control-char names never reach download attr)
            const name =
              scrubDisplayText(workflow.name, { collapseLines: true, maxChars: 200 })
              || 'workflow';
            void (async () => {
              if (!client) return;
              const wfId = safeEntityId(workflow.id);
              if (!wfId) {
                window.alert('Workflow id contains invalid control characters');
                return;
              }
              try {
                const ok = await client.exportWorkflow(wfId, name);
                if (!ok) window.alert('Export failed');
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Export failed';
                window.alert(
                  scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Export failed',
                );
              }
            })();
          }}
          className="rounded-lg px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-muted)' }}
          title={t('workflow.export')}
        >
          {t('workflow.export')} (JSON)
        </button>
        <button
          onClick={() => {
            const name =
              scrubDisplayText(workflow.name, { collapseLines: true, maxChars: 200 })
              || 'workflow';
            void (async () => {
              if (!client) return;
              const wfId = safeEntityId(workflow.id);
              if (!wfId) {
                window.alert('Workflow id contains invalid control characters');
                return;
              }
              try {
                const ok = await client.exportWorkflowZip(wfId, name);
                if (!ok) window.alert('Export failed');
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Export failed';
                window.alert(
                  scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Export failed',
                );
              }
            })();
          }}
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

      <div className="relative flex flex-1 overflow-hidden">
        {migrationToast && (
          <div
            data-testid="migration-toast"
            className="absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-lg border px-3 py-2 text-xs shadow-lg"
            style={{
              backgroundColor: 'var(--bg-primary)',
              borderColor: 'var(--border-secondary)',
              color: 'var(--text-primary)',
            }}
          >
            {migrationToast}
            <button
              type="button"
              className="ml-2 underline"
              style={{ color: 'var(--text-muted)' }}
              onClick={() => setMigrationToast(null)}
            >
              OK
            </button>
          </div>
        )}
        {/* Node Palette — Domain Pack tabs (v0.4 Task 8) */}
        <aside className="flex w-48 flex-col gap-1 overflow-y-auto border-r p-2" style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)' }}>
          <p className="mb-1 px-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            {t('workflow.nodes')}
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            {PALETTE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setPaletteTab(tab.id)}
                className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                style={{
                  backgroundColor: paletteTab === tab.id ? 'var(--border-secondary)' : 'transparent',
                  color: paletteTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {NODE_TYPES_LIST.filter((item) => paletteTab === 'all' || item.pack === paletteTab).map((item) => {
            const key = ('paletteKey' in item && item.paletteKey) ? item.paletteKey : `${item.type}:${item.label}`;
            return (
              <div
                key={key}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('nodeType', item.type);
                  e.dataTransfer.setData('paletteKey', key);
                }}
                className="cursor-grab rounded-lg px-2 py-1.5 text-xs font-medium text-white"
                style={{ backgroundColor: (NODE_COLORS[item.type] ?? '#6b7280') + 'cc' }}
                title={'defaultWorkerId' in item && item.defaultWorkerId ? `worker: ${item.defaultWorkerId}` : item.label}
              >
                {item.label}
                {'defaultMode' in item && item.defaultMode === 'coordinator' && (
                  <span className="ml-1 opacity-80">◎</span>
                )}
              </div>
            );
          })}
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
              if (typeof snap.description === 'string') {
                const d = snap.description;
                setWorkflowDescription(/\0/.test(d) ? d.replace(/\0/g, '') : d);
              }
              if (typeof snap.designSystemId === 'string') {
                const id = snap.designSystemId;
                setDesignSystemId(id && !/[\0\r\n]/.test(id) ? id.trim() : '');
              } else if (snap.designSystemId === undefined || snap.designSystemId === null) {
                setDesignSystemId('');
              }
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
                  // Control-char name/schedule rejected before trim (align with routines API)
                  if (/[\0\r\n]/.test(scheduleName) || /[\0\r\n]/.test(scheduleCron)) {
                    window.alert('Name or schedule contains invalid control characters');
                    return;
                  }
                  if (!scheduleName.trim() || !scheduleCron.trim()) return;
                  const wfId = safeEntityId(workflow.id);
                  if (!wfId) {
                    window.alert('Workflow id contains invalid control characters');
                    return;
                  }
                  setScheduleBusy(true);
                  try {
                    const res = await client.createRoutine({
                      name: scheduleName.trim(),
                      workflowId: wfId,
                      schedule: scheduleCron.trim(),
                      enabled: true,
                    });
                    if (res.ok) {
                      setScheduleOpen(false);
                      if (window.confirm('Routine created. Open Routines page?')) {
                        navigate('/routines');
                      }
                    } else {
                      const err = scrubDisplayText(
                        (res as { error?: string }).error ?? 'Failed to create routine',
                        { collapseLines: true, maxChars: 500 },
                      );
                      window.alert(err || 'Failed to create routine');
                    }
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Failed to create routine';
                    window.alert(
                      scrubDisplayText(msg, { collapseLines: true, maxChars: 500 })
                      || 'Failed to create routine',
                    );
                  } finally {
                    setScheduleBusy(false);
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
