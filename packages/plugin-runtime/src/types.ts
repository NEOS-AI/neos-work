/**
 * Plugin runtime contracts (v0.5.11 / PLAN Task 6 foundation).
 */

export type AtomKind =
  | 'prompt'
  | 'tool'
  | 'transform'
  | 'gate'
  | 'genui'
  | 'media'
  | 'editor'
  | 'deploy';

export type AtomTrustLevel = 'builtin' | 'local' | 'untrusted';

export interface PluginAtom {
  /** Stable id, e.g. `editor.apply_patch` */
  id: string;
  name: string;
  kind: AtomKind;
  description: string;
  /** Capability tags for trust / deny lists */
  capabilities: string[];
  trust: AtomTrustLevel;
  /** Optional GenUI / input schema hint (JSON-schema-ish free form) */
  inputSchema?: Record<string, unknown>;
}

export interface PluginSnapshot {
  id: string;
  pluginId: string;
  name: string;
  /** Frozen fragments / tool gates at pin time */
  fragments: Record<string, unknown>;
  atomIds: string[];
  createdAt: string;
}

export interface AtomRegistryOptions {
  /** Extra atoms (local/community) merged after builtins */
  extra?: PluginAtom[];
}
