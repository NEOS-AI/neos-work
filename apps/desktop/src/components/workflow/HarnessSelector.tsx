import { useEffect, useMemo, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { AgentHarness } from '../../lib/engine.js';
import { SelectField } from './fields.js';

export function HarnessSelector(props: {
  nodeType: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { client } = useEngine();
  const [harnesses, setHarnesses] = useState<AgentHarness[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!client) return;

    client.listHarnesses().then((res) => {
      if (!cancelled && res.ok && res.data) setHarnesses(res.data);
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [client]);

  const allowedDomains = useMemo(() => {
    if (props.nodeType === 'agent_finance') return new Set(['finance', 'general']);
    return new Set(['coding', 'general']);
  }, [props.nodeType]);

  const filtered = harnesses
    .filter((harness) => allowedDomains.has(harness.domain))
    .sort((a, b) => `${a.domain}:${a.name}`.localeCompare(`${b.domain}:${b.name}`));
  const selected = filtered.find((harness) => harness.id === props.value);

  return (
    <div className="space-y-2">
      <SelectField
        label="Harness"
        value={props.value}
        onChange={props.onChange}
        options={[
          { value: '', label: 'No harness selected' },
          ...filtered.map((harness) => ({
            value: harness.id,
            label: `${harness.name} (${harness.domain})`,
          })),
        ]}
      />
      {selected && (
        <div className="space-y-1 rounded-md border p-2 text-[11px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>
            {selected.description}
          </p>
          <p>Tools: {selected.allowedTools.length > 0 ? selected.allowedTools.join(', ') : 'None'}</p>
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
