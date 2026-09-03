import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { FederationApprovalStore } from "../apps/desktop/src/main/services/federation-approval-store";

test("federation approvals persist atomically and corrupt history fails closed", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-federation-approvals-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, "federation-approvals.json");
  const store = new FederationApprovalStore(target);
  const first = await store.approve({
    questionId: "question:first",
    federationRevision: "federation:first",
    subjectWorkspaceRoot: path.join(directory, "app"),
    subjectSourceRevision: "source:app",
    providerWorkspaceRoot: path.join(directory, "core"),
    providerSourceRevision: "source:core",
    ecosystem: "npm",
    packageName: "@witch/core",
  });
  const second = await store.approve({
    questionId: "question:first",
    federationRevision: "federation:second",
    subjectWorkspaceRoot: path.join(directory, "app"),
    subjectSourceRevision: "source:app",
    providerWorkspaceRoot: path.join(directory, "core-copy"),
    providerSourceRevision: "source:copy",
    ecosystem: "npm",
    packageName: "@witch/core",
  });
  await store.flush();
  const approvals = await new FederationApprovalStore(target).list();
  assert.equal(approvals.length, 2);
  assert.equal(approvals[0].id, second.id);
  assert.equal(approvals[1].id, first.id);

  await store.revoke(second.id);
  assert.deepEqual(await store.list(), []);
  const revokedHistory = await store.history();
  assert.equal(revokedHistory.length, 2);
  assert(revokedHistory.every((entry) => entry.status === "revoked"));
  assert(revokedHistory.every((entry) => entry.revokedAt));
  await assert.rejects(store.revoke(second.id), /already revoked/);

  const third = await store.approve({
    questionId: "question:first",
    federationRevision: "federation:third",
    subjectWorkspaceRoot: path.join(directory, "app"),
    subjectSourceRevision: "source:app",
    providerWorkspaceRoot: path.join(directory, "core"),
    providerSourceRevision: "source:core",
    ecosystem: "npm",
    packageName: "@witch/core",
  });
  assert.deepEqual(
    (await store.list()).map((item) => item.id),
    [third.id],
  );
  assert.equal((await store.history())[0].status, "active");

  const original = await fs.readFile(target, "utf8");
  await fs.writeFile(target, '{"contract":"damaged"}\n');
  await assert.rejects(
    new FederationApprovalStore(target).list(),
    /original file was preserved/,
  );
  assert.equal(await fs.readFile(target, "utf8"), '{"contract":"damaged"}\n');
  assert.notEqual(original, await fs.readFile(target, "utf8"));
});
