/**
 * Detect HTML-like agent outputs for Live Artifact auto-save (plan Task 4).
 */

export function isHtmlArtifactOutput(output: unknown): output is string {
  if (typeof output !== 'string') return false;
  const htmlContent = output.trim();
  if (!htmlContent.startsWith('<')) return false;
  const head = htmlContent.slice(0, 200).toLowerCase();
  return (
    head.startsWith('<!doctype html')
    || head.startsWith('<html')
    || htmlContent.includes('<html')
    || htmlContent.includes('<div')
    || htmlContent.includes('<svg')
  );
}

/** Cap auto-saved HTML artifacts (2 MiB) to avoid DB bloat from runaway agent output. */
export const HTML_ARTIFACT_MAX_CHARS = 2 * 1024 * 1024;

/**
 * Scan nodeResults map and create the first HTML artifact.
 * Returns artifact id or undefined.
 */
export function createFirstHtmlArtifact(options: {
  workflowId: string;
  runId: string;
  nodeResults: Record<string, unknown>;
  create: (input: {
    workflowId: string;
    runId: string;
    name: string;
    contentType: string;
    content: string;
    nodeId: string;
  }) => { id: string };
}): string | undefined {
  const workflowId = typeof options.workflowId === 'string' ? options.workflowId.trim() : '';
  const runId = typeof options.runId === 'string' ? options.runId.trim() : '';
  if (!workflowId || !runId) return undefined;

  for (const [nodeId, result] of Object.entries(options.nodeResults ?? {})) {
    const r = result as { output?: unknown; status?: string };
    const status = typeof r.status === 'string' ? r.status.trim().toLowerCase() : '';
    if (status !== 'completed' || !isHtmlArtifactOutput(r.output)) continue;
    const nid = typeof nodeId === 'string' ? nodeId.trim() : String(nodeId);
    if (!nid) continue;
    const content = r.output.trim();
    // Skip pathological oversized HTML rather than failing the whole run
    if (content.length > HTML_ARTIFACT_MAX_CHARS) continue;
    const artifact = options.create({
      workflowId,
      runId,
      name: `Output (${nid})`,
      contentType: 'text/html',
      content,
      nodeId: nid,
    });
    return artifact.id;
  }
  return undefined;
}
