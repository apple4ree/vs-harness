import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { contentHash } from "../apps/desktop/src/main/services/workspace-files";
import { verifyIsolatedReview } from "../apps/desktop/src/main/services/engineering-verification";

test("isolated verification separates syntax failure from architecture validation", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-verification-receipt-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = "export const value = 1;\n";
  const after = "export const value = ;\n";
  await fs.writeFile(path.join(root, "main.ts"), after);
  const receipts = await verifyIsolatedReview(root, [
    {
      path: "main.ts",
      before,
      after,
      beforeHash: contentHash(before),
      afterHash: contentHash(after),
    },
  ]);
  assert.deepEqual(
    receipts.map((receipt) => [receipt.intentId, receipt.status]),
    [
      ["changed-source-syntax", "failed"],
      ["isolated-architecture", "passed"],
    ],
  );
  assert.match(receipts[0].boundedOutput || "", /Expression expected/);
  assert.match(receipts[0].outputHash || "", /^[a-f0-9]{64}$/);
  assert.match(receipts[1].changedRevision || "", /^[a-f0-9]{64}$/);
});
