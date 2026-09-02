import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createWorkspaceCopy,
  collectChanges,
} from "../apps/desktop/src/main/services/change-review";
import {
  createBaselineCheckpoint,
  createReviewCheckpoint,
  readReviewCheckpoint,
} from "../apps/desktop/src/main/services/engineering-run-artifacts";

test("checkpoint artifacts reproduce a review diff and reject tampering", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-checkpoint-artifact-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, "project");
  const runDirectory = path.join(directory, "run");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  const copy = await createWorkspaceCopy(root, runDirectory);
  const baseline = await createBaselineCheckpoint(runDirectory, copy);
  assert.equal(baseline.changedPaths.length, 0);
  assert.equal(baseline.totalBytes, 24);
  await fs.writeFile(
    path.join(copy.root, "main.ts"),
    "export const value = 2;\n",
  );
  const changes = await collectChanges(root, copy);
  const review = await createReviewCheckpoint(
    runDirectory,
    baseline.checkpointId,
    changes,
  );
  assert.deepEqual(review.changedPaths, ["main.ts"]);
  assert.equal(review.parentId, baseline.checkpointId);
  assert.deepEqual(
    await readReviewCheckpoint(runDirectory, review.checkpointId),
    changes,
  );

  const changesPath = path.join(
    runDirectory,
    "checkpoints",
    review.checkpointId,
    "changes.json",
  );
  await fs.writeFile(
    changesPath,
    (await fs.readFile(changesPath, "utf8")).replace("value = 2", "value = 3"),
  );
  await assert.rejects(
    readReviewCheckpoint(runDirectory, review.checkpointId),
    /integrity validation/,
  );
});
