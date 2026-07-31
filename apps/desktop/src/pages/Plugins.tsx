import { useState, useEffect, useMemo } from 'react';
import { useEngine } from '../hooks/useEngine.js';
import type { Plugin, PluginChannel, PluginListMeta } from '../lib/engine.js';
import { PipelineRunner } from '../components/workflow/PipelineRunner.js';
import { formatListCount } from '../lib/list-count.js';
import { sortByName } from '../lib/list-sort.js';
import { scrubDisplayText } from '../lib/format-duration.js';
import { filterBySearchText } from '../lib/workflow-list-filter.js';

type ChannelFilter = 'all' | PluginChannel;

const CHANNEL_ORDER: ChannelFilter[] = ['all', 'official', 'community', 'user', 'bundled'];

function channelLabel(ch: ChannelFilter): string {
  switch (ch) {
    case 'all':
      return 'All';
    case 'official':
      return 'Official';
    case 'community':
      return 'Community';
    case 'user':
      return 'User';
    case 'bundled':
      return 'Bundled';
    default:
      return ch;
  }
}

function channelBadgeStyle(ch: string | undefined): { bg: string; fg: string } {
  switch (ch) {
    case 'official':
      return { bg: '#1e3a8a40', fg: '#60a5fa' };
    case 'community':
      return { bg: '#14532d40', fg: '#4ade80' };
    case 'user':
      return { bg: '#4c1d9540', fg: '#c4b5fd' };
    case 'bundled':
      return { bg: '#713f1240', fg: '#fbbf24' };
    default:
      return { bg: '#1e3a8a40', fg: '#60a5fa' };
  }
}

export function Plugins() {
  const { client } = useEngine();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [channelMeta, setChannelMeta] = useState<PluginListMeta['channels']>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Plugin | null>(null);
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState<ChannelFilter>('all');

  useEffect(() => {
    if (!client) return;
    setLoadError(null);
    client
      .listPlugins()
      .then((res) => {
        if (res.ok && res.data) {
          setPlugins(res.data as Plugin[]);
          const meta = (res as { meta?: PluginListMeta }).meta;
          setChannelMeta(meta?.channels ?? {});
        } else {
          setPlugins([]);
          setChannelMeta({});
          setLoadError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load plugins',
          );
        }
      })
      .catch((err) => {
        setPlugins([]);
        setChannelMeta({});
        const msg = err instanceof Error ? err.message : 'Failed to load plugins';
        setLoadError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || 'Failed to load plugins',
        );
      })
      .finally(() => setLoading(false));
  }, [client]);

  // Escape clears search / channel filter when the pipeline runner is not open.
  useEffect(() => {
    if (selected) return;
    if (!search && channelFilter === 'all') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      if (search) {
        setSearch('');
        return;
      }
      if (channelFilter !== 'all') setChannelFilter('all');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, search, channelFilter]);

  const filtered = useMemo(() => {
    let list = plugins;
    if (channelFilter !== 'all') {
      list = list.filter((p) => (p.channel ?? 'user') === channelFilter);
    }
    return sortByName(filterBySearchText(list, search));
  }, [plugins, search, channelFilter]);

  const availableChannels = useMemo(() => {
    return CHANNEL_ORDER.filter((ch) => {
      if (ch === 'all') return true;
      const fromMeta = channelMeta?.[ch] ?? 0;
      if (fromMeta > 0) return true;
      return plugins.some((p) => (p.channel ?? 'user') === ch);
    });
  }, [plugins, channelMeta]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Plugins</h1>
        {plugins.length > 0 && (
          <div className="flex items-center gap-2">
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search plugins…"
              className="rounded-lg border px-3 py-1.5 text-sm"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                borderColor: 'var(--border-primary)',
                color: 'var(--text-primary)',
                minWidth: 200,
              }}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {formatListCount(filtered.length, plugins.length)}
            </span>
          </div>
        )}
      </div>

      {plugins.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2"
          role="tablist"
          aria-label="Marketplace channel"
          data-testid="plugin-channel-filters"
        >
          {availableChannels.map((ch) => {
            const active = channelFilter === ch;
            const count =
              ch === 'all'
                ? plugins.length
                : (channelMeta?.[ch]
                  ?? plugins.filter((p) => (p.channel ?? 'user') === ch).length);
            return (
              <button
                key={ch}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`plugin-channel-${ch}`}
                onClick={() => setChannelFilter(ch)}
                className="rounded-full border px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  borderColor: active ? 'var(--accent, #6366f1)' : 'var(--border-primary)',
                  backgroundColor: active
                    ? 'color-mix(in srgb, var(--accent, #6366f1) 18%, transparent)'
                    : 'var(--bg-secondary)',
                  color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
              >
                {channelLabel(ch)}
                <span className="ml-1 opacity-70">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {loading ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      ) : loadError ? (
        <p className="text-sm text-red-400">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
        </p>
      ) : plugins.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No plugins found. Add <code>open-design.json</code> to a skill directory.
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            ~/.config/neos-work/skills/&lt;plugin-name&gt;/open-design.json
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Or install bundled marketplace stubs under repo plugins/_official and plugins/community.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {channelFilter !== 'all' && !search
            ? 'No plugins in this channel.'
            : 'No plugins match your search.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => {
            const ch = p.channel ?? 'user';
            const badge = channelBadgeStyle(ch);
            return (
              <div
                key={p.id}
                className="rounded-xl border p-4 flex flex-col gap-2"
                style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-secondary)' }}
                data-channel={ch}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {scrubDisplayText(p.name, { collapseLines: true, maxChars: 200 }) || 'Plugin'}
                  </h2>
                  <span
                    className="text-[10px] rounded px-1.5 py-0.5 font-medium capitalize"
                    style={{ backgroundColor: badge.bg, color: badge.fg }}
                    data-testid={`plugin-badge-${p.id}`}
                  >
                    {channelLabel(ch as ChannelFilter)}
                  </span>
                </div>
                {p.description ? (
                  <p className="text-xs line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                    {scrubDisplayText(p.description, { collapseLines: true, maxChars: 500 })}
                  </p>
                ) : null}
                <div className="flex items-center justify-between mt-auto pt-2">
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    v{scrubDisplayText(p.version, { collapseLines: true, maxChars: 40 }) || '—'}
                    {' · '}
                    {(p.pipeline ?? []).length} stages
                  </span>
                  <button
                    type="button"
                    className="rounded px-3 py-1 text-xs text-white"
                    style={{ backgroundColor: '#10b981' }}
                    onClick={() => {
                      // Control-char / blank plugin id → fail closed before opening runner
                      if (typeof p.id !== 'string' || /[\0\r\n]/.test(p.id)) {
                        window.alert('Plugin id contains invalid control characters');
                        return;
                      }
                      const id = p.id.trim();
                      if (!id || id.length > 100) {
                        window.alert('Plugin id is missing or too long');
                        return;
                      }
                      setSelected(p);
                    }}
                  >
                    Run
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <PipelineRunner plugin={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
