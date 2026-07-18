import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { useEngine } from '../hooks/useEngine.js';
import type { DesignSystem } from '../lib/engine.js';
import { formatListCount } from '../lib/list-count.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

export function DesignSystems() {
  const { client } = useEngine();
  const navigate = useNavigate();
  const [systems, setSystems] = useState<DesignSystem[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const filteredSystems = useMemo(() => {
    const list = filterBySearchText(systems, search);
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [systems, search]);

  const load = useCallback(async () => {
    if (!client) return;
    setLoading(true);
    const res = await client.listDesignSystems();
    if (res.ok && res.data) setSystems(res.data);
    setLoading(false);
  }, [client]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!client || !newName.trim()) return;
    setCreateError(null);
    const res = await client.createDesignSystem(newName.trim(), newDescription.trim() || undefined);
    if (res.ok && res.data) {
      setSystems((prev) => [...prev, res.data!]);
      setNewName('');
      setNewDescription('');
      setIsCreating(false);
    } else {
      setCreateError(res.error ?? 'Failed to create design system');
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!client) return;
    if (!window.confirm(`Delete design system "${name}"? This cannot be undone.`)) return;
    const res = await client.deleteDesignSystem(id);
    if (res.ok) setSystems((prev) => prev.filter((s) => s.id !== id));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Design Systems</h1>
          <p className="text-sm text-white/50 mt-1">
            Manage design context files (DESIGN.md) injected into agent system prompts.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {systems.length > 0 && (
            <>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search design systems…"
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30"
              />
              <span className="text-xs text-white/40">
                {formatListCount(filteredSystems.length, systems.length)}
              </span>
            </>
          )}
          <button
            onClick={() => { setIsCreating(true); setCreateError(null); }}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
          >
            + New Design System
          </button>
        </div>
      </div>

      {/* Create form */}
      {isCreating && (
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-4">
          <h2 className="text-base font-semibold text-white">New Design System</h2>
          {createError && (
            <p className="text-sm text-red-400">{createError}</p>
          )}
          <div className="space-y-3">
            <div>
              <label className="text-xs text-white/50 block mb-1">Name (alphanumeric, - and _ only)</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="my-design-system"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
            </div>
            <div>
              <label className="text-xs text-white/50 block mb-1">Description (optional)</label>
              <input
                type="text"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Brand guidelines and component styles"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!newName.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm transition-colors"
            >
              Create
            </button>
            <button
              onClick={() => { setIsCreating(false); setCreateError(null); }}
              className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="text-white/40 text-sm">Loading...</p>
      ) : systems.length === 0 ? (
        <div className="text-center py-16 space-y-2">
          <p className="text-white/40 text-sm">No design systems found.</p>
          <p className="text-white/30 text-xs">
            Create one to inject brand guidelines and component styles into agent prompts.
          </p>
        </div>
      ) : filteredSystems.length === 0 ? (
        <p className="text-white/40 text-sm">No design systems match your search.</p>
      ) : (
        <div className="grid gap-3">
          {filteredSystems.map((ds) => (
            <div
              key={ds.id}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/[0.07] transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-white text-sm">{ds.name}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/50 font-mono">
                    {ds.id}
                  </span>
                  {ds.hasTokens && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      tokens
                    </span>
                  )}
                  {ds.hasComponents && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                      components
                    </span>
                  )}
                </div>
                {ds.description && (
                  <p className="text-xs text-white/40 mt-0.5 truncate">{ds.description}</p>
                )}
                <p className="text-xs text-white/30 mt-0.5">
                  Updated {new Date(ds.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 ml-4 shrink-0">
                <button
                  onClick={() => navigate(`/design-systems/${ds.id}`)}
                  className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-xs transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(ds.id, ds.name)}
                  className="px-3 py-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
