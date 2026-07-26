/**
 * archiver@8 exports ZipArchive at runtime; @types/archiver only documents the
 * legacy default factory. Augment the module so route/export code typechecks.
 */
declare module 'archiver' {
  import type { Transform } from 'node:stream';

  interface ZipArchiveOptions {
    zlib?: { level?: number };
  }

  export class ZipArchive extends Transform {
    constructor(options?: ZipArchiveOptions);
    append(
      source: string | Buffer | NodeJS.ReadableStream,
      data: { name: string },
    ): this;
    finalize(): this | Promise<void>;
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: string, listener: (...args: unknown[]) => void): this;
  }
}
