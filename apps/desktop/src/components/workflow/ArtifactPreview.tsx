import { useEffect, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { Artifact } from '../../lib/engine.js';

interface ArtifactPreviewProps {
  workflowId: string;
  /** If provided, show only artifacts for this run */
  runId?: string;
  /** Latest artifactId from SSE run.completed event — triggers reload */
  latestArtifactId?: string;
}

export function ArtifactPreview({ workflowId, runId, latestArtifactId }: ArtifactPreviewProps) {
  const { client } = useEngine();
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadList = () => {
    if (!client) return;
    const params = runId ? { runId } : { workflowId };
    client.listArtifacts(params).then((res) => {
      if (res.ok && res.data) {
        setArtifacts(res.data);
        if (res.data.length > 0) {
          setSelectedId((prev) => prev ?? res.data![0].id);
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

  const handleRefresh = async () => {
    if (!client || !selectedId) return;
    setRefreshing(true);
    try {
      const res = await client.refreshArtifact(selectedId);
      if (res.ok && res.data?.content) {
        setSelectedContent(res.data.content);
      } else {
        // Fall back to re-fetch
        const again = await client.getArtifact(selectedId);
        if (again.ok && again.data?.content) setSelectedContent(again.data.content);
      }
      loadList();
    } finally {
      setRefreshing(false);
    }
  };

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-white/30 text-sm gap-2">
        <span className="text-2xl">🖼</span>
        <span>No artifacts yet</span>
        <span className="text-xs text-white/20">Run the workflow — HTML outputs are auto-saved as artifacts</span>
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
          onClick={() => void handleRefresh()}
          disabled={!selectedId || refreshing}
          className="shrink-0 rounded px-2 py-1 text-xs text-white/70 hover:bg-white/10 disabled:opacity-40"
          title="Refresh preview"
        >
          {refreshing ? '…' : '↻ Refresh'}
        </button>
      </div>

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
