/** Plain text stream adapter — accumulate and emit chunks as-is. */

export interface TextParseState {
  accumulated: string;
}

export function createTextParseState(): TextParseState {
  return { accumulated: '' };
}

export function feedTextChunk(
  state: TextParseState,
  chunk: string,
  maxChars = 2 * 1024 * 1024,
): { delta: string; accumulated: string } {
  const delta = typeof chunk === 'string' ? chunk.replace(/\0/g, '') : '';
  let next = state.accumulated + delta;
  if (next.length > maxChars) {
    next = next.slice(next.length - maxChars);
  }
  state.accumulated = next;
  return { delta, accumulated: state.accumulated };
}
