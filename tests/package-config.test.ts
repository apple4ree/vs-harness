import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";

test("macOS preview packaging requests local ad-hoc signing and never automatic notarization", async () => {
  const config = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(config.build.mac.identity, "-");
  assert.equal(config.build.mac.notarize, false);
  assert.match(config.scripts["package:mac"], /npm run build/);
  assert.match(config.scripts["package:mac:built"], /--universal/);
  assert.match(config.scripts["package:mac:built"], /--publish never/);
  assert.match(config.scripts.postinstall, /fix-node-pty-permissions\.cjs/);
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

test("desktop builds use one cross-platform memory-stable entry point", async () => {
  const config = JSON.parse(await fs.readFile("package.json", "utf8"));
  assert.equal(config.scripts.build, "node scripts/build-desktop.cjs");
  assert.match(config.scripts["package:win"], /npm run build/);
  assert.match(config.scripts["package:mac"], /npm run build/);
  const wrapper = await fs.readFile("scripts/build-desktop.cjs", "utf8");
  assert.match(wrapper, /process\.execPath/);
  assert.match(wrapper, /--max-old-space-size=4096/);
  assert.match(
    wrapper,
    /electron-vite["',\s]+[\s\S]*bin["',\s]+[\s\S]*electron-vite\.js/,
  );
  assert.doesNotMatch(wrapper, /shell:\s*true/);
});
