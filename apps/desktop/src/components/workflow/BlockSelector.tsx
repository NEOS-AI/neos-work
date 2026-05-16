import { useEffect, useMemo, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowBlock } from '../../lib/engine.js';
import { SelectField } from './fields.js';

export function defaultsForBlock(block: WorkflowBlock): Record<string, unknown> {
  return Object.fromEntries(
    block.paramDefs
      .filter((param) => param.default !== undefined)
      .map((param) => [param.key, param.default]),
  );
}

export function BlockSelector(props: {
  value: string;
  onChange: (block: WorkflowBlock | null) => void;
  onBlocksLoaded?: (blocks: WorkflowBlock[]) => void;
}) {
  const { client } = useEngine();
  const [blocks, setBlocks] = useState<WorkflowBlock[]>([]);
  const { onBlocksLoaded } = props;

  useEffect(() => {
    let cancelled = false;
    if (!client) return;

    client.listBlocks().then((res) => {
      if (!cancelled && res.ok && res.data) {
        const sorted = [...res.data].sort((a, b) =>
          `${a.domain}:${a.category}:${a.name}`.localeCompare(`${b.domain}:${b.category}:${b.name}`),
        );
        setBlocks(sorted);
        onBlocksLoaded?.(sorted);
      }
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [client, onBlocksLoaded]);

  const selected = useMemo(() => blocks.find((block) => block.id === props.value), [blocks, props.value]);

  return (
    <div className="space-y-2">
      <SelectField
        label="Block"
        value={props.value}
        onChange={(next) => props.onChange(blocks.find((block) => block.id === next) ?? null)}
        options={[
          { value: '', label: 'No block selected' },
          ...blocks.map((block) => ({
            value: block.id,
            label: `${block.domain} / ${block.category} / ${block.name}`,
          })),
        ]}
      />
      {selected && (
        <div className="space-y-1 rounded-md border p-2 text-[11px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          <p>{selected.description}</p>
          <p>Input: {selected.inputDescription}</p>
          <p>Output: {selected.outputDescription}</p>
          {selected.requiredSettings && selected.requiredSettings.length > 0 && (
            <p>Settings: {selected.requiredSettings.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
