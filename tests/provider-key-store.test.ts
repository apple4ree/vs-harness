import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ProviderKeyStore } from "../apps/desktop/src/main/services/provider-key-store";

const ciphertext = (value: string) => ({
  encrypted: Buffer.from(value).toString("base64"),
  updatedAt: new Date().toISOString(),
});

test("encrypted provider stores merge concurrent updates and remove only the selected key", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-key-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 4 }));
  const store = new ProviderKeyStore(root);
  const first = ciphertext("encrypted-openai-fixture"),
    second = ciphertext("encrypted-anthropic-fixture");
  await Promise.all([
    store.update((value) => {
      value.keys.openai = first;
    }),
    store.update((value) => {
      value.keys.anthropic = second;
    }),
  ]);
  assert.deepEqual((await store.read()).keys, {
    openai: first,
    anthropic: second,
  });
  await store.update((value) => {
    delete value.keys.openai;
  });
  await store.flush();
  assert.deepEqual((await new ProviderKeyStore(root).read()).keys, {
    anthropic: second,
  });
  assert.deepEqual(
    await fs.readdir(root),
    ["api-keys.json"],
    "no old-key backups or unfinished temporary files are retained",
  );
});

test("corrupt or oversized encrypted credentials are reported without overwriting the original", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-key-corrupt-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 4 }));
  const target = path.join(root, "api-keys.json");
  const store = new ProviderKeyStore(root);
  for (const original of [
    '{"version":1,broken',
    JSON.stringify({ version: 9, keys: {} }),
    "x".repeat(65_000),
  ]) {
    await fs.writeFile(target, original);
    await assert.rejects(store.read());
    await assert.rejects(
      store.update((value) => {
        value.keys.openai = ciphertext("new-ciphertext");
      }),
    );
    assert.equal(await fs.readFile(target, "utf8"), original);
  }
});
