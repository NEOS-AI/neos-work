/**
 * Harness registry — thin compatibility layer over Domain Pack workers.
 *
 * @deprecated Prefer `resolveWorker` / `listWorkers` / `registerWorker` from
 * `../packs/index.js`. These exports remain for v0.4.x call sites.
 */

export {
  resolveWorker as resolveHarness,
  listWorkers as listHarnesses,
  registerWorker as registerHarness,
  resolveWorker,
  listWorkers,
  registerWorker,
} from '../packs/index.js';
