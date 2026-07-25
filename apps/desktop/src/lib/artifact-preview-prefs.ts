/** Persist Artifact Preview viewport mode (PLAN Task 4 polish). */

const VIEWPORT_KEY = 'neos-artifact-viewport';

export type ArtifactViewportMode = 'full' | 'tablet' | 'mobile';

export const ARTIFACT_VIEWPORT_MODES: readonly ArtifactViewportMode[] = [
  'full',
  'tablet',
  'mobile',
] as const;

const ALLOWED = new Set<string>(['full', 'tablet', 'mobile']);

function parseViewport(raw: unknown): ArtifactViewportMode | null {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return null;
  const v = raw.trim();
  return ALLOWED.has(v) ? (v as ArtifactViewportMode) : null;
}

export function loadArtifactViewport(): ArtifactViewportMode {
  try {
    return parseViewport(localStorage.getItem(VIEWPORT_KEY)) ?? 'full';
  } catch {
    return 'full';
  }
}

export function saveArtifactViewport(mode: ArtifactViewportMode): void {
  try {
    const parsed = parseViewport(mode);
    if (parsed) localStorage.setItem(VIEWPORT_KEY, parsed);
  } catch {
    // ignore quota / private mode
  }
}
