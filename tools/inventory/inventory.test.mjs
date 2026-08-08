/**
 * Inventory unit tests (node:test).
 * Run: node --test tools/inventory/inventory.test.mjs
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildInventory, evaluateGates } from './inventory.mjs';

describe('buildInventory', () => {
  it('collects catalogs with version and gates', () => {
    const inv = buildInventory();
    assert.equal(typeof inv.version, 'string');
    assert.ok(inv.version.match(/^\d+\.\d+\.\d+/));
    assert.ok(inv.catalogs.agentCliDefs.count >= 12);
    assert.ok(inv.catalogs.pluginAtoms.count >= 12);
    assert.ok(inv.catalogs.skills.count >= 5);
    assert.ok(inv.catalogs.designSystems.count >= 2);
    assert.ok(inv.catalogs.mediaProviders.count >= 4);
    assert.ok(inv.catalogs.mcpTools.count >= 6);
    assert.ok(inv.catalogs.domainPacks.count >= 4);
    assert.ok(inv.checks.ok, JSON.stringify(inv.checks.results, null, 2));
  });

  it('agent ids are stable cli-*', () => {
    const inv = buildInventory();
    for (const id of inv.catalogs.agentCliDefs.ids) {
      assert.match(id, /^cli-/);
    }
  });

  it('evaluateGates fails when counts low', () => {
    const inv = buildInventory();
    inv.summary.agentCliDefs = 1;
    const checks = evaluateGates(inv);
    assert.equal(checks.ok, false);
    assert.ok(checks.results.some((r) => r.id === 'agentCliDefs' && !r.ok));
  });

  it('includes v0.6 feature gates', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v06Features);
    assert.equal(inv.catalogs.v06Features.ok, true);
    assert.ok(inv.catalogs.v06Features.features.collabPresence);
    assert.ok(inv.catalogs.v06Features.features.marketplace);
    assert.ok(inv.catalogs.v06Features.features.helmSnippet);
    assert.ok(inv.catalogs.v06Features.features.migrationV06);
    assert.ok(inv.checks.results.some((r) => r.id === 'v06Features' && r.ok));
  });

  it('includes v0.7 feature gates (M0–M4 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v07Features);
    assert.equal(inv.catalogs.v07Features.ok, true);
    assert.ok(inv.catalogs.v07Features.features.planV07);
    assert.ok(inv.catalogs.v07Features.features.migrationV07);
    assert.ok(inv.catalogs.v07Features.features.canvasResize);
    assert.ok(inv.catalogs.v07Features.features.collabBus);
    assert.ok(inv.catalogs.v07Features.features.selectionAwareness);
    assert.ok(inv.catalogs.v07Features.features.canvasMultiSelect);
    assert.ok(inv.catalogs.v07Features.features.implM0);
    assert.ok(inv.catalogs.v07Features.features.implM4);
    assert.ok(inv.checks.results.some((r) => r.id === 'v07Features' && r.ok));
  });

  it('includes v0.8 feature gates (M0–M4 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v08Features);
    assert.equal(inv.catalogs.v08Features.ok, true);
    assert.ok(inv.catalogs.v08Features.features.planV08);
    assert.ok(inv.catalogs.v08Features.features.migrationV08);
    assert.ok(inv.catalogs.v08Features.features.sharedPresence);
    assert.ok(inv.catalogs.v08Features.features.redisPresence);
    assert.ok(inv.catalogs.v08Features.features.groupResize);
    assert.ok(inv.catalogs.v08Features.features.multiSelectCollab);
    assert.ok(inv.catalogs.v08Features.features.implM0);
    assert.ok(inv.catalogs.v08Features.features.implM4);
    assert.ok(inv.checks.results.some((r) => r.id === 'v08Features' && r.ok));
  });

  it('includes v0.9 feature gates (M0–M4 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v09Features);
    assert.equal(
      inv.catalogs.v09Features.ok,
      true,
      `v09 missing: ${(inv.catalogs.v09Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v09Features.features.planV09);
    assert.ok(inv.catalogs.v09Features.features.migrationV09);
    assert.ok(inv.catalogs.v09Features.features.layersReorder);
    assert.ok(inv.catalogs.v09Features.features.canvasDefault);
    assert.ok(inv.catalogs.v09Features.features.webPreviewComments);
    assert.ok(inv.catalogs.v09Features.features.webProjectZip);
    assert.ok(inv.catalogs.v09Features.features.dualSurfaceDoc);
    assert.ok(inv.catalogs.v09Features.features.sharedPreviewCommentParse);
    assert.ok(inv.catalogs.v09Features.features.implM0);
    assert.ok(inv.catalogs.v09Features.features.implM4);
    assert.ok(inv.checks.results.some((r) => r.id === 'v09Features' && r.ok));
  });

  it('includes v0.10 feature gates (M0–M3 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v10Features);
    assert.equal(
      inv.catalogs.v10Features.ok,
      true,
      `v10 missing: ${(inv.catalogs.v10Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v10Features.features.planV10);
    assert.ok(inv.catalogs.v10Features.features.migrationV10);
    assert.ok(inv.catalogs.v10Features.features.releaseV10);
    assert.ok(inv.catalogs.v10Features.features.agentLockEnforce);
    assert.ok(inv.catalogs.v10Features.features.sharedLockRegistry);
    assert.ok(inv.catalogs.v10Features.features.lockSafeHydrate);
    assert.ok(inv.catalogs.v10Features.features.harnessHttpGone);
    assert.ok(inv.catalogs.v10Features.features.collabStatusLocks);
    assert.ok(inv.catalogs.v10Features.features.opsCollabLocks);
    assert.ok(inv.catalogs.v10Features.features.implM0);
    assert.ok(inv.catalogs.v10Features.features.implM3);
    assert.ok(inv.checks.results.some((r) => r.id === 'v10Features' && r.ok));
  });

  it('includes v0.11 feature gates (M0–M3 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v11Features);
    assert.equal(
      inv.catalogs.v11Features.ok,
      true,
      `v11 missing: ${(inv.catalogs.v11Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v11Features.features.planV11);
    assert.ok(inv.catalogs.v11Features.features.migrationV11);
    assert.ok(inv.catalogs.v11Features.features.releaseV11);
    assert.ok(inv.catalogs.v11Features.features.runSessionBind);
    assert.ok(inv.catalogs.v11Features.features.lockEnforceUx);
    assert.ok(inv.catalogs.v11Features.features.toolPathLockParity);
    assert.ok(inv.catalogs.v11Features.features.workersUiRename);
    assert.ok(inv.catalogs.v11Features.features.implM0);
    assert.ok(inv.catalogs.v11Features.features.implM3);
    assert.ok(inv.checks.results.some((r) => r.id === 'v11Features' && r.ok));
  });

  it('includes v0.12 feature gates (M0–M3 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v12Features);
    assert.equal(
      inv.catalogs.v12Features.ok,
      true,
      `v12 missing: ${(inv.catalogs.v12Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v12Features.features.planV12);
    assert.ok(inv.catalogs.v12Features.features.migrationV12);
    assert.ok(inv.catalogs.v12Features.features.releaseV12);
    assert.ok(inv.catalogs.v12Features.features.engineTransport);
    assert.ok(inv.catalogs.v12Features.features.engineProject);
    assert.ok(inv.catalogs.v12Features.features.engineWorkflow);
    assert.ok(inv.catalogs.v12Features.features.engineClientExtends);
    assert.ok(inv.catalogs.v12Features.features.stickySseDoc);
    assert.ok(inv.catalogs.v12Features.features.fileSsotOps);
    assert.ok(inv.catalogs.v12Features.features.implM0);
    assert.ok(inv.catalogs.v12Features.features.implM3);
    assert.ok(inv.checks.results.some((r) => r.id === 'v12Features' && r.ok));
  });

  it('includes v0.13 feature gates (M0–M3 closeout)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v13Features);
    assert.equal(
      inv.catalogs.v13Features.ok,
      true,
      `v13 missing: ${(inv.catalogs.v13Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v13Features.features.planV13);
    assert.ok(inv.catalogs.v13Features.features.migrationV13);
    assert.ok(inv.catalogs.v13Features.features.releaseV13);
    assert.ok(inv.catalogs.v13Features.features.contractAgent423);
    assert.ok(inv.catalogs.v13Features.features.contractRunBind);
    assert.ok(inv.catalogs.v13Features.features.contractToolsFiles);
    assert.ok(inv.catalogs.v13Features.features.contractLocksFlags);
    assert.ok(inv.catalogs.v13Features.features.contractCollabSessionId);
    assert.ok(inv.catalogs.v13Features.features.sharedParseLocksFlags);
    assert.ok(inv.catalogs.v13Features.features.implM0);
    assert.ok(inv.catalogs.v13Features.features.implM3);
    assert.ok(inv.checks.results.some((r) => r.id === 'v13Features' && r.ok));
  });

  it('includes v0.14 feature gates (M1 process e2e + M3 multi-replica)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v14Features);
    assert.equal(
      inv.catalogs.v14Features.ok,
      true,
      `v14 missing: ${(inv.catalogs.v14Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v14Features.features.planV14);
    assert.ok(inv.catalogs.v14Features.features.migrationV14);
    assert.ok(inv.catalogs.v14Features.features.releaseV14);
    assert.ok(inv.catalogs.v14Features.features.journeyScript);
    assert.ok(inv.catalogs.v14Features.features.journeyPackageScript);
    assert.ok(inv.catalogs.v14Features.features.journeyCi);
    assert.ok(inv.catalogs.v14Features.features.multiReplicaAgent423);
    assert.ok(inv.catalogs.v14Features.features.implM1);
    assert.ok(inv.catalogs.v14Features.features.implM3);
    assert.ok(inv.checks.results.some((r) => r.id === 'v14Features' && r.ok));
  });

  it('includes v0.15 feature gates (M2 Playwright browser e2e)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v15Features);
    assert.equal(
      inv.catalogs.v15Features.ok,
      true,
      `v15 missing: ${(inv.catalogs.v15Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v15Features.features.planV15);
    assert.ok(inv.catalogs.v15Features.features.migrationV15);
    assert.ok(inv.catalogs.v15Features.features.releaseV15);
    assert.ok(inv.catalogs.v15Features.features.browserScript);
    assert.ok(inv.catalogs.v15Features.features.browserSpec);
    assert.ok(inv.catalogs.v15Features.features.browserPackageScript);
    assert.ok(inv.catalogs.v15Features.features.browserCi);
    assert.ok(inv.catalogs.v15Features.features.playwrightConfig);
    assert.ok(inv.catalogs.v15Features.features.implM2);
    assert.ok(inv.checks.results.some((r) => r.id === 'v15Features' && r.ok));
  });

  it('includes v0.16 feature gates (EngineSettings + shared run registry)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v16Features);
    assert.equal(
      inv.catalogs.v16Features.ok,
      true,
      `v16 missing: ${(inv.catalogs.v16Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v16Features.features.planV16);
    assert.ok(inv.catalogs.v16Features.features.migrationV16);
    assert.ok(inv.catalogs.v16Features.features.releaseV16);
    assert.ok(inv.catalogs.v16Features.features.engineSettings);
    assert.ok(inv.catalogs.v16Features.features.runRegistryShared);
    assert.ok(inv.catalogs.v16Features.features.implA);
    assert.ok(inv.catalogs.v16Features.features.implB);
    assert.ok(inv.catalogs.v16Features.features.multiReplicaRunsDoc);
    assert.ok(inv.checks.results.some((r) => r.id === 'v16Features' && r.ok));
  });
});
