import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { machoArchitectures } from "../scripts/macho-architectures";

test("Mac terminal prebuilds carry the actual CPU architecture advertised by their directory", async () => {
  for (const architecture of ["x64", "arm64"])
    for (const file of ["pty.node", "spawn-helper"])
      assert.deepEqual(
        await machoArchitectures(
          path.join(
            "node_modules/node-pty/prebuilds",
            `darwin-${architecture}`,
            file,
          ),
        ),
        [architecture],
      );
});

test("universal Mach-O verification checks both endian layouts, slice bounds and actual slice CPUs", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-macho-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "synthetic-macho");
  for (const little of [false, true]) {
    for (const wide of [false, true]) {
      const bytes = Buffer.alloc(384);
      const u32 = (value: number, offset: number) =>
        little
          ? bytes.writeUInt32LE(value, offset)
          : bytes.writeUInt32BE(value, offset);
      const u64 = (value: number, offset: number) =>
        little
          ? bytes.writeBigUInt64LE(BigInt(value), offset)
          : bytes.writeBigUInt64BE(BigInt(value), offset);
      u32(wide ? 0xcafebabf : 0xcafebabe, 0);
      u32(2, 4);
      for (const [index, cpu] of [0x01000007, 0x0100000c].entries()) {
        const position = 8 + index * (wide ? 32 : 20),
          start = 128 + index * 128;
        u32(cpu, position);
        if (wide) {
          u64(start, position + 8);
          u64(32, position + 16);
        } else {
          u32(start, position + 8);
          u32(32, position + 12);
        }
        bytes.writeUInt32LE(0xfeedfacf, start);
        bytes.writeUInt32LE(cpu, start + 4);
      }
      await fs.writeFile(target, bytes);
      assert.deepEqual(await machoArchitectures(target), ["arm64", "x64"]);
      bytes.writeUInt32LE(0x01000007, 260);
      await fs.writeFile(target, bytes);
      await assert.rejects(machoArchitectures(target), /does not match/);
      if (wide) u64(10000, 16);
      else u32(10000, 16);
      await fs.writeFile(target, bytes);
      await assert.rejects(machoArchitectures(target), /outside the file/);
    }
  }
  await fs.writeFile(target, Buffer.alloc(16));
  await assert.rejects(machoArchitectures(target), /outside the file/);
});
