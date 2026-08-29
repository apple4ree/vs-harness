import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createWorkspaceCopy,
  collectChanges,
  applyReviewedChanges,
} from "../apps/desktop/src/main/services/change-review";

test("isolated work leaves source unchanged and only approved changes apply", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-review-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const source = path.join(root, "source"),
    run = path.join(root, "run");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "a.ts"), "export const value = 1\n");
  await fs.writeFile(path.join(source, "b.ts"), "keep me");
  await fs.writeFile(path.join(source, ".env"), "SECRET=not-for-agent");
  const copy = await createWorkspaceCopy(source, run);
  await assert.rejects(fs.readFile(path.join(copy.root, ".env")), {
    code: "ENOENT",
  });
  await fs.writeFile(path.join(copy.root, "a.ts"), "export const value = 2\n");
  await fs.writeFile(
    path.join(copy.root, "c.ts"),
    "export const extra = true\n",
  );
  await fs.unlink(path.join(copy.root, "b.ts"));
  const changes = await collectChanges(source, copy);
  assert.equal(changes.length, 3);
  assert.equal(
    await fs.readFile(path.join(source, "a.ts"), "utf8"),
    "export const value = 1\n",
  );
  await applyReviewedChanges(
    source,
    changes.filter((change) => change.path === "a.ts"),
    path.join(run, "recovery"),
  );
  assert.equal(
    await fs.readFile(path.join(source, "a.ts"), "utf8"),
    "export const value = 2\n",
  );
  assert.equal(await fs.readFile(path.join(source, "b.ts"), "utf8"), "keep me");
  await assert.rejects(fs.readFile(path.join(source, "c.ts")), {
    code: "ENOENT",
  });
  await assert.rejects(
    applyReviewedChanges(source, changes, path.join(run, "conflict")),
    /Conflict/,
  );
});

test("new gitignore cannot hide changes and symlink agent output is rejected", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-review-link-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  const source = path.join(root, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "a.ts"), "original");
  const copy = await createWorkspaceCopy(source, path.join(root, "run"));
  await fs.writeFile(path.join(copy.root, ".gitignore"), "*.ts");
  await fs.writeFile(path.join(copy.root, "hidden.ts"), "visible in review");
  assert(
    (await collectChanges(source, copy)).some(
      (change) => change.path === "hidden.ts",
    ),
  );
  await fs.unlink(path.join(copy.root, "a.ts"));
  await fs.symlink(
    source,
    path.join(copy.root, "a.ts"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(collectChanges(source, copy), /junction/);
});

test("concurrent source edits do not lose the isolated review and block apply", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-review-conflict-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "source");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "work.ts"), "baseline");
  const copy = await createWorkspaceCopy(source, path.join(directory, "run"));
  await fs.writeFile(path.join(copy.root, "work.ts"), "agent version");
  await fs.writeFile(path.join(source, "work.ts"), "user version");
  const changes = await collectChanges(source, copy);
  assert.equal(changes[0].before, "baseline");
  assert.equal(changes[0].after, "agent version");
  await assert.rejects(
    applyReviewedChanges(source, changes, path.join(directory, "recovery")),
    /Conflict/,
  );
  assert.equal(
    await fs.readFile(path.join(source, "work.ts"), "utf8"),
    "user version",
  );
});
