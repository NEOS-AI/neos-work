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
});
