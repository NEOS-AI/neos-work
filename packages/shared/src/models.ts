/**
 * Canonical model definitions — single source of truth.
 * Used by core adapters, server, and desktop UI.
 */

import type { Model, ThinkingMode } from './types/llm.js';

// --- Anthropic Models ---

export const ANTHROPIC_MODELS: Model[] = [
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    providerId: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    providerId: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'claude-haiku-4-5-20251001',
    name: 'Claude Haiku 4.5',
    providerId: 'anthropic',
    contextWindow: 200_000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
];

// --- Google Models ---

export const GOOGLE_MODELS: Model[] = [
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    providerId: 'google',
    contextWindow: 1_000_000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'gemini-2.0-pro',
    name: 'Gemini 2.0 Pro',
    providerId: 'google',
    contextWindow: 1_000_000,
    supportsThinking: true,
    supportsTools: true,
    supportsVision: true,
  },
];

// --- OpenAI Models ---

export const OPENAI_MODELS: Model[] = [
  { id: 'gpt-4o',      name: 'GPT-4o',      providerId: 'openai', contextWindow: 128_000, supportsThinking: false, supportsTools: true,  supportsVision: true },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', contextWindow: 128_000, supportsThinking: false, supportsTools: true,  supportsVision: true },
  { id: 'o3-mini',     name: 'o3-mini',     providerId: 'openai', contextWindow: 200_000, supportsThinking: true,  supportsTools: true,  supportsVision: false },
];

// --- Ollama Models ---

export const OLLAMA_PRESET_MODELS: Model[] = [
  { id: 'llama3.3',      name: 'Llama 3.3',      providerId: 'ollama', contextWindow: 128_000, supportsThinking: false, supportsTools: true,  supportsVision: false },
  { id: 'qwen2.5-coder', name: 'Qwen 2.5 Coder', providerId: 'ollama', contextWindow: 128_000, supportsThinking: false, supportsTools: true,  supportsVision: false },
  { id: 'deepseek-r1',   name: 'DeepSeek R1',    providerId: 'ollama', contextWindow: 128_000, supportsThinking: true,  supportsTools: true,  supportsVision: false },
];

// --- All Models ---

export const ALL_MODELS: Model[] = [...ANTHROPIC_MODELS, ...GOOGLE_MODELS, ...OPENAI_MODELS, ...OLLAMA_PRESET_MODELS];

// --- Thinking Budget ---

export const THINKING_BUDGET: Record<ThinkingMode, number> = {
  none: 0,
  low: 1024,
  medium: 4096,
  high: 16384,
};

export const THINKING_MODES: ThinkingMode[] = ['none', 'low', 'medium', 'high'];
