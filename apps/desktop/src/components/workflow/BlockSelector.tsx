import { useEffect, useMemo, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowBlock } from '../../lib/engine.js';
import { SelectField } from './fields.js';

export function defaultsForBlock(block: WorkflowBlock): Record<string, unknown> {
  return Object.fromEntries(
    block.paramDefs
      // Control-char / blank keys never become defaults (align with BlockNode params)
      .filter(
        (param) =>
          param.default !== undefined
          && typeof param.key === 'string'
          && !/[\0\r\n]/.test(param.key)
          && param.key.trim().length > 0,
      )
      .map((param) => [param.key.trim(), param.default]),
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
          ...blocks
            // Control-char block ids never selectable
            .filter((block) => typeof block.id === 'string' && !/[\0\r\n]/.test(block.id) && block.id.trim())
            .map((block) => ({
              value: block.id.trim(),
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
