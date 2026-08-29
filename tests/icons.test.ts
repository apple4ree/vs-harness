import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function pngSize(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test("Witch icons contain real PNG images at desktop-required sizes", async () => {
  assert.deepEqual(pngSize(await readFile("build/icon.png")), [1024, 1024]);
  const ico = await readFile("build/icon.ico");
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const windowsSizes: number[] = [];
  for (let index = 0; index < ico.readUInt16LE(4); index++) {
    const entry = 6 + 16 * index;
    const size = ico[entry] || 256;
    const length = ico.readUInt32LE(entry + 8),
      offset = ico.readUInt32LE(entry + 12);
    assert(offset + length <= ico.length);
    assert.deepEqual(pngSize(ico.subarray(offset, offset + length)), [
      size,
      size,
    ]);
    windowsSizes.push(size);
  }
  assert.deepEqual(windowsSizes, [16, 24, 32, 48, 64, 128, 256]);
  const icns = await readFile("build/icon.icns");
  assert.equal(icns.subarray(0, 4).toString("ascii"), "icns");
  assert.equal(icns.readUInt32BE(4), icns.length);
  const macSizes: number[] = [];
  let offset = 8;
  while (offset < icns.length) {
    const length = icns.readUInt32BE(offset + 4);
    assert(length > 8 && offset + length <= icns.length);
    const [width, height] = pngSize(icns.subarray(offset + 8, offset + length));
    assert.equal(width, height);
    macSizes.push(width);
    offset += length;
  }
  assert.equal(offset, icns.length);
  assert.deepEqual(macSizes, [16, 32, 64, 128, 256, 512, 1024]);
});
