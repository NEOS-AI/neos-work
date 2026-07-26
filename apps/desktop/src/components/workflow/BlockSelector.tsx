import { useEffect, useMemo, useState } from 'react';

import { useEngine } from '../../hooks/useEngine.js';
import type { WorkflowBlock } from '../../lib/engine.js';
import { scrubDisplayText } from '../../lib/format-duration.js';
import { SelectField } from './fields.js';

/** Safe block id for select value / config: control-char rejected, trimmed. */
export function safeBlockId(raw: unknown): string {
  if (typeof raw !== 'string' || /[\0\r\n]/.test(raw)) return '';
  return raw.trim();
}

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const { onBlocksLoaded } = props;

  useEffect(() => {
    let cancelled = false;
    if (!client) return;
    setLoadError(null);

    client
      .listBlocks()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data) {
          const sorted = [...res.data].sort((a, b) =>
            `${a.domain}:${a.category}:${a.name}`.localeCompare(
              `${b.domain}:${b.category}:${b.name}`,
            ),
          );
          setBlocks(sorted);
          onBlocksLoaded?.(sorted);
        } else {
          setBlocks([]);
          setLoadError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load blocks',
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setBlocks([]);
        const msg = err instanceof Error ? err.message : 'Failed to load blocks';
        setLoadError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Failed to load blocks',
        );
      });

    return () => {
      cancelled = true;
    };
  }, [client, onBlocksLoaded]);

  // Match by safe (trimmed) id so option values and padded server ids align
  const valueId = safeBlockId(props.value);
  const selected = useMemo(
    () => blocks.find((block) => safeBlockId(block.id) === valueId && valueId.length > 0),
    [blocks, valueId],
  );

  return (
    <div className="space-y-2">
      {loadError && (
        <p className="text-[10px] text-red-400">
          {scrubDisplayText(loadError, { collapseLines: true, maxChars: 300 }) || loadError}
        </p>
      )}
      <SelectField
        label="Block"
        value={valueId}
        onChange={(next) => {
          if (!next) {
            props.onChange(null);
            return;
          }
          const match = blocks.find((block) => safeBlockId(block.id) === next);
          if (!match) {
            props.onChange(null);
            return;
          }
          // Emit normalized id so config never stores padded / control-adjacent values
          const id = safeBlockId(match.id);
          props.onChange(id ? { ...match, id } : null);
        }}
        options={[
          { value: '', label: 'No block selected' },
          ...blocks
            // Control-char / blank block ids never selectable
            .map((block) => {
              const id = safeBlockId(block.id);
              if (!id) return null;
              const domain = scrubDisplayText(block.domain, { collapseLines: true, maxChars: 40 }) || 'general';
              const category = scrubDisplayText(block.category, { collapseLines: true, maxChars: 40 }) || 'custom';
              const name = scrubDisplayText(block.name, { collapseLines: true, maxChars: 80 }) || id;
              return {
                value: id,
                label: `${domain} / ${category} / ${name}`,
              };
            })
            .filter((opt): opt is { value: string; label: string } => opt !== null),
        ]}
      />
      {selected && (
        <div className="space-y-1 rounded-md border p-2 text-[11px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          <p>{scrubDisplayText(selected.description, { maxChars: 500 })}</p>
          <p>
            Input:{' '}
            {scrubDisplayText(selected.inputDescription, { collapseLines: true, maxChars: 200 }) || '—'}
          </p>
          <p>
            Output:{' '}
            {scrubDisplayText(selected.outputDescription, { collapseLines: true, maxChars: 200 }) || '—'}
          </p>
          {selected.requiredSettings && selected.requiredSettings.length > 0 && (
            <p>
              Settings:{' '}
              {selected.requiredSettings
                .filter((s) => typeof s === 'string' && !/[\0\r\n]/.test(s) && s.trim())
                .map((s) => s.trim())
                .join(', ') || '—'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
