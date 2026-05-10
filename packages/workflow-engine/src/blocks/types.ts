/**
 * Block execution interfaces for domain blocks.
 */

export interface BlockParams {
  [key: string]: unknown;
}

export interface BlockExecutionContext {
  params: BlockParams;
  inputs: Record<string, unknown>;
  settings: Record<string, string>;
  signal?: AbortSignal;
}

export interface BlockResult {
  ok: boolean;
  output: unknown;
  error?: string;
  meta?: Record<string, unknown>;
  durationMs: number;
}

export interface NativeBlockExecutor {
  blockId: string;
  execute(ctx: BlockExecutionContext): Promise<BlockResult>;
}
