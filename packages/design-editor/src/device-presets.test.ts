import { describe, expect, it } from 'vitest';
import { DEVICE_PRESETS, resolvePresetWidth } from './device-presets.js';

describe('device-presets', () => {
  it('has fluid and fixed widths', () => {
    expect(DEVICE_PRESETS.some((p) => p.id === 'fluid')).toBe(true);
    expect(resolvePresetWidth('desktop')).toBe(1280);
    expect(resolvePresetWidth('mobile')).toBe(390);
    expect(resolvePresetWidth('fluid')).toBe('100%');
    expect(resolvePresetWidth('unknown')).toBe('100%');
  });
});
