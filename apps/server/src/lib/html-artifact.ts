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
  for (const [nodeId, result] of Object.entries(options.nodeResults)) {
    const r = result as { output?: unknown; status?: string };
    if (r.status !== 'completed' || !isHtmlArtifactOutput(r.output)) continue;
    const artifact = options.create({
      workflowId: options.workflowId,
      runId: options.runId,
      name: `Output (${nodeId})`,
      contentType: 'text/html',
      content: r.output.trim(),
      nodeId,
    });
    return artifact.id;
  }
  return undefined;
}
