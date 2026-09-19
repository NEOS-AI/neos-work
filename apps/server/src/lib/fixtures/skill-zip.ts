/** Test-only zip builder (archiver). */
import { PassThrough } from 'node:stream';

export async function makeSkillZip(
  entries: Array<{ name: string; content: string | Buffer }>,
): Promise<Buffer> {
  const { ZipArchive } = await import('archiver');
  return new Promise((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 1 } });
    const chunks: Buffer[] = [];
    const stream = new PassThrough();
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    archive.on('error', reject);
    archive.pipe(stream);
    for (const e of entries) {
      archive.append(e.content, { name: e.name });
    }
    void archive.finalize();
  });
}

export function skillMd(name: string, extra = ''): string {
  return `---
name: ${name}
description: ${name} fixture
${extra}---
# ${name}
`;
}
