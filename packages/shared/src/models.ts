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

// --- All Models ---

export const ALL_MODELS: Model[] = [...ANTHROPIC_MODELS, ...GOOGLE_MODELS];

// --- Thinking Budget ---

export const THINKING_BUDGET: Record<ThinkingMode, number> = {
  none: 0,
  low: 1024,
  medium: 4096,
  high: 16384,
};

export const THINKING_MODES: ThinkingMode[] = ['none', 'low', 'medium', 'high'];
