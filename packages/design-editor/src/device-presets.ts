/** Preview device width presets (Design Editor Preview mode). */

export interface DevicePreset {
  id: string;
  label: string;
  width: number | '100%';
  height?: number | '100%';
}

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: 'fluid', label: 'Fluid', width: '100%' },
  { id: 'desktop', label: 'Desktop', width: 1280 },
  { id: 'laptop', label: 'Laptop', width: 1024 },
  { id: 'tablet', label: 'Tablet', width: 768 },
  { id: 'mobile', label: 'Mobile', width: 390 },
] as const;

export function resolvePresetWidth(presetId: string): number | '100%' {
  const p = DEVICE_PRESETS.find((d) => d.id === presetId);
  return p?.width ?? '100%';
}
