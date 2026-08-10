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

  it('includes v0.17 feature gates (EngineMediaClient skills/media extract)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v17Features);
    assert.equal(
      inv.catalogs.v17Features.ok,
      true,
      `v17 missing: ${(inv.catalogs.v17Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v17Features.features.planV17);
    assert.ok(inv.catalogs.v17Features.features.migrationV17);
    assert.ok(inv.catalogs.v17Features.features.releaseV17);
    assert.ok(inv.catalogs.v17Features.features.engineMedia);
    assert.ok(inv.catalogs.v17Features.features.implM0);
    assert.ok(inv.checks.results.some((r) => r.id === 'v17Features' && r.ok));
  });

  it('includes v0.18 feature gates (EngineSessions + EnginePlugins extracts)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v18Features);
    assert.equal(
      inv.catalogs.v18Features.ok,
      true,
      `v18 missing: ${(inv.catalogs.v18Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v18Features.features.planV18);
    assert.ok(inv.catalogs.v18Features.features.migrationV18);
    assert.ok(inv.catalogs.v18Features.features.releaseV18);
    assert.ok(inv.catalogs.v18Features.features.engineSessions);
    assert.ok(inv.catalogs.v18Features.features.enginePlugins);
    assert.ok(inv.catalogs.v18Features.features.implM0);
    assert.ok(inv.catalogs.v18Features.features.implM1);
    assert.ok(inv.checks.results.some((r) => r.id === 'v18Features' && r.ok));
  });

  it('includes v0.19 feature gates (EngineOps + run event fan-out)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v19Features);
    assert.equal(
      inv.catalogs.v19Features.ok,
      true,
      `v19 missing: ${(inv.catalogs.v19Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v19Features.features.planV19);
    assert.ok(inv.catalogs.v19Features.features.migrationV19);
    assert.ok(inv.catalogs.v19Features.features.releaseV19);
    assert.ok(inv.catalogs.v19Features.features.engineOps);
    assert.ok(inv.catalogs.v19Features.features.runEventFanout);
    assert.ok(inv.catalogs.v19Features.features.stickyDocUpdated);
    assert.ok(inv.catalogs.v19Features.features.implA);
    assert.ok(inv.catalogs.v19Features.features.implB);
    assert.ok(inv.checks.results.some((r) => r.id === 'v19Features' && r.ok));
  });

  it('includes v0.20 feature gates (EngineCatalog + project split)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v20Features);
    assert.equal(
      inv.catalogs.v20Features.ok,
      true,
      `v20 missing: ${(inv.catalogs.v20Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v20Features.features.planV20);
    assert.ok(inv.catalogs.v20Features.features.migrationV20);
    assert.ok(inv.catalogs.v20Features.features.releaseV20);
    assert.ok(inv.catalogs.v20Features.features.engineCatalog);
    assert.ok(inv.catalogs.v20Features.features.projectSplit);
    assert.ok(inv.catalogs.v20Features.features.implC);
    assert.ok(inv.catalogs.v20Features.features.implD);
    assert.ok(inv.checks.results.some((r) => r.id === 'v20Features' && r.ok));
  });

  it('includes v0.21 feature gates (durable run log + multi-replica e2e)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v21Features);
    assert.equal(
      inv.catalogs.v21Features.ok,
      true,
      `v21 missing: ${(inv.catalogs.v21Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v21Features.features.planV21);
    assert.ok(inv.catalogs.v21Features.features.migrationV21);
    assert.ok(inv.catalogs.v21Features.features.releaseV21);
    assert.ok(inv.catalogs.v21Features.features.runEventLog);
    assert.ok(inv.catalogs.v21Features.features.multiReplicaE2eL9L10);
    assert.ok(inv.catalogs.v21Features.features.opsDurableDoc);
    assert.ok(inv.catalogs.v21Features.features.impl1);
    assert.ok(inv.catalogs.v21Features.features.impl2);
    assert.ok(inv.checks.results.some((r) => r.id === 'v21Features' && r.ok));
  });

  it('includes v0.22 feature gates (retention + summary + nightly live)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v22Features);
    assert.equal(
      inv.catalogs.v22Features.ok,
      true,
      `v22 missing: ${(inv.catalogs.v22Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v22Features.features.planV22);
    assert.ok(inv.catalogs.v22Features.features.migrationV22);
    assert.ok(inv.catalogs.v22Features.features.releaseV22);
    assert.ok(inv.catalogs.v22Features.features.retentionM0);
    assert.ok(inv.catalogs.v22Features.features.durableSummaryM1);
    assert.ok(inv.catalogs.v22Features.features.multiReplicaE2eL11);
    assert.ok(inv.catalogs.v22Features.features.nightlyLiveM2);
    assert.ok(inv.catalogs.v22Features.features.opsRetentionDoc);
    assert.ok(inv.catalogs.v22Features.features.implM0);
    assert.ok(inv.catalogs.v22Features.features.implM1);
    assert.ok(inv.catalogs.v22Features.features.implM2);
    assert.ok(inv.checks.results.some((r) => r.id === 'v22Features' && r.ok));
  });

  it('includes v0.23 feature gates (keychain + web media + warehouse)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v23Features);
    assert.equal(
      inv.catalogs.v23Features.ok,
      true,
      `v23 missing: ${(inv.catalogs.v23Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v23Features.features.planV23);
    assert.ok(inv.catalogs.v23Features.features.migrationV23);
    assert.ok(inv.catalogs.v23Features.features.releaseV23);
    assert.ok(inv.catalogs.v23Features.features.keychainK);
    assert.ok(inv.catalogs.v23Features.features.webMediaW);
    assert.ok(inv.catalogs.v23Features.features.warehouseP);
    assert.ok(inv.catalogs.v23Features.features.implK);
    assert.ok(inv.catalogs.v23Features.features.implW);
    assert.ok(inv.catalogs.v23Features.features.implP);
    assert.ok(inv.checks.results.some((r) => r.id === 'v23Features' && r.ok));
  });

  it('includes v0.24 feature gates (OS keyring + web workflow editor)', () => {
    const inv = buildInventory();
    assert.ok(inv.catalogs.v24Features);
    assert.equal(
      inv.catalogs.v24Features.ok,
      true,
      `v24 missing: ${(inv.catalogs.v24Features.missing || []).join(', ')}`,
    );
    assert.ok(inv.catalogs.v24Features.features.planV24);
    assert.ok(inv.catalogs.v24Features.features.migrationV24);
    assert.ok(inv.catalogs.v24Features.features.releaseV24);
    assert.ok(inv.catalogs.v24Features.features.osKeyring);
    assert.ok(inv.catalogs.v24Features.features.webWorkflow);
    assert.ok(inv.catalogs.v24Features.features.implOs);
    assert.ok(inv.catalogs.v24Features.features.implWf);
    assert.ok(inv.checks.results.some((r) => r.id === 'v24Features' && r.ok));
  });
});
