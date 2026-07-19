/** Persist Artifact Preview viewport mode (PLAN Task 4 polish). */

const VIEWPORT_KEY = 'neos-artifact-viewport';

export type ArtifactViewportMode = 'full' | 'tablet' | 'mobile';

export const ARTIFACT_VIEWPORT_MODES: readonly ArtifactViewportMode[] = [
  'full',
  'tablet',
  'mobile',
] as const;

export function loadArtifactViewport(): ArtifactViewportMode {
  try {
    const v = localStorage.getItem(VIEWPORT_KEY);
    if (v === 'full' || v === 'tablet' || v === 'mobile') return v;
    return 'full';
  } catch {
    return 'full';
  }
}

export function saveArtifactViewport(mode: ArtifactViewportMode): void {
  try {
    if (mode === 'full' || mode === 'tablet' || mode === 'mobile') {
      localStorage.setItem(VIEWPORT_KEY, mode);
    }
  } catch {
    // ignore quota / private mode
  }
}
