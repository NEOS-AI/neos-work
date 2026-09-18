/**
 * Offline license IPC. Dynamic import avoids SSR issues.
 */

export interface LicenseInfo {
  tier: "free" | "pro" | string;
  path: string | null;
  expires_unix: number | null;
  source: string;
  error: string | null;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  return tauriInvoke<T>(cmd, args);
}

export function licenseStatus(): Promise<LicenseInfo> {
  return invoke<LicenseInfo>("license_status");
}

export function setLicenseFile(path: string | null): Promise<LicenseInfo> {
  return invoke<LicenseInfo>("set_license_file", { path });
}
