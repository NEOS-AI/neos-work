import { scrubError } from './scrub.js';

type ExportZipClient = {
  exportProjectZip(
    id: string,
  ): Promise<{ ok: true; blob: Blob } | { ok: false; error?: string }>;
};

/** Safe download filename stem: alphanumeric / _ / - only, max 60. */
function safeZipStem(name: string, projectId: string): string {
  const base = (name || projectId).replace(/[\0\r\n]+/g, ' ');
  return base.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 60) || projectId.slice(0, 8);
}

/**
 * Export a project as ZIP and trigger a browser download.
 * Does not throw on API/network failure — returns scrubbed error instead.
 */
export async function downloadProjectZip(
  client: ExportZipClient,
  projectId: string,
  name: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await client.exportProjectZip(projectId);
    if (!res.ok) {
      return { ok: false, error: scrubError(res.error, 'Export failed') };
    }
    const url = URL.createObjectURL(res.blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = `${safeZipStem(name, projectId)}.neos-project.zip`;
      a.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: scrubError(err, 'Export failed') };
  }
}
