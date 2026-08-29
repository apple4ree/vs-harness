import { promises as fs } from "node:fs";

/** Enforce the limit while reading too: a file may grow after its initial stat. */
export async function readBoundedFile(
  file: string,
  limit: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 0)
    throw new Error("Invalid file-read limit");
  const check = (stat: Awaited<ReturnType<typeof fs.stat>>) => {
    if (!stat.isFile()) throw new Error("Only regular files can be read");
    if (stat.size > limit)
      throw new Error(`File exceeds the ${limit}-byte read limit`);
  };
  check(await fs.stat(file));
  const handle = await fs.open(file, "r");
  try {
    check(await handle.stat());
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(65_536, limit - total + 1));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) return Buffer.concat(chunks, total);
      total += bytesRead;
      if (total > limit)
        throw new Error(`File grew beyond the ${limit}-byte read limit`);
      chunks.push(chunk.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
}
