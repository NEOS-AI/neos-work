/**
 * Detect HTML-like agent outputs for Live Artifact auto-save (plan Task 4).
 */

export function isHtmlArtifactOutput(output: unknown): output is string {
  if (typeof output !== 'string') return false;
  const htmlContent = output.trim();
  if (!htmlContent.startsWith('<')) return false;
  // Only scan a bounded prefix for markers (avoid scanning multi-MiB agent dumps)
  const head = htmlContent.slice(0, 200).toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html')) return true;
  const scan = htmlContent.slice(0, 8_192).toLowerCase();
  return (
    scan.includes('<html')
    || scan.includes('<div')
    || scan.includes('<svg')
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
  const workflowIdRaw = typeof options.workflowId === 'string' ? options.workflowId : '';
  const runIdRaw = typeof options.runId === 'string' ? options.runId : '';
  // Cap path/DB ids; reject control chars before trim (align with artifact route safeId)
  if (
    !workflowIdRaw
    || !runIdRaw
    || /[\0\r\n]/.test(workflowIdRaw)
    || /[\0\r\n]/.test(runIdRaw)
  ) {
    return undefined;
  }
  const workflowId = workflowIdRaw.trim();
  const runId = runIdRaw.trim();
  if (!workflowId || !runId || workflowId.length > 100 || runId.length > 100) {
    return undefined;
  }

  for (const [nodeId, result] of Object.entries(options.nodeResults ?? {})) {
    const r = result as { output?: unknown; status?: string };
    const status = typeof r.status === 'string' ? r.status.trim().toLowerCase() : '';
    if (status !== 'completed' || !isHtmlArtifactOutput(r.output)) continue;
    const nidRaw = typeof nodeId === 'string' ? nodeId : String(nodeId);
    if (!nidRaw || /[\0\r\n]/.test(nidRaw)) continue;
    const nid = nidRaw.trim();
    if (!nid || nid.length > 200) continue;
    const content = r.output.trim();
    // Skip pathological oversized HTML rather than failing the whole run
    if (content.length > HTML_ARTIFACT_MAX_CHARS) continue;
    // Artifact name: keep short and free of control chars
    const safeLabel = nid.replace(/[^\w.-]+/g, '_').slice(0, 80) || 'node';
    const artifact = options.create({
      workflowId,
      runId,
      name: `Output (${safeLabel})`,
      contentType: 'text/html',
      content,
      nodeId: nid,
    });
    return artifact.id;
  }
  return undefined;
}
