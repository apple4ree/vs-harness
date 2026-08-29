import { promises as fs } from "node:fs";
import assert from "node:assert/strict";

// Header constants/layout: LLVM's public MachO.h, mirroring mach-o/loader.h
// and mach-o/fat.h. This checks architecture, not signing or runtime behavior.
// https://github.com/llvm/llvm-project/blob/main/llvm/include/llvm/BinaryFormat/MachO.h
export async function machoArchitectures(file: string): Promise<string[]> {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    assert(stat.isFile(), "Mach-O input must be a regular file");
    async function read(offset: number, length: number) {
      assert(
        Number.isSafeInteger(offset) &&
          offset >= 0 &&
          offset + length <= stat.size,
        "Mach-O header or slice is outside the file",
      );
      const buffer = Buffer.alloc(length);
      let received = 0;
      while (received < length) {
        const { bytesRead } = await handle.read(
          buffer,
          received,
          length - received,
          offset + received,
        );
        assert(bytesRead > 0, "Mach-O file was truncated while reading");
        received += bytesRead;
      }
      return buffer;
    }
    function thinCpu(header: Buffer) {
      const magic = header.readUInt32BE(0);
      assert(
        [0xfeedfacf, 0xcffaedfe].includes(magic),
        "Expected a 64-bit Mach-O slice",
      );
      return magic === 0xcffaedfe
        ? header.readUInt32LE(4)
        : header.readUInt32BE(4);
    }
    function architecture(cpu: number) {
      assert(
        [0x01000007, 0x0100000c].includes(cpu),
        "Unsupported Mach-O CPU architecture",
      );
      return cpu === 0x01000007 ? "x64" : "arm64";
    }
    const header = await read(0, 32);
    const magic = header.readUInt32BE(0);
    if ([0xfeedfacf, 0xcffaedfe].includes(magic))
      return [architecture(thinCpu(header))];
    assert(
      [0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic),
      "Expected a Mach-O or universal Mach-O binary",
    );
    const little = [0xbebafeca, 0xbfbafeca].includes(magic);
    const wide = [0xcafebabf, 0xbfbafeca].includes(magic);
    const u32 = (bytes: Buffer, offset: number) =>
      little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const u64 = (bytes: Buffer, offset: number) => {
      const value = little
        ? bytes.readBigUInt64LE(offset)
        : bytes.readBigUInt64BE(offset);
      assert(
        value <= BigInt(Number.MAX_SAFE_INTEGER),
        "Mach-O slice offset exceeds safe bounds",
      );
      return Number(value);
    };
    const count = u32(header, 4),
      width = wide ? 32 : 20;
    assert(count > 0 && count <= 32, "Invalid universal Mach-O slice count");
    const table = await read(8, count * width);
    const slices: { start: number; end: number; cpu: number }[] = [];
    const result: string[] = [];
    for (let index = 0; index < count; index++) {
      const position = index * width;
      const cpu = u32(table, position);
      const start = wide ? u64(table, position + 8) : u32(table, position + 8);
      const size = wide ? u64(table, position + 16) : u32(table, position + 12);
      assert(
        size >= 32 &&
          start >= 8 + table.length &&
          Number.isSafeInteger(start + size) &&
          start + size <= stat.size,
        "Mach-O slice is outside the file",
      );
      assert(
        !slices.some(
          (slice) => start < slice.end && start + size > slice.start,
        ),
        "Mach-O slices overlap",
      );
      assert(
        !slices.some((slice) => slice.cpu === cpu),
        "Duplicate Mach-O architecture",
      );
      assert.equal(
        thinCpu(await read(start, 32)),
        cpu,
        "Mach-O slice CPU does not match its universal header",
      );
      slices.push({ start, end: start + size, cpu });
      result.push(architecture(cpu));
    }
    return result.sort();
  } finally {
    await handle.close();
  }
}
