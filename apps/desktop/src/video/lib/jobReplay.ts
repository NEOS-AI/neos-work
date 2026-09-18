export interface JobReplay {
  command: string;
  args: Record<string, unknown>;
}

export function withJobId(args: Record<string, unknown>, jobId: string): Record<string, unknown> {
  const options = args.options;
  if (options && typeof options === "object" && !Array.isArray(options)) {
    return {
      ...args,
      options: { ...(options as Record<string, unknown>), job_id: jobId },
    };
  }
  return { ...args, job_id: jobId };
}

export async function invokeReplay(replay: JobReplay, jobId: string): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke(replay.command, withJobId(replay.args, jobId));
}
