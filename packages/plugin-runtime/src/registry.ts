/**
 * Atom registry — lookup, list, capability deny, snapshot pin (in-memory).
 */

import { randomUUID } from 'node:crypto';
import { BUILTIN_ATOMS } from './atoms.js';
import type {
  AtomRegistryOptions,
  PluginAtom,
  PluginSnapshot,
} from './types.js';

function isSafeAtomId(id: string): boolean {
  return (
    typeof id === 'string'
    && id.length > 0
    && id.length <= 120
    && !/[\0\r\n]/.test(id)
    && /^[a-z][a-z0-9_.-]*$/i.test(id)
  );
}

export class AtomRegistry {
  private atoms = new Map<string, PluginAtom>();
  private snapshots = new Map<string, PluginSnapshot>();

  constructor(opts?: AtomRegistryOptions) {
    for (const a of BUILTIN_ATOMS) {
      this.atoms.set(a.id, { ...a });
    }
    if (opts?.extra) {
      for (const a of opts.extra) {
        if (!isSafeAtomId(a.id)) continue;
        this.atoms.set(a.id, { ...a, trust: a.trust ?? 'local' });
      }
    }
  }

  list(): PluginAtom[] {
    return [...this.atoms.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  get(id: string): PluginAtom | undefined {
    if (!isSafeAtomId(id)) return undefined;
    return this.atoms.get(id);
  }

  has(id: string): boolean {
    return this.get(id) != null;
  }

  /** Return atoms that require any of the given capabilities. */
  byCapability(cap: string): PluginAtom[] {
    if (typeof cap !== 'string' || /[\0\r\n]/.test(cap) || !cap.trim()) return [];
    const c = cap.trim();
    return this.list().filter((a) => a.capabilities.includes(c));
  }

  /**
   * Check whether all atomIds are allowed given a deny list of capabilities.
   * Returns denied atom ids.
   */
  deniedByCapabilities(atomIds: string[], deniedCaps: string[]): string[] {
    const deny = new Set(
      deniedCaps
        .filter((c) => typeof c === 'string' && !/[\0\r\n]/.test(c))
        .map((c) => c.trim())
        .filter(Boolean),
    );
    const out: string[] = [];
    for (const id of atomIds) {
      const atom = this.get(id);
      if (!atom) {
        out.push(id);
        continue;
      }
      if (atom.capabilities.some((c) => deny.has(c))) out.push(id);
    }
    return out;
  }

  pinSnapshot(input: {
    pluginId: string;
    name: string;
    atomIds: string[];
    fragments?: Record<string, unknown>;
  }): PluginSnapshot | null {
    if (typeof input.pluginId !== 'string' || /[\0\r\n]/.test(input.pluginId)) return null;
    if (typeof input.name !== 'string' || /[\0\r\n]/.test(input.name)) return null;
    const pluginId = input.pluginId.trim().slice(0, 200);
    const name = input.name.trim().slice(0, 200);
    if (!pluginId || !name) return null;
    const atomIds = (input.atomIds ?? [])
      .filter((id) => this.has(id))
      .slice(0, 50);
    const snap: PluginSnapshot = {
      id: randomUUID(),
      pluginId,
      name,
      atomIds,
      fragments: input.fragments && typeof input.fragments === 'object' ? { ...input.fragments } : {},
      createdAt: new Date().toISOString(),
    };
    this.snapshots.set(snap.id, snap);
    return snap;
  }

  getSnapshot(id: string): PluginSnapshot | undefined {
    if (typeof id !== 'string' || /[\0\r\n]/.test(id)) return undefined;
    return this.snapshots.get(id.trim());
  }

  listSnapshots(pluginId?: string): PluginSnapshot[] {
    let list = [...this.snapshots.values()];
    if (typeof pluginId === 'string' && !/[\0\r\n]/.test(pluginId) && pluginId.trim()) {
      const p = pluginId.trim();
      list = list.filter((s) => s.pluginId === p);
    }
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}

let globalRegistry: AtomRegistry | null = null;

export function getGlobalAtomRegistry(): AtomRegistry {
  if (!globalRegistry) globalRegistry = new AtomRegistry();
  return globalRegistry;
}

export function resetGlobalAtomRegistry(): void {
  globalRegistry = null;
}
