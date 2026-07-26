import { useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import { useTranslation } from 'react-i18next';

import type { WorkflowBlock } from '../../lib/engine.js';
import { useEngine } from '../../hooks/useEngine.js';
import type { DesignSystem } from '../../lib/engine.js';
import { ANTHROPIC_MODELS, GOOGLE_MODELS, OLLAMA_PRESET_MODELS, OPENAI_MODELS } from '@neos-work/shared';
import {
  MEDIA_IMAGE_QUALITIES,
  MEDIA_IMAGE_SIZES,
  MEDIA_TTS_MODELS,
  MEDIA_VOICES,
} from '../../lib/media-node-options.js';
import { safeEntityId, scrubDisplayText } from '../../lib/format-duration.js';
import { BlockParamForm } from './BlockParamForm.js';
import { BlockSelector, defaultsForBlock, safeBlockId } from './BlockSelector.js';
import { CheckboxField, NumberField, TextAreaField, TextField } from './fields.js';
import { HarnessSelector } from './HarnessSelector.js';
import type { WorkflowValidationIssue } from './WorkflowValidation.js';

interface NodeConfigPanelProps {
  selectedNode: Node | null;
  validationIssues: WorkflowValidationIssue[];
  onPatchNodeData: (nodeId: string, patch: { label?: string; config?: Record<string, unknown> }) => void;
  workflowDescription?: string;
  onUpdateDescription?: (desc: string) => void;
  designSystemId?: string;
  onUpdateDesignSystemId?: (id: string) => void;
}

function getConfig(node: Node): Record<string, unknown> {
  return (node.data.config as Record<string, unknown> | undefined) ?? {};
}

/** Multi-line config field display: strip null bytes only (keep newlines). */
function displayMultiline(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return /\0/.test(raw) ? raw.replace(/\0/g, '') : raw;
}

/** Single-line config field display: collapse control chars. */
function displayLine(raw: unknown, max = 500): string {
  return scrubDisplayText(raw, { collapseLines: true, maxChars: max });
}

function stringifyJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return '';
  }
}

export function NodeConfigPanel({ selectedNode, validationIssues, onPatchNodeData, workflowDescription, onUpdateDescription, designSystemId, onUpdateDesignSystemId }: NodeConfigPanelProps) {
  const [blocks, setBlocks] = useState<WorkflowBlock[]>([]);
  const [jsonDrafts, setJsonDrafts] = useState<Record<string, string>>({});
  const [designSystems, setDesignSystems] = useState<DesignSystem[]>([]);
  const [designSystemsError, setDesignSystemsError] = useState<string | null>(null);
  const { client } = useEngine();
  const { t } = useTranslation('common');

  useEffect(() => {
    if (!client) return;
    setDesignSystemsError(null);
    client
      .listDesignSystems()
      .then((res) => {
        if (res.ok && res.data) {
          setDesignSystems(res.data);
        } else {
          setDesignSystems([]);
          setDesignSystemsError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load design systems',
          );
        }
      })
      .catch((err) => {
        setDesignSystems([]);
        const msg = err instanceof Error ? err.message : 'Failed to load design systems';
        setDesignSystemsError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || 'Failed to load design systems',
        );
      });
  }, [client]);

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
              onChange={(desc) => {
                // Null-byte description rejected (multi-line OK)
                if (/\0/.test(desc)) return;
                onUpdateDescription(desc);
              }}
            />
          </div>
        )}
        {onUpdateDesignSystemId !== undefined && (
          <div className="mt-3 space-y-1">
            <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Design System</p>
            <select
              value={
                typeof designSystemId === 'string' && !/[\0\r\n]/.test(designSystemId)
                  ? designSystemId.trim()
                  : ''
              }
              onChange={(e) => {
                const id = e.target.value;
                // Control-char design system id never applied; trim valid ids
                if (id && /[\0\r\n]/.test(id)) return;
                onUpdateDesignSystemId(id ? id.trim() : '');
              }}
              className="w-full rounded bg-black/20 border border-white/10 px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">None</option>
              {designSystems
                .filter((ds) => typeof ds.id === 'string' && !/[\0\r\n]/.test(ds.id) && ds.id.trim())
                .map((ds) => {
                  const id = ds.id.trim();
                  const name =
                    scrubDisplayText(ds.name, { collapseLines: true, maxChars: 200 }) || id;
                  return (
                    <option key={id} value={id}>{name}</option>
                  );
                })}
            </select>
            {designSystemsError && (
              <p className="text-[10px] text-red-400">
                {scrubDisplayText(designSystemsError, { collapseLines: true, maxChars: 300 })
                  || designSystemsError}
              </p>
            )}
            {designSystemId && !designSystemsError && (
              <p className="text-[10px] text-white/30">
                Selected DESIGN.md will be prepended to agent system prompts.
              </p>
            )}
          </div>
        )}
        <WorkflowWebhookSection />
      </div>
    );
  }

  const nodeType = String(selectedNode.data.nodeType);
  const config = getConfig(selectedNode);
  const patchConfig = (patch: Record<string, unknown>) => {
    onPatchNodeData(selectedNode.id, { config: { ...config, ...patch } });
  };
  const blockId = safeBlockId(config.blockId);
  const selectedBlock = blocks.find((block) => safeBlockId(block.id) === blockId && blockId.length > 0);
  const params = ((config.params ?? {}) as Record<string, unknown>) ?? {};
  const initialInputsText = jsonDrafts[selectedNode.id] ?? stringifyJson(config.initialInputs);

  return (
    <div className="space-y-4 p-3">
      <ValidationList issues={selectedIssues} />

      <TextField
        label="Label"
        value={
          scrubDisplayText(selectedNode.data.label, { collapseLines: true, maxChars: 200 })
        }
        onChange={(label) => {
          // Control-char labels rejected (align with WorkflowValidation safeLabel)
          if (/[\0\r\n]/.test(label)) return;
          onPatchNodeData(selectedNode.id, { label });
        }}
      />

      {(nodeType === 'agent' || nodeType === 'agent_finance' || nodeType === 'agent_coding') && (
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
              onChange={(e) => {
                const llmProvider = e.target.value;
                // Keep `provider` in sync for CLI spawn path in AgentNode
                patchConfig({ llmProvider, provider: llmProvider, llmModel: '' });
              }}
            >
              <option value="anthropic">Anthropic</option>
              <option value="google">Google</option>
              <option value="openai">OpenAI</option>
              <option value="ollama">Ollama</option>
              <option value="cli-claude">CLI · Claude Code</option>
              <option value="cli-gemini">CLI · Gemini</option>
              <option value="cli-codex">CLI · Codex</option>
            </select>
          </div>
          {/* Model selector (hidden for external CLI providers) */}
          {!(typeof config.llmProvider === 'string' && config.llmProvider.startsWith('cli-')) && (
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
              Model
            </label>
            <select
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              value={typeof config.llmModel === 'string' ? config.llmModel : ''}
              onChange={(e) => patchConfig({ llmModel: e.target.value || undefined })}
            >
              <option value="">Select model…</option>
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
          )}
          {typeof config.llmProvider === 'string' && config.llmProvider.startsWith('cli-') && (
            <p className="rounded-md border p-2 text-[11px]" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
              External CLI agent will be spawned on the server (PATH detection in Settings → CLI Agents).
            </p>
          )}
          <HarnessSelector
            nodeType={nodeType}
            value={
              // v2 workerId preferred; harnessId accepted until graph re-save (BC-4)
              typeof config.workerId === 'string' && !/[\0\r\n]/.test(config.workerId)
                ? config.workerId
                : typeof config.harnessId === 'string' && !/[\0\r\n]/.test(config.harnessId)
                  ? config.harnessId
                  : ''
            }
            onChange={(workerId) => {
              // Control-char worker/harness id never applied (align with AgentNode / validation)
              if (workerId && /[\0\r\n]/.test(workerId)) return;
              // Write workerId; drop legacy harnessId so migrate/save stay clean
              patchConfig({
                workerId: workerId || undefined,
                harnessId: undefined,
              });
            }}
          />
          <TextAreaField
            label="Additional system prompt"
            value={displayMultiline(config.systemPrompt)}
            rows={4}
            onChange={(systemPrompt) => {
              // Null-byte system prompts rejected (multi-line OK; align with harness)
              if (/\0/.test(systemPrompt)) return;
              patchConfig({ systemPrompt });
            }}
          />
          <NumberField
            label="Max steps"
            value={typeof config.maxSteps === 'number' ? config.maxSteps : undefined}
            min={1}
            max={200}
            onChange={(maxSteps) => patchConfig({ maxSteps })}
          />
        </div>
      )}

      {nodeType === 'block' && (
        <div className="space-y-3">
          <BlockSelector
            value={blockId}
            onBlocksLoaded={setBlocks}
            onChange={(block) => {
              if (!block) {
                patchConfig({ blockId: undefined, params: {} });
                return;
              }
              // block.id already normalized by BlockSelector (safe/trimmed)
              const nextId = safeBlockId(block.id);
              patchConfig({
                blockId: nextId || undefined,
                params: { ...defaultsForBlock(block), ...params },
              });
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
            // Null-byte JSON drafts never applied (parse/config injection defense)
            if (/\0/.test(next)) return;
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
            value={displayLine(config.query)}
            onChange={(query) => {
              // Control-char queries never applied (align with WorkflowValidation / resolveSearchQuery)
              if (/[\0\r\n]/.test(query)) return;
              patchConfig({ query });
            }}
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
            value={displayLine(config.channel)}
            placeholder="#alerts"
            onChange={(channel) => {
              // Control-char channel never applied (align with SlackMessageNode)
              if (/[\0\r\n]/.test(channel)) return;
              patchConfig({ channel });
            }}
          />
          <TextAreaField
            label="Text template"
            value={displayMultiline(config.textTemplate)}
            rows={4}
            onChange={(textTemplate) => {
              // Null-byte templates rejected (multi-line OK)
              if (/\0/.test(textTemplate)) return;
              patchConfig({ textTemplate });
            }}
          />
        </div>
      )}

      {nodeType === 'discord_message' && (
        <TextAreaField
          label="Text template"
          value={displayMultiline(config.textTemplate)}
          rows={4}
          onChange={(textTemplate) => {
            // Null-byte templates rejected (multi-line OK)
            if (/\0/.test(textTemplate)) return;
            patchConfig({ textTemplate });
          }}
        />
      )}

      {(nodeType === 'gate_and' || nodeType === 'gate_or' || nodeType === 'output'
        || nodeType === 'parallel_start' || nodeType === 'parallel_end' || nodeType === 'or_gate') && (
        <p className="rounded-md border p-2 text-xs" style={{ borderColor: 'var(--border-primary)', color: 'var(--text-muted)' }}>
          {nodeType === 'parallel_start' && 'Fan-out: successors run as parallel branches.'}
          {nodeType === 'parallel_end' && 'Fan-in: waits for all upstream branches (AND join).'}
          {nodeType === 'or_gate' && 'Takes the first completed upstream branch result.'}
          {(nodeType === 'gate_and' || nodeType === 'gate_or' || nodeType === 'output')
            && 'This node uses upstream inputs and has no required settings.'}
        </p>
      )}

      {nodeType === 'media' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Media type</label>
            <select
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              value={typeof config.mediaType === 'string' ? config.mediaType : 'image'}
              onChange={(e) => patchConfig({ mediaType: e.target.value })}
            >
              <option value="image">Image (DALL·E 3)</option>
              <option value="audio">Audio (TTS)</option>
            </select>
          </div>
          {(config.mediaType !== 'audio') && (
            <>
              <TextAreaField
                label="Prompt"
                value={displayLine(config.prompt, 10_000)}
                rows={3}
                onChange={(prompt) => {
                  // Image prompts reject null-byte / CR / LF (align with MediaNode + validation)
                  if (/[\0\r\n]/.test(prompt)) return;
                  patchConfig({ prompt });
                }}
              />
              <div className="space-y-1">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Size</label>
                <select
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  value={typeof config.size === 'string' ? config.size : '1024x1024'}
                  onChange={(e) => patchConfig({ size: e.target.value })}
                >
                  {MEDIA_IMAGE_SIZES.map((s) => (
                    <option key={s} value={s}>{s.replace('x', '×')}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Quality</label>
                <select
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  value={typeof config.quality === 'string' ? config.quality : 'standard'}
                  onChange={(e) => patchConfig({ quality: e.target.value })}
                >
                  {MEDIA_IMAGE_QUALITIES.map((q) => (
                    <option key={q} value={q}>{q}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          {config.mediaType === 'audio' && (
            <>
              <TextAreaField
                label="Text"
                value={displayMultiline(config.text)}
                rows={3}
                onChange={(text) => {
                  // TTS: null-byte only (multi-line OK; align with MediaNode)
                  if (/\0/.test(text)) return;
                  patchConfig({ text });
                }}
              />
              <div className="space-y-1">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Voice</label>
                <select
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  value={typeof config.voice === 'string' ? config.voice : 'alloy'}
                  onChange={(e) => patchConfig({ voice: e.target.value })}
                >
                  {MEDIA_VOICES.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>TTS model</label>
                <select
                  className="w-full rounded border px-2 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
                  value={typeof config.model === 'string' ? config.model : 'tts-1'}
                  onChange={(e) => patchConfig({ model: e.target.value })}
                >
                  {MEDIA_TTS_MODELS.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            Requires OPENAI_API_KEY in Settings.
          </p>
        </div>
      )}

      {nodeType === 'deploy' && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Provider</label>
            <select
              className="w-full rounded border px-2 py-1.5 text-xs"
              style={{ borderColor: 'var(--border-primary)', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
              value={typeof config.provider === 'string' ? config.provider : 'vercel'}
              onChange={(e) => patchConfig({ provider: e.target.value })}
            >
              <option value="vercel">Vercel</option>
              <option value="cloudflare">Cloudflare Pages</option>
            </select>
          </div>
          <TextField
            label="Project name"
            value={displayLine(config.projectName)}
            placeholder="neos-deploy"
            onChange={(projectName) => {
              // Control-char projectName never applied (align with DeployNode)
              if (/[\0\r\n]/.test(projectName)) return;
              patchConfig({ projectName });
            }}
          />
          <TextAreaField
            label="Content (HTML)"
            value={displayMultiline(config.content)}
            rows={4}
            description="Optional static content; otherwise uses upstream `content` input."
            onChange={(content) => {
              // Null-byte deploy content rejected (align with DeployNode)
              if (/\0/.test(content)) return;
              patchConfig({ content });
            }}
          />
          <button
            type="button"
            className="w-full rounded border px-2 py-1.5 text-xs"
            style={{ borderColor: 'var(--border-primary)', color: 'var(--text-secondary)' }}
            onClick={async () => {
              if (!client) return;
              const provider = (typeof config.provider === 'string' ? config.provider : 'vercel') as 'vercel' | 'cloudflare';
              try {
                const res = await client.deployPreflight(
                  provider,
                  typeof config.projectName === 'string' ? config.projectName : undefined,
                );
                if (res.ok && res.data) {
                  const providerSafe =
                    scrubDisplayText(res.data.provider, { collapseLines: true, maxChars: 40 })
                    || provider;
                  const lines = (res.data.checks ?? [])
                    .slice(0, 40)
                    .map((ch) => {
                      const msg =
                        scrubDisplayText(ch.message, { collapseLines: true, maxChars: 200 })
                        || 'check';
                      return `${ch.ok ? '✓' : '✗'} ${msg}`;
                    })
                    .join('\n');
                  window.alert(
                    `${res.data.ready ? 'Ready' : 'Not ready'} for ${providerSafe}\n\n${lines}`,
                  );
                } else {
                  const err =
                    scrubDisplayText((res as { error?: string }).error, {
                      collapseLines: true,
                      maxChars: 300,
                    }) || 'Preflight failed';
                  window.alert(err);
                }
              } catch (err) {
                const msg = err instanceof Error ? err.message : 'Preflight failed';
                window.alert(
                  scrubDisplayText(msg, { collapseLines: true, maxChars: 300 }) || 'Preflight failed',
                );
              }
            }}
          >
            Run deploy preflight
          </button>
        </div>
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
  if (issues.length === 0) {
    return (
      <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        No validation issues.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {issues.slice(0, 50).map((issue, index) => {
        const codeSafe =
          scrubDisplayText(issue.code, { collapseLines: true, maxChars: 80 }) || 'issue';
        const msgSafe =
          scrubDisplayText(issue.message, { collapseLines: true, maxChars: 500 }) || codeSafe;
        const keyId = scrubDisplayText(issue.nodeId ?? issue.edgeId ?? '', {
          collapseLines: true,
          maxChars: 80,
        });
        return (
        <div
          key={`${codeSafe}-${keyId || index}`}
          className="rounded-md border px-2 py-1.5 text-[11px]"
          style={{
            borderColor: issue.severity === 'error' ? '#ef4444' : '#f59e0b',
            color: issue.severity === 'error' ? '#fecaca' : '#fde68a',
            backgroundColor: issue.severity === 'error' ? '#450a0a33' : '#451a0333',
          }}
        >
          {msgSafe}
        </div>
        );
      })}
    </div>
  );
}

/** Sanitize webhook secret for store/display/curl (strip control chars; cap length). */
function sanitizeWebhookSecret(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw;
  if (/\0/.test(s)) s = s.replace(/\0/g, '');
  // CR/LF never belong in HMAC secrets (header/curl injection)
  if (/[\r\n]/.test(s)) s = s.replace(/[\r\n]+/g, '');
  s = s.trim().slice(0, 512);
  return s || null;
}

/** Webhook URL + secret for the open workflow (shown when no node is selected). */
function WorkflowWebhookSection() {
  const { client, serverUrl } = useEngine();
  const { id: workflowId } = useParamsSafe();
  const [secret, setSecret] = useState<string | null>(null);
  const [rateLimit, setRateLimit] = useState<{ limit: number; remaining: number; resetAt: number } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [secretError, setSecretError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !workflowId) return;
    setSecretError(null);
    // Control-char / blank / overlong ids never sent to webhook secret API
    const wfId = safeEntityId(workflowId);
    if (!wfId) {
      setSecret(null);
      setSecretError('Workflow id contains invalid control characters');
      return;
    }
    client
      .getWebhookSecret(wfId)
      .then((res) => {
        if (res.ok && res.data) {
          setSecret(sanitizeWebhookSecret(res.data.secret));
          if (res.data.rateLimit) {
            setRateLimit({
              limit: res.data.rateLimit.limit,
              remaining: res.data.rateLimit.remaining,
              resetAt: res.data.rateLimit.resetAt,
            });
          }
        } else {
          setSecret(null);
          setSecretError(
            scrubDisplayText((res as { error?: string }).error, {
              collapseLines: true,
              maxChars: 300,
            }) || 'Failed to load webhook secret',
          );
        }
      })
      .catch((err) => {
        setSecret(null);
        const msg = err instanceof Error ? err.message : 'Failed to load webhook secret';
        setSecretError(
          scrubDisplayText(msg, { collapseLines: true, maxChars: 300 })
          || 'Failed to load webhook secret',
        );
      });
  }, [client, workflowId]);

  const safeWorkflowId = safeEntityId(workflowId);
  if (!workflowId || !safeWorkflowId) {
    if (!workflowId) return null;
    return (
      <div className="mt-4 space-y-2 rounded-md border p-2" style={{ borderColor: 'var(--border-primary)' }}>
        <p className="text-xs text-red-400">Workflow id contains invalid control characters</p>
      </div>
    );
  }

  const base = serverUrl?.replace(/\/$/, '') || 'http://localhost:3000';
  const webhookUrl = `${base}/api/webhook/${safeWorkflowId}`;

  const flashCopy = (label: string) => {
    setCopyMsg(
      scrubDisplayText(label, { collapseLines: true, maxChars: 200 }) || 'Done',
    );
    setTimeout(() => setCopyMsg(null), 1500);
  };

  const copyText = async (text: string, label: string) => {
    try {
      // Scrub secret/URL before clipboard (null-byte defense)
      const safe = scrubDisplayText(text, { maxChars: 10_000 });
      const write = navigator.clipboard?.writeText;
      if (typeof write !== 'function') throw new Error('Clipboard unavailable');
      await write.call(navigator.clipboard, safe);
      flashCopy(label);
    } catch {
      flashCopy('Copy failed');
    }
  };

  const curlExample = secret
    ? `BODY='{}'\nSIG=$(printf %s "$BODY" | openssl dgst -sha256 -hmac '${secret}' | awk '{print $2}')\ncurl -sS -X POST '${webhookUrl}' \\\n  -H 'Content-Type: application/json' \\\n  -H "X-Neos-Signature: sha256=$SIG" \\\n  -d "$BODY"`
    : `curl -sS -X POST '${webhookUrl}' -H 'Content-Type: application/json' -H 'X-Neos-Signature: sha256=<hmac>' -d '{}'`;

  return (
    <div className="mt-4 space-y-2 rounded-md border p-2" style={{ borderColor: 'var(--border-primary)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>Webhook</p>
      <p className="text-[10px] break-all font-mono" style={{ color: 'var(--text-secondary)' }}>
        POST {webhookUrl}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="text-[10px] underline"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => void copyText(webhookUrl, 'URL copied')}
        >
          Copy URL
        </button>
        <button
          type="button"
          className="text-[10px] underline"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => void copyText(curlExample, 'curl copied')}
        >
          Copy curl
        </button>
        <button
          type="button"
          disabled={busy || !client || !secret}
          className="text-[10px] underline disabled:opacity-40"
          style={{ color: 'var(--text-muted)' }}
          onClick={async () => {
            if (!client) return;
            const wfId = safeEntityId(workflowId);
            if (!wfId) {
              flashCopy('Workflow id contains invalid control characters');
              return;
            }
            setBusy(true);
            try {
              const res = await client.testWebhookFire(wfId, { source: 'config-test-fire' });
              if (res.ok) {
                flashCopy(`Webhook fired (${res.status})`);
              } else {
                const err =
                  scrubDisplayText((res as { error?: string }).error, {
                    collapseLines: true,
                    maxChars: 200,
                  }) || 'Fire failed';
                flashCopy(err);
              }
              // refresh rate limit remaining
              const again = await client.getWebhookSecret(wfId);
              if (again.ok && again.data?.rateLimit) {
                setRateLimit({
                  limit: again.data.rateLimit.limit,
                  remaining: again.data.rateLimit.remaining,
                  resetAt: again.data.rateLimit.resetAt,
                });
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Fire failed';
              flashCopy(
                scrubDisplayText(msg, { collapseLines: true, maxChars: 200 }) || 'Fire failed',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Test fire
        </button>
      </div>
      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
        Header: <code>X-Neos-Signature: sha256=&lt;hmac&gt;</code>
      </p>
      {rateLimit && (
        <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          Rate limit: {rateLimit.remaining}/{rateLimit.limit} remaining
          {' · '}
          resets {new Date(rateLimit.resetAt).toLocaleTimeString()}
        </p>
      )}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-mono truncate flex-1" style={{ color: secretError ? '#f87171' : 'var(--text-secondary)' }}>
          {secretError
            ? scrubDisplayText(secretError, { collapseLines: true, maxChars: 200 }) || secretError
            : secret
              ? (() => {
                  const s = scrubDisplayText(secret, { collapseLines: true, maxChars: 200 }) || '••••';
                  return showSecret ? s : `${s.slice(0, 8)}…${s.slice(-4)}`;
                })()
              : 'Loading secret…'}
        </span>
        <button
          type="button"
          className="text-[10px] underline"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => setShowSecret((v) => !v)}
        >
          {showSecret ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          disabled={!secret}
          className="text-[10px] underline disabled:opacity-40"
          style={{ color: 'var(--text-muted)' }}
          onClick={() => secret && void copyText(secret, 'Secret copied')}
        >
          Copy
        </button>
        <button
          type="button"
          disabled={busy || !client}
          className="text-[10px] underline disabled:opacity-40"
          style={{ color: 'var(--text-muted)' }}
          onClick={async () => {
            if (!client) return;
            const wfId = safeEntityId(workflowId);
            if (!wfId) {
              flashCopy('Workflow id contains invalid control characters');
              return;
            }
            setBusy(true);
            try {
              const res = await client.regenerateWebhookSecret(wfId);
              if (res.ok && res.data) {
                setSecret(sanitizeWebhookSecret(res.data.secret));
                setSecretError(null);
                flashCopy('Secret regenerated');
              } else {
                const err =
                  scrubDisplayText((res as { error?: string }).error, {
                    collapseLines: true,
                    maxChars: 200,
                  }) || 'Regenerate failed';
                flashCopy(err);
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : 'Regenerate failed';
              flashCopy(
                scrubDisplayText(msg, { collapseLines: true, maxChars: 200 })
                  || 'Regenerate failed',
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Regenerate
        </button>
      </div>
      {copyMsg && (
        <p className="text-[10px]" style={{ color: '#10b981' }}>
          {scrubDisplayText(copyMsg, { collapseLines: true, maxChars: 200 }) || copyMsg}
        </p>
      )}
    </div>
  );
}

function useParamsSafe(): { id?: string } {
  // Local import-free helper using window location (NodeConfigPanel is under /workflows/:id)
  try {
    const m = window.location.pathname.match(/\/workflows\/([^/]+)/);
    return { id: m?.[1] };
  } catch {
    return {};
  }
}
