import { useEffect, useMemo, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { AgentHarness } from '../../lib/engine.js';
import { scrubDisplayText } from '../../lib/format-duration.js';
import { filterAndSortHarnesses } from '../../lib/harness-filter.js';
import { SelectField } from './fields.js';

export function HarnessSelector(props: {
  nodeType: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { client } = useEngine();
  const [harnesses, setHarnesses] = useState<AgentHarness[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    setLoadError(null);

    // Domain Workers only — /api/harness HTTP aliases removed in 0.10.2
    const load = client.listWorkers
      ? client.listWorkers()
      : client.listHarnesses();
    load
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          setHarnesses(res.data);
        } else {
          setHarnesses([]);
          setLoadError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load workers',
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setHarnesses([]);
        const msg = err instanceof Error ? err.message : 'Failed to load workers';
        setLoadError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
            || 'Failed to load workers',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  const filtered = useMemo(
    () => filterAndSortHarnesses(harnesses, props.nodeType),
    [harnesses, props.nodeType],
  );
  // Control-char harness ids never selectable / matchable (check before trim)
  const valueId =
    typeof props.value === 'string' && !/[\0\r\n]/.test(props.value) ? props.value.trim() : '';
  const selected = filtered.find(
    (harness) =>
      typeof harness.id === 'string'
      && !/[\0\r\n]/.test(harness.id)
      && harness.id.trim() === valueId
      && valueId.length > 0,
  );

  return (
    <div className="space-y-2">
      {loadError && (
        <p className="text-[10px] text-red-400">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
        </p>
      )}
      <SelectField
        label="Worker"
        value={valueId}
        onChange={(next) => {
          if (!next) {
            props.onChange('');
            return;
          }
          // Control-char selection never applied
          if (/[\0\r\n]/.test(next)) return;
          const id = next.trim();
          props.onChange(id);
        }}
        options={[
          { value: '', label: 'No worker selected' },
          ...filtered
            .map((harness) => {
              if (typeof harness.id !== 'string' || /[\0\r\n]/.test(harness.id)) return null;
              const id = harness.id.trim();
              if (!id) return null;
              const name = scrubDisplayText(harness.name, { collapseLines: true, maxChars: 80 }) || id;
              const domain = scrubDisplayText(harness.domain, { collapseLines: true, maxChars: 40 }) || 'general';
              return {
                value: id,
                label: `${name} (${domain})`,
              };
            })
            .filter((opt): opt is { value: string; label: string } => opt !== null),
        ]}
      />
      {selected && (
        <div className="space-y-1 rounded-md border p-2 text-[11px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>
            {scrubDisplayText(selected.description, { maxChars: 500 })}
          </p>
          <p>
            Tools:{' '}
            {(selected.allowedTools?.length ?? 0) > 0
              ? (selected.allowedTools ?? [])
                  .filter((t) => typeof t === 'string' && !/[\0\r\n]/.test(t) && t.trim())
                  .map((t) => t.trim())
                  .join(', ') || 'None'
              : 'None'}
          </p>
          {selected.constraints && (
            <p>
              Limits: max steps {selected.constraints.maxSteps ?? '-'}, timeout {selected.constraints.timeoutMs ?? '-'}ms
            </p>
          )}
        </div>
      )}
    </div>
  );
}
