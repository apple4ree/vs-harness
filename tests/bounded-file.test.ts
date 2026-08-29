import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { readBoundedFile } from "../apps/desktop/src/main/services/bounded-file";
import {
  createWorkspaceCopy,
  isPrivateAgentFile,
} from "../apps/desktop/src/main/services/change-review";

test("bounded file reads preserve bytes across chunks and reject oversized or non-regular input", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-bounded-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, "source.txt");
  const bytes = Buffer.from("한글\r\n".repeat(18000));
  await fs.writeFile(input, bytes);
  assert.deepEqual(await readBoundedFile(input, bytes.length), bytes);
  await assert.rejects(readBoundedFile(input, bytes.length - 1), /read limit/);
  await assert.rejects(readBoundedFile(root, bytes.length), /regular files/);
  await fs.writeFile(input, "");
  assert.equal((await readBoundedFile(input, 0)).length, 0);
});

test("known credential files are omitted from agent copies and immutable baselines", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-private-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "source");
  await fs.mkdir(root);
  const privateFiles = [
    ".env.local",
    ".npmrc",
    ".pypirc",
    ".netrc",
    ".aws/credentials",
    ".ssh/config",
    "nested/auth.json",
    "client.key",
    "signing.keystore",
  ];
  for (const relative of privateFiles) {
    assert(isPrivateAgentFile(relative));
    await fs.mkdir(path.dirname(path.join(root, relative)), {
      recursive: true,
    });
    await fs.writeFile(path.join(root, relative), "synthetic secret");
  }
  await fs.writeFile(path.join(root, "index.ts"), "export const value = 1;");
  const copy = await createWorkspaceCopy(root, path.join(directory, "run"));
  assert.deepEqual(Object.keys(copy.baseline), ["index.ts"]);
  for (const relative of privateFiles) {
    assert.equal(
      await fs.stat(path.join(copy.root, relative)).catch(() => null),
      null,
    );
    assert.equal(
      await fs.stat(path.join(copy.baselineRoot, relative)).catch(() => null),
      null,
    );
    assert.equal(
      await fs.readFile(path.join(root, relative), "utf8"),
      "synthetic secret",
    );
  }
});
