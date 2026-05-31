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

  useEffect(() => {
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
      {/* Artifact selector */}
      {artifacts.length > 1 && (
        <div className="flex gap-1 p-2 border-b border-white/10 overflow-x-auto shrink-0">
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
            key={selectedId}
            title="Artifact preview"
            sandbox="allow-scripts allow-same-origin"
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
