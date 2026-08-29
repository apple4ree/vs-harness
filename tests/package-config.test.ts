import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

test("macOS preview packaging requests local ad-hoc signing and never automatic notarization", async () => {
  const config = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(config.build.mac.identity, "-");
  assert.equal(config.build.mac.notarize, false);
  assert.match(config.scripts["package:mac"], /--universal/);
  assert.match(config.scripts["package:mac"], /--publish never/);
  const entitlements = await fs.readFile(config.build.mac.entitlements, "utf8");
  assert.match(
    entitlements,
    /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/,
  );
  assert.match(
    entitlements,
    /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\s*\/>/,
  );
});
