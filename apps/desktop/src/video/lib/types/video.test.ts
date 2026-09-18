import { describe, expect, it } from 'vitest';

import {
  displaySize,
  formatBytes,
  formatDuration,
  isCancelledError,
  parseFps,
  rotationSwapsAxes,
} from './video.js';

describe('video types', () => {
  it('parses fractional frame rates', () => {
    expect(parseFps('30000/1001')).toBeCloseTo(29.97, 2);
    expect(parseFps(null)).toBeNull();
  });

  it('formats duration and bytes', () => {
    expect(formatDuration(3723)).toBe('01:02:03');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(null)).toBe('—');
  });

  it('swaps display size on 90° rotation', () => {
    expect(rotationSwapsAxes(90)).toBe(true);
    expect(displaySize(1920, 1080, 90)).toEqual({ width: 1080, height: 1920 });
  });

  it('detects cancelled errors', () => {
    expect(isCancelledError('Operation cancelled')).toBe(true);
    expect(isCancelledError('boom')).toBe(false);
  });
});
