/**
 * @deprecated Import from `./workers.js`. Re-exports custom worker CRUD (table `workers`).
 */
export {
  listCustomWorkers as listCustomHarnesses,
  getCustomWorker as getCustomHarness,
  createCustomWorker as createCustomHarness,
  updateCustomWorker as updateCustomHarness,
  deleteCustomWorker as deleteCustomHarness,
  listCustomWorkers,
  getCustomWorker,
  createCustomWorker,
  updateCustomWorker,
  deleteCustomWorker,
  HARNESS_SYSTEM_PROMPT_MAX_CHARS,
  HARNESS_DESCRIPTION_MAX_CHARS,
  HARNESS_NAME_MAX_CHARS,
  HARNESS_ALLOWED_TOOLS_MAX,
  HARNESS_TOOL_NAME_MAX_CHARS,
  HARNESS_CONSTRAINTS_JSON_MAX_CHARS,
  WORKER_SYSTEM_PROMPT_MAX_CHARS,
  WORKER_DESCRIPTION_MAX_CHARS,
  WORKER_NAME_MAX_CHARS,
} from './workers.js';
