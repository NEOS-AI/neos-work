#!/usr/bin/env node
/**
 * Capability inventory dump (PLAN_FOR_V0_5_0 Task 17).
 *
 * Scans in-repo catalogs (agents, skills, design-systems, plugins, media,
 * domain packs, MCP tools, plugin atoms) and prints JSON.
 *
 * Usage:
 *   node tools/inventory/inventory.mjs
 *   node tools/inventory/inventory.mjs --write   # also writes docs/generated/capability-inventory.json
 *   node tools/inventory/inventory.mjs --check   # exit 1 if gates fail
 *
 * Env:
 *   NEOS_INVENTORY_OUT  override write path
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const GATES = {
  minAgentCliDefs: 12,
  minPluginAtoms: 12,
  minSkills: 5,
  minDesignSystems: 2,
  minMediaProviders: 4,
  minMcpTools: 6,
  minDomainPacks: 4,
  minMediaSurfaces: 3, // image, audio, video
  /** v0.6 train feature files that must remain present */
  requireV06Features: true,
  /** v0.7 train (M0–M4 closeout) */
  requireV07Features: true,
  /** v0.8 train (M0–M4 closeout) */
  requireV08Features: true,
  /** v0.9 train (M0–M4 closeout) */
  requireV09Features: true,
  /** v0.10 train (M0–M3 closeout) */
  requireV10Features: true,
  /** v0.11 train (M0–M3 closeout) */
  requireV11Features: true,
  /** v0.12 train (M0–M3 closeout) */
  requireV12Features: true,
  /** v0.13 train (M0–M3 closeout) */
  requireV13Features: true,
  /** v0.14 train (M1 process e2e + M3 multi-replica lock depth) */
  requireV14Features: true,
  /** v0.15 train (M2 Playwright browser Design Project loop) */
  requireV15Features: true,
  /** v0.16 train (A0 EngineSettings + B0 shared run registry) */
  requireV16Features: true,
  /** v0.17 train (EngineMediaClient skills/media/live-artifacts extract) */
  requireV17Features: true,
};

function existsRel(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

/** v0.6 capability surface (M0–M5) — presence in-repo, not runtime. */
function scanV06Features() {
  const features = {
    collabPresence: existsRel('apps/server/src/lib/project-collab.ts'),
    collabRoutes: existsRel('apps/server/src/routes/projects.ts')
      && (readText('apps/server/src/routes/projects.ts') ?? '').includes('collab/stream'),
    presencePeersBar: existsRel('packages/ui-app/src/PresencePeersBar.tsx'),
    jsxLayers: existsRel('packages/design-editor/src/jsx-layers.ts'),
    canvasOverlay: existsRel('packages/design-editor/src/CanvasOverlay.tsx'),
    sharedEditAdr: existsRel('docs/adr/0001-shared-edit-strategy.md'),
    marketplace: existsRel('apps/server/src/routes/marketplace.ts'),
    marketplaceCatalog: existsRel('apps/server/src/lib/marketplace-catalog.ts'),
    helmSnippet: existsRel('deploy/helm/neos-work/Chart.yaml'),
    migrationV06: existsRel('docs/migration/v0.6.0.md'),
    planV06: existsRel('docs/plans/PLAN_FOR_V0_6_0.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/** v0.7 capability surface (M0–M4) — canvas polish + collab transport. */
function scanV07Features() {
  const features = {
    planV07: existsRel('docs/plans/PLAN_FOR_V0_7_0.md'),
    migrationV07: existsRel('docs/migration/v0.7.0.md'),
    canvasResize: existsRel('packages/design-editor/src/CanvasOverlay.tsx')
      && (readText('packages/design-editor/src/canvas-style.ts') ?? '').includes(
        'applySizeDeltaToHtml',
      ),
    collabBus: existsRel('apps/server/src/lib/collab-bus.ts')
      && existsRel('apps/server/src/lib/collab-bus-redis.ts'),
    selectionAwareness:
      existsRel('apps/server/src/lib/project-collab.ts')
      && (readText('apps/server/src/lib/project-collab.ts') ?? '').includes('setSessionSelection')
      && (readText('apps/server/src/lib/collab-types.ts') ?? '').includes('selection.changed')
      && (readText('packages/ui-app/src/PresencePeersBar.tsx') ?? '').includes('selections'),
    canvasMultiSelect:
      existsRel('packages/design-editor/src/CanvasOverlay.tsx')
      && (readText('packages/design-editor/src/CanvasOverlay.tsx') ?? '').includes('extraBboxes')
      && (readText('packages/design-editor/src/bridge-inject.ts') ?? '').includes(
        'neos.highlight-multi',
      )
      && (readText('packages/design-editor/src/selection-state.ts') ?? '').includes(
        'toggleMultiSelectLayer',
      ),
    implM0: existsRel('docs/implementation/v0.7/v0.7.0.md'),
    implM1: existsRel('docs/implementation/v0.7/v0.7.1.md'),
    implM2: existsRel('docs/implementation/v0.7/v0.7.2.md'),
    implM3: existsRel('docs/implementation/v0.7/v0.7.3.md'),
    implM4: existsRel('docs/implementation/v0.7/v0.7.4.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/** v0.8 capability surface (M0–M4) — shared presence + canvas/collab polish. */
function scanV08Features() {
  const features = {
    planV08: existsRel('docs/plans/PLAN_FOR_V0_8_0.md'),
    migrationV08: existsRel('docs/migration/v0.8.0.md'),
    sharedPresence:
      existsRel('apps/server/src/lib/collab-presence-store.ts')
      && (readText('apps/server/src/lib/collab-types.ts') ?? '').includes('presence.heartbeat')
      && (readText('apps/server/src/lib/project-collab.ts') ?? '').includes(
        'hydrateMembershipFromRegistry',
      ),
    redisPresence:
      existsRel('apps/server/src/lib/collab-presence-redis.ts')
      && (readText('apps/server/src/lib/collab-presence-redis.ts') ?? '').includes(
        'createPresenceRegistry',
      )
      && (readText('apps/server/src/lib/collab-presence-store.ts') ?? '').includes(
        'hydrateMembershipFromRegistry',
      ),
    groupResize:
      existsRel('packages/design-editor/src/canvas-style.ts')
      && (readText('packages/design-editor/src/canvas-style.ts') ?? '').includes(
        'applyGroupResizeToHtml',
      )
      && (readText('packages/design-editor/src/canvas-style.ts') ?? '').includes(
        'computeGroupResizeScales',
      ),
    multiSelectCollab:
      (readText('apps/server/src/lib/collab-types.ts') ?? '').includes('selectors?:')
      && (readText('packages/design-editor/src/selection-state.ts') ?? '').includes(
        'selectionWithMulti',
      )
      && (readText('packages/ui-app/src/types.ts') ?? '').includes('selectors?:'),
    implM0: existsRel('docs/implementation/v0.8/v0.8.0.md'),
    implM1: existsRel('docs/implementation/v0.8/v0.8.1.md'),
    implM2: existsRel('docs/implementation/v0.8/v0.8.2.md'),
    implM3: existsRel('docs/implementation/v0.8/v0.8.3.md'),
    implM4: existsRel('docs/implementation/v0.8/v0.8.4.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.9 capability surface (M0–M4) — Design Editor completion · dual-surface parity.
 * @see docs/plans/PLAN_FOR_V0_9_0.md
 */
function scanV09Features() {
  const canvasStyle = readText('packages/design-editor/src/canvas-style.ts') ?? '';
  const htmlLayers = readText('packages/design-editor/src/html-layers.ts') ?? '';
  const webApi = readText('apps/web/src/lib/api.ts') ?? '';
  const sharedEnvelopes = readText('packages/shared/src/schemas/api-envelopes.ts') ?? '';
  const features = {
    planV09: existsRel('docs/plans/PLAN_FOR_V0_9_0.md'),
    migrationV09: existsRel('docs/migration/v0.9.0.md'),
    layersReorder:
      existsRel('packages/design-editor/src/html-layers.ts')
      && htmlLayers.includes('reorderSiblingInHtml')
      && htmlLayers.includes('applyZOrderInHtml'),
    canvasDefault:
      existsRel('packages/design-editor/src/canvas-style.ts')
      && canvasStyle.includes('CANVAS_OVERLAY_PREF_KEY')
      && canvasStyle.includes('writeCanvasOverlayPref')
      && canvasStyle.includes('isCanvasOverlayEnabled')
      // Q23: default on when no env/pref (function ends with return true)
      && /return true;\s*\}/.test(canvasStyle.replace(/\s+/g, ' ')),
    webPreviewComments:
      existsRel('apps/web/src/lib/api.ts')
      && webApi.includes('listPreviewComments')
      && webApi.includes('createPreviewComment')
      && webApi.includes('deletePreviewComment'),
    webProjectZip:
      existsRel('apps/web/src/lib/api.ts')
      && webApi.includes('importProjectZip')
      && webApi.includes('exportProjectZip'),
    dualSurfaceDoc: existsRel('docs/reference/dual-surface.md'),
    sharedPreviewCommentParse:
      sharedEnvelopes.includes('parsePreviewCommentListResponse')
      && sharedEnvelopes.includes('previewCommentSchema'),
    implM0: existsRel('docs/implementation/v0.9/v0.9.0.md'),
    implM1: existsRel('docs/implementation/v0.9/v0.9.1.md'),
    implM2: existsRel('docs/implementation/v0.9/v0.9.2.md'),
    implM3: existsRel('docs/implementation/v0.9/v0.9.3.md'),
    implM4: existsRel('docs/implementation/v0.9/v0.9.4.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.10 capability surface (M0–M3) — agent locks · shared lock registry · harness sunset.
 * @see docs/plans/PLAN_FOR_V0_10_0.md
 */
function scanV10Features() {
  const projectCollab = readText('apps/server/src/lib/project-collab.ts') ?? '';
  const lockStore = readText('apps/server/src/lib/collab-lock-store.ts') ?? '';
  const ttlReg = readText('apps/server/src/lib/collab-ttl-registry.ts') ?? '';
  const locksRedis = readText('apps/server/src/lib/collab-locks-redis.ts') ?? '';
  const harness = readText('apps/server/src/routes/harness.ts') ?? '';
  const indexTs = readText('apps/server/src/index.ts') ?? '';
  const ops = readText('docs/ops/multi-replica-collab.md') ?? '';
  const features = {
    planV10: existsRel('docs/plans/PLAN_FOR_V0_10_0.md'),
    migrationV10: existsRel('docs/migration/v0.10.0.md'),
    releaseV10: existsRel('docs/releases/v0.10.3.md'),
    agentLockEnforce:
      projectCollab.includes('isSharedEditAgentsHardEnforce')
      && projectCollab.includes('shouldHardEnforceWriteSource')
      && projectCollab.includes('NEOS_SHARED_EDIT_AGENTS'),
    sharedLockRegistry:
      existsRel('apps/server/src/lib/collab-ttl-registry.ts')
      && existsRel('apps/server/src/lib/collab-locks-redis.ts')
      && existsRel('apps/server/src/lib/collab-lock-store.ts')
      && ttlReg.includes('createTtlJsonRegistry')
      && locksRedis.includes('NEOS_COLLAB_LOCKS')
      && lockStore.includes('hydrateLocksFromRegistry')
      && lockStore.includes('fill-missing'),
    lockSafeHydrate:
      lockStore.includes('releaseTombstones')
      || (lockStore.includes('tombstone') && lockStore.includes('hydrateLocksFromRegistry')),
    harnessHttpGone:
      harness.includes('410')
      && harness.includes('/api/workers')
      && (harness.includes('GONE') || harness.includes('Gone')),
    collabStatusLocks:
      indexTs.includes('getLockRegistry')
      && indexTs.includes('initLockRegistry')
      && /locks:\s*\{/.test(indexTs),
    opsCollabLocks:
      ops.includes('NEOS_COLLAB_LOCKS')
      && ops.includes('neos:collab:lock'),
    apiSurfaceOrphans: existsRel('docs/reference/api-surface-notes.md'),
    implM0: existsRel('docs/implementation/v0.10/v0.10.0.md'),
    implM1: existsRel('docs/implementation/v0.10/v0.10.1.md'),
    implM2: existsRel('docs/implementation/v0.10/v0.10.2.md'),
    implM3: existsRel('docs/implementation/v0.10/v0.10.3.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.11 capability surface (M0–M3) — run→session bind · lock UX · tool files · workers rename.
 * @see docs/plans/PLAN_FOR_V0_11_0.md
 */
function scanV11Features() {
  const runs = readText('apps/server/src/routes/runs.ts') ?? '';
  const projects = readText('apps/server/src/routes/projects.ts') ?? '';
  const hardEnforce = readText('apps/server/src/lib/collab-hard-enforce.ts') ?? '';
  const toolsFiles = readText('apps/server/src/routes/tools-files.ts') ?? '';
  const toolTokens = readText('apps/server/src/lib/tool-tokens.ts') ?? '';
  const indexTs = readText('apps/server/src/index.ts') ?? '';
  const collabUx = readText('packages/shared/src/collab-ux.ts') ?? '';
  const appTsx = readText('apps/desktop/src/App.tsx') ?? '';
  const sidebar = readText('apps/desktop/src/components/Sidebar.tsx') ?? '';
  const harnessPage = readText('apps/desktop/src/pages/Harnesses.tsx') ?? '';
  const features = {
    planV11: existsRel('docs/plans/PLAN_FOR_V0_11_0.md'),
    migrationV11: existsRel('docs/migration/v0.11.0.md'),
    releaseV11: existsRel('docs/releases/v0.11.3.md'),
    runSessionBind:
      runs.includes('resolveRunCollabSessionBind')
      && runs.includes('collabSessionId')
      && hardEnforce.includes('resolveCollabSessionIdForWrite')
      && hardEnforce.includes('fallbackRunId'),
    lockEnforceUx:
      existsRel('packages/shared/src/collab-ux.ts')
      && collabUx.includes('formatLockHolderMessage')
      && collabUx.includes('formatRunLockFailureMessage')
      && collabUx.includes('parseCollabStatusData'),
    toolPathLockParity:
      existsRel('apps/server/src/routes/tools-files.ts')
      && toolsFiles.includes("requireToolCapability(rec, 'files')")
      && toolsFiles.includes('shouldHardEnforceWriteSource')
      && toolTokens.includes("'files'")
      && indexTs.includes('tools/files'),
    workersUiRename:
      appTsx.includes("path: 'workers'")
      && appTsx.includes("path: 'harnesses'")
      && sidebar.includes("id: 'workers'")
      && sidebar.includes("path: '/workers'")
      && (harnessPage.includes('export function Workers')
        || harnessPage.includes('export const Workers')),
    implM0: existsRel('docs/implementation/v0.11/v0.11.0.md'),
    implM1: existsRel('docs/implementation/v0.11/v0.11.1.md'),
    implM2: existsRel('docs/implementation/v0.11/v0.11.2.md'),
    implM3: existsRel('docs/implementation/v0.11/v0.11.3.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.12 capability surface (M0–M3) — EngineClient modularization · ops docs.
 * @see docs/plans/PLAN_FOR_V0_12_0.md
 */
function scanV12Features() {
  const engineTs = readText('apps/desktop/src/lib/engine.ts') ?? '';
  const transport = readText('apps/desktop/src/lib/engine-transport.ts') ?? '';
  const project = readText('apps/desktop/src/lib/engine-project.ts') ?? '';
  const workflow = readText('apps/desktop/src/lib/engine-workflow.ts') ?? '';
  const multiOps = readText('docs/ops/multi-replica-collab.md') ?? '';
  const sticky = readText('docs/ops/sticky-sse.md') ?? '';
  const features = {
    planV12: existsRel('docs/plans/PLAN_FOR_V0_12_0.md'),
    migrationV12: existsRel('docs/migration/v0.12.0.md'),
    releaseV12: existsRel('docs/releases/v0.12.3.md'),
    engineTransport:
      existsRel('apps/desktop/src/lib/engine-transport.ts')
      && transport.includes('export class EngineTransport'),
    engineProject:
      existsRel('apps/desktop/src/lib/engine-project.ts')
      && project.includes('export class EngineProjectClient')
      && project.includes('extends EngineTransport'),
    engineWorkflow:
      existsRel('apps/desktop/src/lib/engine-workflow.ts')
      && workflow.includes('export class EngineWorkflowClient')
      && workflow.includes('extends EngineProjectClient'),
    // v0.12: EngineClient extends EngineWorkflowClient; v0.16 Settings; v0.17 Media
    engineClientExtends:
      /export class EngineClient extends Engine(Workflow|Settings|Media)Client/.test(engineTs)
      && (
        engineTs.includes('extends EngineWorkflowClient')
        || engineTs.includes('EngineSettingsClient')
        || engineTs.includes('EngineMediaClient')
      ),
    stickySseDoc:
      existsRel('docs/ops/sticky-sse.md')
      && sticky.includes('not implemented')
      && (sticky.includes('Sticky SSE') || sticky.includes('sticky SSE')),
    fileSsotOps:
      multiOps.includes('File content SSOT')
      && multiOps.includes('NEOS_DATA_DIR')
      && multiOps.toLowerCase().includes('multi-writer'),
    implM0: existsRel('docs/implementation/v0.12/v0.12.0.md'),
    implM1: existsRel('docs/implementation/v0.12/v0.12.1.md'),
    implM2: existsRel('docs/implementation/v0.12/v0.12.2.md'),
    implM3: existsRel('docs/implementation/v0.12/v0.12.3.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.13 capability surface (M0–M3) — FE/BE contract gates for shared-edit.
 * @see docs/plans/PLAN_FOR_V0_13_0.md
 */
function scanV13Features() {
  const contract = readText('apps/server/src/routes/contract-fe-be.test.ts') ?? '';
  const sharedEnvTest = readText('packages/shared/src/schemas/api-envelopes.test.ts') ?? '';
  const features = {
    planV13: existsRel('docs/plans/PLAN_FOR_V0_13_0.md'),
    migrationV13: existsRel('docs/migration/v0.13.0.md'),
    releaseV13: existsRel('docs/releases/v0.13.3.md'),
    contractAgent423:
      contract.includes('agent hard-enforce 423')
      && contract.includes('NEOS_SHARED_EDIT_AGENTS')
      && contract.includes('parseCollabLockConflict'),
    contractRunBind:
      contract.includes('collabSessionId bind')
      && contract.includes('runId')
      && contract.includes('parseProjectRunSummaryResponse'),
    contractToolsFiles:
      contract.includes('tools/files write')
      && contract.includes("/api/tools/files")
      && contract.includes("capabilities: ['files']"),
    contractLocksFlags:
      contract.includes('hardEnforce')
      && contract.includes('agentsHardEnforce')
      && contract.includes('parseCollabLocksSnapshot'),
    contractCollabSessionId:
      contract.includes('collabSessionId on summary')
      || contract.includes('returns collabSessionId'),
    sharedParseLocksFlags:
      sharedEnvTest.includes('collab locks snapshot with enforce flags')
      && sharedEnvTest.includes('collabSessionId: null'),
    implM0: existsRel('docs/implementation/v0.13/v0.13.0.md'),
    implM1: existsRel('docs/implementation/v0.13/v0.13.1.md'),
    implM2: existsRel('docs/implementation/v0.13/v0.13.2.md'),
    implM3: existsRel('docs/implementation/v0.13/v0.13.3.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.14 capability surface (M1 process e2e + M3 multi-replica lock depth).
 * @see docs/plans/PLAN_FOR_V0_14_0.md
 */
function scanV14Features() {
  const journey = readText('e2e/journey/run.mjs') ?? '';
  const multiReplica = readText('e2e/multi-replica/run.mjs') ?? '';
  const pkg = readText('package.json') ?? '';
  const ci = readText('.github/workflows/ci.yml') ?? '';
  const features = {
    planV14: existsRel('docs/plans/PLAN_FOR_V0_14_0.md'),
    migrationV14: existsRel('docs/migration/v0.14.0.md'),
    releaseV14: existsRel('docs/releases/v0.14.1.md'),
    journeyScript:
      existsRel('e2e/journey/run.mjs')
      && (
        journey.includes('e2e:journey')
        || journey.includes('golden path')
        || journey.includes('NEOS_SHARED_EDIT')
      ),
    journeyPackageScript:
      pkg.includes('"e2e:journey"') || pkg.includes("'e2e:journey'"),
    journeyCi: ci.includes('e2e:journey'),
    multiReplicaAgent423:
      multiReplica.includes('NEOS_SHARED_EDIT_AGENTS')
      && (
        multiReplica.includes('L7')
        || multiReplica.includes('agent PUT 423')
        || (multiReplica.includes('agent') && multiReplica.includes('423'))
      ),
    implM1: existsRel('docs/implementation/v0.14/v0.14.0.md'),
    implM3: existsRel('docs/implementation/v0.14/v0.14.1.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.15 capability surface (M2 Playwright browser Design Project loop).
 * @see docs/plans/PLAN_FOR_V0_15_0.md
 */
function scanV15Features() {
  const browserSpec = readText('e2e/browser/specs/design-project.spec.ts') ?? '';
  const pkg = readText('package.json') ?? '';
  const ci = readText('.github/workflows/ci.yml') ?? '';
  const features = {
    planV15: existsRel('docs/plans/PLAN_FOR_V0_15_0.md'),
    migrationV15: existsRel('docs/migration/v0.15.0.md'),
    releaseV15: existsRel('docs/releases/v0.15.0.md'),
    browserScript: existsRel('e2e/browser/run.mjs'),
    browserSpec:
      existsRel('e2e/browser/specs/design-project.spec.ts')
      && (
        browserSpec.includes('connect')
        || browserSpec.includes('design-editor')
        || browserSpec.includes('preview-frame')
      ),
    browserPackageScript:
      pkg.includes('"e2e:browser"') || pkg.includes("'e2e:browser'"),
    browserCi: ci.includes('e2e:browser'),
    playwrightConfig: existsRel('e2e/browser/playwright.config.ts'),
    implM2: existsRel('docs/implementation/v0.15/v0.15.0.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.16 capability surface (A0 EngineSettings + B0 shared run registry).
 * @see docs/plans/PLAN_FOR_V0_16_0.md
 */
function scanV16Features() {
  const engineSettings = readText('apps/desktop/src/lib/engine-settings.ts') ?? '';
  const engine = readText('apps/desktop/src/lib/engine.ts') ?? '';
  const runRegistryShared = readText('apps/server/src/lib/run-registry-shared.ts') ?? '';
  const multiReplica = readText('docs/ops/multi-replica-collab.md') ?? '';
  // v0.17 inserts EngineMediaClient between EngineSettingsClient and EngineClient
  const settingsInChain =
    engine.includes('extends EngineSettingsClient')
    || engine.includes('class EngineClient extends EngineSettingsClient')
    || engine.includes('EngineMediaClient')
    || (readText('apps/desktop/src/lib/engine-media.ts') ?? '').includes(
      'extends EngineSettingsClient',
    );
  const features = {
    planV16: existsRel('docs/plans/PLAN_FOR_V0_16_0.md'),
    migrationV16: existsRel('docs/migration/v0.16.0.md'),
    releaseV16: existsRel('docs/releases/v0.16.2.md'),
    engineSettings:
      existsRel('apps/desktop/src/lib/engine-settings.ts')
      && engineSettings.includes('EngineSettingsClient')
      && settingsInChain,
    runRegistryShared:
      existsRel('apps/server/src/lib/run-registry-shared.ts')
      && (
        runRegistryShared.includes('NEOS_RUN_REGISTRY')
        || (readText('apps/server/src/index.ts') ?? '').includes('NEOS_RUN_REGISTRY')
      ),
    implA: existsRel('docs/implementation/v0.16/v0.16.0.md'),
    implB: existsRel('docs/implementation/v0.16/v0.16.1.md'),
    multiReplicaRunsDoc:
      existsRel('docs/ops/multi-replica-collab.md')
      && (
        multiReplica.includes('NEOS_RUN_REGISTRY')
        || multiReplica.toLowerCase().includes('run registry')
      ),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

/**
 * v0.17 capability surface (EngineMediaClient skills + media + live artifacts).
 * @see docs/plans/PLAN_FOR_V0_17_0.md
 */
function scanV17Features() {
  const engineMedia = readText('apps/desktop/src/lib/engine-media.ts') ?? '';
  const engine = readText('apps/desktop/src/lib/engine.ts') ?? '';
  const features = {
    planV17: existsRel('docs/plans/PLAN_FOR_V0_17_0.md'),
    migrationV17: existsRel('docs/migration/v0.17.0.md'),
    releaseV17: existsRel('docs/releases/v0.17.0.md'),
    engineMedia:
      existsRel('apps/desktop/src/lib/engine-media.ts')
      && engineMedia.includes('EngineMediaClient')
      && engineMedia.includes('extends EngineSettingsClient')
      && (
        engine.includes('extends EngineMediaClient')
        || engine.includes('class EngineClient extends EngineMediaClient')
      ),
    implM0: existsRel('docs/implementation/v0.17/v0.17.0.md'),
  };
  const missing = Object.entries(features)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);
  return {
    ok: missing.length === 0,
    count: Object.values(features).filter(Boolean).length,
    total: Object.keys(features).length,
    features,
    missing,
  };
}

function readText(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

function readJson(rel) {
  const t = readText(rel);
  if (t == null) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function listDirs(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => d.name)
    .sort();
}

function extractStringIds(source, pattern) {
  if (!source) return [];
  const out = [];
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, 'g');
  let m;
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  while ((m = g.exec(source)) !== null) {
    const id = m[1]?.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function scanAgentCliDefs() {
  const src =
    readText('packages/agent-runtime/src/defs/catalog.ts')
    || readText('packages/agent-runtime/dist/defs/catalog.js')
    || '';
  // id: 'cli-…'
  const ids = extractStringIds(src, /\bid:\s*['"](cli-[a-z0-9_-]+)['"]/gi);
  const names = extractStringIds(src, /\bname:\s*['"]([^'"]+)['"]/g);
  return {
    count: ids.length,
    ids,
    names: names.slice(0, ids.length),
  };
}

function scanPluginAtoms() {
  const src =
    readText('packages/plugin-runtime/src/atoms.ts')
    || readText('packages/plugin-runtime/dist/atoms.js')
    || '';
  const ids = extractStringIds(src, /\bid:\s*['"]([a-z][a-z0-9_.-]*)['"]/gi);
  // Filter to atom-like ids (contain a dot, e.g. prompt.system)
  const atomIds = ids.filter((id) => id.includes('.'));
  return { count: atomIds.length, ids: atomIds };
}

function scanSkills() {
  const names = listDirs('skills');
  const packages = [];
  for (const name of names) {
    const skillMd = path.join(ROOT, 'skills', name, 'SKILL.md');
    const flat = path.join(ROOT, 'skills', `${name}.md`);
    const hasPackage = fs.existsSync(skillMd);
    const hasFlat = fs.existsSync(flat);
    if (!hasPackage && !hasFlat) continue;
    packages.push({
      id: name,
      kind: hasPackage ? 'package' : 'flat',
      path: hasPackage ? `skills/${name}/SKILL.md` : `skills/${name}.md`,
    });
  }
  return { count: packages.length, items: packages };
}

function scanDesignSystems() {
  const names = listDirs('design-systems');
  const items = [];
  for (const name of names) {
    const manifestRel = `design-systems/${name}/manifest.json`;
    const manifest = readJson(manifestRel);
    items.push({
      id: name,
      path: manifestRel,
      schema: manifest?.schema ?? null,
      name: manifest?.name ?? name,
    });
  }
  return { count: items.length, items };
}

function scanPlugins() {
  const items = [];
  for (const tier of ['_official', 'community']) {
    const base = path.join('plugins', tier);
    for (const name of listDirs(base)) {
      const manifestRel = path.join(base, name, 'open-design.json');
      const manifest = readJson(manifestRel);
      items.push({
        id: name,
        tier: tier.replace(/^_/, ''),
        path: manifestRel,
        name: manifest?.name ?? name,
      });
    }
  }
  return { count: items.length, items };
}

function scanMediaProviders() {
  const src =
    readText('apps/server/src/lib/media-providers.ts')
    || '';
  const ids = extractStringIds(src, /\bid:\s*['"]([a-z0-9-]+)['"]/gi).filter((id) =>
    ['openai', 'azure-openai', 'google', 'xai', 'openai-compatible', 'stub'].includes(id)
    || id.includes('openai')
    || id === 'google'
    || id === 'xai'
    || id === 'stub',
  );
  // Fallback: known catalog order from MEDIA_PROVIDER_CATALOG
  const known = ['openai', 'azure-openai', 'google', 'xai', 'openai-compatible', 'stub'];
  const found = known.filter((k) => src.includes(`id: '${k}'`) || src.includes(`id: "${k}"`));
  const finalIds = found.length ? found : ids;
  const surfaces = [];
  for (const s of ['image', 'audio', 'video']) {
    if (src.includes(`'${s}'`) || src.includes(`"${s}"`)) surfaces.push(s);
  }
  return {
    count: finalIds.length,
    ids: finalIds,
    surfaces: surfaces.length ? surfaces : ['image', 'audio', 'video'],
  };
}

function scanDomainPacks() {
  const src =
    readText('packages/workflow-engine/src/packs/index.ts')
    || '';
  // Built-in pack blocks: id: 'finance' etc near pack definitions
  const builtin = ['finance', 'coding', 'research', 'general'].filter(
    (id) => src.includes(`id: '${id}'`) || src.includes(`id: "${id}"`),
  );
  return {
    count: builtin.length,
    ids: builtin,
    customLoader: src.includes('registerPack') || src.includes('parsePackManifest'),
  };
}

function scanMcpTools() {
  const src =
    readText('packages/mcp-client/src/neos-mcp-server.ts')
    || readText('packages/mcp-client/dist/neos-mcp-server.js')
    || '';
  const ids = extractStringIds(src, /name:\s*['"](neos_[a-z0-9_]+)['"]/gi);
  return { count: ids.length, ids };
}

function monorepoVersion() {
  const pkg = readJson('package.json');
  return typeof pkg?.version === 'string' ? pkg.version : '0.0.0';
}

export function buildInventory() {
  const agents = scanAgentCliDefs();
  const atoms = scanPluginAtoms();
  const skills = scanSkills();
  const designSystems = scanDesignSystems();
  const plugins = scanPlugins();
  const media = scanMediaProviders();
  const packs = scanDomainPacks();
  const mcp = scanMcpTools();
  const v06 = scanV06Features();
  const v07 = scanV07Features();
  const v08 = scanV08Features();
  const v09 = scanV09Features();
  const v10 = scanV10Features();
  const v11 = scanV11Features();
  const v12 = scanV12Features();
  const v13 = scanV13Features();
  const v14 = scanV14Features();
  const v15 = scanV15Features();
  const v16 = scanV16Features();
  const v17 = scanV17Features();
  const version = monorepoVersion();

  const inventory = {
    generatedAt: new Date().toISOString(),
    version,
    root: ROOT,
    catalogs: {
      agentCliDefs: agents,
      pluginAtoms: atoms,
      skills,
      designSystems,
      plugins,
      mediaProviders: media,
      domainPacks: packs,
      mcpTools: mcp,
      v06Features: v06,
      v07Features: v07,
      v08Features: v08,
      v09Features: v09,
      v10Features: v10,
      v11Features: v11,
      v12Features: v12,
      v13Features: v13,
      v14Features: v14,
      v15Features: v15,
      v16Features: v16,
      v17Features: v17,
    },
    gates: GATES,
    summary: {
      agentCliDefs: agents.count,
      pluginAtoms: atoms.count,
      skills: skills.count,
      designSystems: designSystems.count,
      plugins: plugins.count,
      mediaProviders: media.count,
      mediaSurfaces: media.surfaces.length,
      domainPacks: packs.count,
      mcpTools: mcp.count,
      v06Features: v06.count,
      v06FeaturesTotal: v06.total,
      v07Features: v07.count,
      v07FeaturesTotal: v07.total,
      v08Features: v08.count,
      v08FeaturesTotal: v08.total,
      v09Features: v09.count,
      v09FeaturesTotal: v09.total,
      v10Features: v10.count,
      v10FeaturesTotal: v10.total,
      v11Features: v11.count,
      v11FeaturesTotal: v11.total,
      v12Features: v12.count,
      v12FeaturesTotal: v12.total,
      v13Features: v13.count,
      v13FeaturesTotal: v13.total,
      v14Features: v14.count,
      v14FeaturesTotal: v14.total,
      v15Features: v15.count,
      v15FeaturesTotal: v15.total,
      v16Features: v16.count,
      v16FeaturesTotal: v16.total,
      v17Features: v17.count,
      v17FeaturesTotal: v17.total,
    },
  };

  inventory.checks = evaluateGates(inventory);
  return inventory;
}

export function evaluateGates(inventory) {
  const s = inventory.summary;
  const g = inventory.gates;
  const results = [
    { id: 'agentCliDefs', ok: s.agentCliDefs >= g.minAgentCliDefs, actual: s.agentCliDefs, min: g.minAgentCliDefs },
    { id: 'pluginAtoms', ok: s.pluginAtoms >= g.minPluginAtoms, actual: s.pluginAtoms, min: g.minPluginAtoms },
    { id: 'skills', ok: s.skills >= g.minSkills, actual: s.skills, min: g.minSkills },
    { id: 'designSystems', ok: s.designSystems >= g.minDesignSystems, actual: s.designSystems, min: g.minDesignSystems },
    { id: 'mediaProviders', ok: s.mediaProviders >= g.minMediaProviders, actual: s.mediaProviders, min: g.minMediaProviders },
    { id: 'mediaSurfaces', ok: s.mediaSurfaces >= g.minMediaSurfaces, actual: s.mediaSurfaces, min: g.minMediaSurfaces },
    { id: 'mcpTools', ok: s.mcpTools >= g.minMcpTools, actual: s.mcpTools, min: g.minMcpTools },
    { id: 'domainPacks', ok: s.domainPacks >= g.minDomainPacks, actual: s.domainPacks, min: g.minDomainPacks },
  ];
  if (g.requireV06Features) {
    const v06 = inventory.catalogs?.v06Features;
    const ok = Boolean(v06?.ok);
    results.push({
      id: 'v06Features',
      ok,
      actual: v06?.count ?? 0,
      min: v06?.total ?? 0,
      missing: v06?.missing ?? [],
    });
  }
  if (g.requireV07Features) {
    const v07 = inventory.catalogs?.v07Features;
    const ok = Boolean(v07?.ok);
    results.push({
      id: 'v07Features',
      ok,
      actual: v07?.count ?? 0,
      min: v07?.total ?? 0,
      missing: v07?.missing ?? [],
    });
  }
  if (g.requireV08Features) {
    const v08 = inventory.catalogs?.v08Features;
    const ok = Boolean(v08?.ok);
    results.push({
      id: 'v08Features',
      ok,
      actual: v08?.count ?? 0,
      min: v08?.total ?? 0,
      missing: v08?.missing ?? [],
    });
  }
  if (g.requireV09Features) {
    const v09 = inventory.catalogs?.v09Features;
    const ok = Boolean(v09?.ok);
    results.push({
      id: 'v09Features',
      ok,
      actual: v09?.count ?? 0,
      min: v09?.total ?? 0,
      missing: v09?.missing ?? [],
    });
  }
  if (g.requireV10Features) {
    const v10 = inventory.catalogs?.v10Features;
    const ok = Boolean(v10?.ok);
    results.push({
      id: 'v10Features',
      ok,
      actual: v10?.count ?? 0,
      min: v10?.total ?? 0,
      missing: v10?.missing ?? [],
    });
  }
  if (g.requireV11Features) {
    const v11 = inventory.catalogs?.v11Features;
    const ok = Boolean(v11?.ok);
    results.push({
      id: 'v11Features',
      ok,
      actual: v11?.count ?? 0,
      min: v11?.total ?? 0,
      missing: v11?.missing ?? [],
    });
  }
  if (g.requireV12Features) {
    const v12 = inventory.catalogs?.v12Features;
    const ok = Boolean(v12?.ok);
    results.push({
      id: 'v12Features',
      ok,
      actual: v12?.count ?? 0,
      min: v12?.total ?? 0,
      missing: v12?.missing ?? [],
    });
  }
  if (g.requireV13Features) {
    const v13 = inventory.catalogs?.v13Features;
    const ok = Boolean(v13?.ok);
    results.push({
      id: 'v13Features',
      ok,
      actual: v13?.count ?? 0,
      min: v13?.total ?? 0,
      missing: v13?.missing ?? [],
    });
  }
  if (g.requireV14Features) {
    const v14 = inventory.catalogs?.v14Features;
    const ok = Boolean(v14?.ok);
    results.push({
      id: 'v14Features',
      ok,
      actual: v14?.count ?? 0,
      min: v14?.total ?? 0,
      missing: v14?.missing ?? [],
    });
  }
  if (g.requireV15Features) {
    const v15 = inventory.catalogs?.v15Features;
    const ok = Boolean(v15?.ok);
    results.push({
      id: 'v15Features',
      ok,
      actual: v15?.count ?? 0,
      min: v15?.total ?? 0,
      missing: v15?.missing ?? [],
    });
  }
  if (g.requireV16Features) {
    const v16 = inventory.catalogs?.v16Features;
    const ok = Boolean(v16?.ok);
    results.push({
      id: 'v16Features',
      ok,
      actual: v16?.count ?? 0,
      min: v16?.total ?? 0,
      missing: v16?.missing ?? [],
    });
  }
  if (g.requireV17Features) {
    const v17 = inventory.catalogs?.v17Features;
    const ok = Boolean(v17?.ok);
    results.push({
      id: 'v17Features',
      ok,
      actual: v17?.count ?? 0,
      min: v17?.total ?? 0,
      missing: v17?.missing ?? [],
    });
  }
  return {
    ok: results.every((r) => r.ok),
    results,
  };
}

function main(argv = process.argv.slice(2)) {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const inv = buildInventory();
  const json = JSON.stringify(inv, null, 2);
  process.stdout.write(`${json}\n`);

  if (write) {
    const out =
      process.env.NEOS_INVENTORY_OUT?.trim()
      || path.join(ROOT, 'docs/generated/capability-inventory.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${json}\n`, 'utf8');
    process.stderr.write(`wrote ${path.relative(ROOT, out)}\n`);
  }

  if (check && !inv.checks.ok) {
    process.stderr.write('inventory gates failed:\n');
    for (const r of inv.checks.results.filter((x) => !x.ok)) {
      if (
        (
          r.id === 'v06Features'
          || r.id === 'v07Features'
          || r.id === 'v08Features'
          || r.id === 'v09Features'
          || r.id === 'v10Features'
          || r.id === 'v11Features'
          || r.id === 'v12Features'
          || r.id === 'v13Features'
          || r.id === 'v14Features'
          || r.id === 'v15Features'
          || r.id === 'v16Features'
          || r.id === 'v17Features'
        )
        && Array.isArray(r.missing)
        && r.missing.length
      ) {
        process.stderr.write(`  - ${r.id}: missing ${r.missing.join(', ')}\n`);
      } else {
        process.stderr.write(`  - ${r.id}: ${r.actual} < min ${r.min}\n`);
      }
    }
    process.exitCode = 1;
  }
}

const isMain =
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}
