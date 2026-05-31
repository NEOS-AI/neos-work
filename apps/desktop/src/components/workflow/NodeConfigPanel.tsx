import { useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import type { WorkflowBlock } from '../../lib/engine.js';
import { ANTHROPIC_MODELS, GOOGLE_MODELS, OLLAMA_PRESET_MODELS, OPENAI_MODELS } from '@neos-work/shared';
import { BlockParamForm } from './BlockParamForm.js';
import { BlockSelector, defaultsForBlock } from './BlockSelector.js';
import { CheckboxField, NumberField, TextAreaField, TextField } from './fields.js';
import { HarnessSelector } from './HarnessSelector.js';
import type { WorkflowValidationIssue } from './WorkflowValidation.js';

interface NodeConfigPanelProps {
  selectedNode: Node | null;
  validationIssues: WorkflowValidationIssue[];
  onPatchNodeData: (nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => void;
  workflowDescription?: string;
  onUpdateDescription?: (desc: string) => void;
}

function getConfig(node: Node): Record<string, unknown> {
  return (node.data.config as Record<string, unknown> | undefined) ?? {};
}

function stringifyJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export function NodeConfigPanel({ selectedNode, validationIssues, onPatchNodeData, workflowDescription, onUpdateDescription }: NodeConfigPanelProps) {
  const [blocks, setBlocks] = useState<WorkflowBlock[]>([]);
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const { t } = useTranslation('common');

  const selectedIssues = useMemo(() => {
    if (!selectedNode) return validationIssues;
    return validationIssues.filter((issue) => issue.nodeId === selectedNode.id);
  }, [selectedNode, validationIssues]);

  if (!selectedNode) {
    return (
      <div className="space-y-3 p-3">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Select a node to edit its settings.
        </p>
        <ValidationList issues={selectedIssues} />
        {onUpdateDescription !== undefined && (
          <div className="mt-3 space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('workflow.description')}
            </p>
            <TextAreaField
              label=""
              value={workflowDescription ?? ''}
              rows={3}
              onChange={onUpdateDescription}
            />
          </div>
        )}
      </div>
    );
  }

  const nodeType = String(selectedNode.data.nodeType);
  const config = getConfig(selectedNode);
  const patchConfig = (patch: Record<string, unknown>) => {
    onPatchNodeData(selectedNode.id, { config: { ...config, ...patch } });
  };
  const selectedBlock = blocks.find((block) => block.id === config.blockId);
  const params = ((config.params ?? {}) as Record<string, unknown>) ?? {};
  const initialInputsText = jsonDrafts[selectedNode.id] ?? stringifyJson(config.initialInputs);

  return (
    <div className="space-y-4 p-3">
      <ValidationList issues={selectedIssues} />

      <TextField
        label="Label"
        value={String(selectedNode.data.label ?? '')}
        onChange={(label) => onPatchNodeData(selectedNode.id, { label })}
      />

      {(nodeType === 'agent_finance' || nodeType === 'agent_coding') && (
        <div className="space-y-3">
          {/* Provider selector */}
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              Provider
            </label>
            <select
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              value={typeof config.llmProvider === 'string' ? config.llmProvider : 'anthropic'}
              onChange={(e) => patchConfig({ llmProvider: e.target.value, llmModel: '' })}
            >
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
            </select>
          </div>
          {/* Model selector */}
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              Model
            </label>
            <select
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              value={typeof config.llmModel === 'string' ? config.llmModel : ''}
              onChange={(e) => patchConfig({ llmModel: e.target.value })}
            >
              {(() => {
                const provider = typeof config.llmProvider === 'string' ? config.llmProvider : 'anthropic';
                const modelsMap: Record<string, { id: string; name: string }[]> = {
                  anthropic: ANTHROPIC_MODELS,
                  google: GOOGLE_MODELS,
                  openai: OPENAI_MODELS,
                  ollama: OLLAMA_PRESET_MODELS,
                };
                return (modelsMap[provider] ?? ANTHROPIC_MODELS).map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ));
              })()}
            </select>
          </div>
          <HarnessSelector
            nodeType={nodeType}
            value={typeof config.harnessId === 'string' ? config.harnessId : ''}
            onChange={(harnessId) => patchConfig({ harnessId: harnessId || undefined })}
          />
          <TextAreaField
            label="Additional system prompt"
            value={typeof config.systemPrompt === 'string' ? config.systemPrompt : ''}
            rows={4}
            onChange={(systemPrompt) => patchConfig({ systemPrompt })}
          />
          <NumberField
            label="Max steps"
            value={typeof config.maxSteps === 'number' ? config.maxSteps : undefined}
            min={1}
            onChange={(maxSteps) => patchConfig({ maxSteps })}
          />
        </div>
      )}

      {nodeType === 'block' && (
        <div className="space-y-3">
          <BlockSelector
            value={typeof config.blockId === 'string' ? config.blockId : ''}
            onBlocksLoaded={setBlocks}
            onChange={(block) => {
              if (!block) {
                patchConfig({ blockId: undefined, params: {} });
                return;
              }
              patchConfig({ blockId: block.id, params: { ...defaultsForBlock(block), ...params } });
            }}
          />
          {selectedBlock && (
            <BlockParamForm
              block={selectedBlock}
              value={params}
              onChange={(nextParams) => patchConfig({ params: nextParams })}
            />
          )}
        </div>
      )}

      {nodeType === 'trigger' && (
        <TextAreaField
          label="Initial inputs"
          value={initialInputsText}
          rows={5}
          description="JSON object passed to the workflow start."
          onChange={(next) => {
            setJsonDrafts((current) => ({ ...current, [selectedNode.id]: next }));
            if (next.trim() === '') {
              patchConfig({ initialInputs: undefined });
              return;
            }
            try {
              const parsed = JSON.parse(next) as unknown;
              if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                patchConfig({ initialInputs: parsed });
              }
            } catch {
              // Keep the draft text until it becomes valid JSON.
            }
          }}
        />
      )}

      {nodeType === 'web_search' && (
        <div className="space-y-3">
          <TextField
            label="Query"
            value={typeof config.query === 'string' ? config.query : ''}
            onChange={(query) => patchConfig({ query })}
          />
          <NumberField
            label="Max results"
            value={typeof config.maxResults === 'number' ? config.maxResults : undefined}
            min={1}
            max={20}
            onChange={(maxResults) => patchConfig({ maxResults })}
          />
        </div>
      )}

      {nodeType === 'slack_message' && (
        <div className="space-y-3">
          <TextField
            label="Channel"
            value={typeof config.channel === 'string' ? config.channel : ''}
            placeholder="#alerts"
            onChange={(channel) => patchConfig({ channel })}
          />
          <TextAreaField
            label="Text template"
            value={typeof config.textTemplate === 'string' ? config.textTemplate : ''}
            rows={4}
            onChange={(textTemplate) => patchConfig({ textTemplate })}
          />
        </div>
      )}

      {nodeType === 'discord_message' && (
        <TextAreaField
          label="Text template"
          value={typeof config.textTemplate === 'string' ? config.textTemplate : ''}
          rows={4}
          onChange={(textTemplate) => patchConfig({ textTemplate })}
        />
      )}

      {(nodeType === 'gate_and' || nodeType === 'gate_or' || nodeType === 'output') && (
        <p className="rounded-md border p-2 text-xs" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          This node uses upstream inputs and has no required settings.
        </p>
      )}

      {nodeType === 'trigger' && (
        <CheckboxField
          label="Entry node"
          value
          disabled
          onChange={() => {}}
          description="Trigger nodes start workflow execution."
        />
      )}
    </div>
  );
}

function ValidationList({ issues }: { issues: WorkflowValidationIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="space-y-1">
      {issues.map((issue, index) => (
        <div
          key={`${issue.code}-${issue.nodeId ?? issue.edgeId ?? index}`}
          className="rounded-md border px-2 py-1.5 text-[11px]"
          style={{
            borderColor: issue.severity === 'error' ? '#ef4444' : '#f59e0b',
            color: issue.severity === 'error' ? '#fecaca' : '#fde68a',
            backgroundColor: issue.severity === 'error' ? '#450a0a33' : '#451a0333',
          }}
        >
          {issue.message}
        </div>
      ))}
    </div>
  );
}
