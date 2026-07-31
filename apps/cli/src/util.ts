import { EXIT, type ExitCode } from './exit-codes.js';
import { CliHttpError } from './client.js';

export interface CmdContext {
  argv: string[];
  json: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
}

export function printJson(ctx: CmdContext, value: unknown): void {
  ctx.out(JSON.stringify(value, null, 2));
}

export function printLines(ctx: CmdContext, lines: string[]): void {
  for (const line of lines) ctx.out(line);
}

export function fail(err: unknown): ExitCode {
  if (err instanceof CliHttpError) {
    process.stderr.write(`${err.message}\n`);
    return err.exitCode;
  }
  if (err instanceof Error) {
    process.stderr.write(`${err.message.replace(/[\0\r\n]+/g, ' ').slice(0, 500)}\n`);
    return EXIT.INTERNAL;
  }
  process.stderr.write('Unknown error\n');
  return EXIT.INTERNAL;
}

export function flagValue(argv: string[], name: string): string | undefined {
  const idx = argv.indexOf(name);
  if (idx < 0) return undefined;
  const v = argv[idx + 1];
  if (v == null || v.startsWith('-')) return undefined;
  if (/[\0\r\n]/.test(v)) return undefined;
  return v;
}

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function positional(argv: string[], skipFlags = true): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (skipFlags && a.startsWith('-')) {
      // skip flag value if present
      const next = argv[i + 1];
      if (next && !next.startsWith('-') && a !== '--json' && a !== '-h' && a !== '--help') {
        i++;
      }
      continue;
    }
    out.push(a);
  }
  return out;
}
