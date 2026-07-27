/**
 * JSONL stream adapter — split on newlines, parse each complete line as JSON.
 */

export interface JsonlParseState {
  buffer: string;
  objects: unknown[];
}

export function createJsonlParseState(): JsonlParseState {
  return { buffer: '', objects: [] };
}

export function feedJsonlChunk(
  state: JsonlParseState,
  chunk: string,
): { lines: unknown[]; rawLines: string[] } {
  const delta = typeof chunk === 'string' ? chunk.replace(/\0/g, '') : '';
  state.buffer += delta;
  const parts = state.buffer.split('\n');
  state.buffer = parts.pop() ?? '';
  const lines: unknown[] = [];
  const rawLines: string[] = [];
  for (const line of parts) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rawLines.push(trimmed);
    try {
      const obj = JSON.parse(trimmed) as unknown;
      lines.push(obj);
      state.objects.push(obj);
    } catch {
      lines.push({ raw: trimmed });
      state.objects.push({ raw: trimmed });
    }
  }
  return { lines, rawLines };
}
