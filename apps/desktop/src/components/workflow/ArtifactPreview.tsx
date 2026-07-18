import { useEffect, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { Artifact } from '../../lib/engine.js';

interface ArtifactPreviewProps {
  workflowId: string;
  /** If provided, show only artifacts for this run */
  runId?: string;
  /** Latest artifactId from SSE run.completed event — triggers reload */
  latestArtifactId?: string;
  /** Optional: re-run the parent workflow to regenerate artifacts */
  onRerunWorkflow?: () => void;
  /** Whether a workflow run is already in progress */
  isRunning?: boolean;
}

export function ArtifactPreview({
  workflowId,
  runId,
  latestArtifactId,
  onRerunWorkflow,
  isRunning,
}: ArtifactPreviewProps) {
  const { client } = useEngine();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const loadList = () => {
    if (!client) return;
    const params = runId ? { runId } : { workflowId };
    client.listArtifacts(params).then((res) => {
      if (res.ok && res.data) {
        setArtifacts(res.data);
        if (res.data.length > 0) {
          setSelectedId((prev) => {
            if (latestArtifactId && res.data!.some((a) => a.id === latestArtifactId)) {
              return latestArtifactId;
            }
            return prev ?? res.data![0].id;
          });
        }
      }
    });
  };

  useEffect(() => {
    loadList();
  }, [client, workflowId, runId, latestArtifactId]);

  useEffect(() => {
    if (!client || !selectedId) { setSelectedContent(null); return; }
    setLoading(true);
    client.getArtifact(selectedId)
      .then((res) => {
        if (res.ok && res.data?.content) setSelectedContent(res.data.content);
        else setSelectedContent(null);
      })
      .finally(() => setLoading(false));
  }, [client, selectedId]);

  const handleReload = async () => {
    if (!client || !selectedId) return;
    setRefreshing(true);
    setStatusMsg(null);
    try {
      const res = await client.refreshArtifact(selectedId, 'reload');
      if (res.ok && res.data?.content) {
        setSelectedContent(res.data.content);
        setStatusMsg('Content reloaded');
      } else {
        const again = await client.getArtifact(selectedId);
        if (again.ok && again.data?.content) setSelectedContent(again.data.content);
      }
      loadList();
    } finally {
      setRefreshing(false);
      setTimeout(() => setStatusMsg(null), 2500);
    }
  };

  const handleRerun = async () => {
    if (!client || !selectedId) return;
    setRefreshing(true);
    setStatusMsg(null);
    try {
      const res = await client.refreshArtifact(selectedId, 'rerun');
      if (res.ok && res.meta?.mode === 'rerun') {
        setStatusMsg(res.meta.message ?? 'Re-running workflow…');
        onRerunWorkflow?.();
      } else if (onRerunWorkflow) {
        onRerunWorkflow();
      } else {
        setStatusMsg((res as { error?: string }).error ?? 'Re-run not available');
      }
    } finally {
      setRefreshing(false);
      setTimeout(() => setStatusMsg(null), 3000);
    }
  };

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm gap-2 p-4">
        <span className="text-2xl">🖼</span>
        <span>No artifacts yet</span>
        <span className="text-xs text-white/20 text-center">
          Run the workflow — HTML outputs are auto-saved as artifacts
        </span>
        {onRerunWorkflow && (
          <button
            type="button"
            disabled={isRunning}
            onClick={() => onRerunWorkflow()}
            className="mt-2 rounded px-3 py-1.5 text-xs text-white disabled:opacity-40"
            style={{ backgroundColor: '#10b981' }}
          >
            {isRunning ? 'Running…' : 'Run workflow'}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-white/10 shrink-0">
        <div className="flex gap-1 flex-1 overflow-x-auto">
          {artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelectedId(a.id)}
              className={`px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${
                selectedId === a.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-white/5 text-white/50 hover:bg-white/10'
              }`}
            >
              {a.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void handleReload()}
          disabled={!selectedId || refreshing}
          className="shrink-0 rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
          title="Reload stored content"
        >
          {refreshing ? '…' : '↻ Reload'}
        </button>
        {onRerunWorkflow && (
          <button
            type="button"
            onClick={() => void handleRerun()}
            disabled={refreshing || isRunning}
            className="shrink-0 rounded px-2 py-1 text-xs text-emerald-300 hover:bg-white/10 disabled:opacity-40"
            title="Re-run workflow to regenerate artifact"
          >
            ▶ Re-run
          </button>
        )}
      </div>
      {statusMsg && (
        <p className="px-2 py-1 text-[10px] text-white/40 border-b border-white/5">{statusMsg}</p>
      )}

      {/* Preview iframe */}
      <div className="flex-1 min-h-0 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/20 text-white/40 text-sm z-10">
            Loading…
          </div>
        )}
        {selectedContent ? (
          <iframe
            key={`${selectedId}-${selectedContent.length}`}
            title="Artifact preview"
            sandbox="allow-scripts"
            srcDoc={selectedContent}
            className="w-full h-full border-0 bg-white rounded"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-white/30 text-sm">
            Select an artifact to preview
          </div>
        )}
      </div>
    </div>
  );
}
