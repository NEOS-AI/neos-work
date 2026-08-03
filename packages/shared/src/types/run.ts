/**
 * @deprecated Import run types/helpers from `./project.js` (or `@neos-work/shared`).
 * Re-exported here for any transitional imports of `types/run`.
 */
export {
  isActiveRunStatus,
  isTerminalRunStatus,
  normalizeRunStatus,
  type ProjectRunEvent,
  type ProjectRunEventType,
  type ProjectRunStatus,
  type ProjectRunSummary,
} from './project.js';
