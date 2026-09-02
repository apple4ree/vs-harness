import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { EngineeringRunJournal } from "../apps/desktop/src/main/services/engineering-run-journal";
import { defaultRunBudget } from "../apps/desktop/src/shared/engineering-run";

function created(runId: string, root: string, createdAt: string) {
  return {
    contract: "witch.engineering-run/v1" as const,
    schemaVersion: 1 as const,
    runId,
    workspaceRoot: root,
    workspaceName: path.basename(root),
    sourceRevision: "sha256:test-revision",
    providerId: "codex" as const,
    providerLabel: "Codex",
    mode: "change" as const,
    goal: "Change the project safely",
    createdAt,
    budget: defaultRunBudget("change"),
  };
}

test("Engineering Run journal durably replays events and repairs a stale manifest", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-engineering-journal-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const runId = randomUUID();
  const workspace = path.join(root, "workspace");
  const createdAt = new Date().toISOString();
  const journal = new EngineeringRunJournal(path.join(root, "runs"));
  const first = await journal.append(
    runId,
    "run.created",
    created(runId, workspace, createdAt),
    createdAt,
  );
  const directory = path.join(root, "runs", runId);
  const firstManifest = await fs.readFile(
    path.join(directory, "manifest.json"),
    "utf8",
  );
  await journal.append(runId, "state.changed", {
    from: "created",
    to: "context-planning",
    reason: "Select context",
  });
  await fs.writeFile(path.join(directory, "manifest.json"), firstManifest);

  const recovered = await journal.verify(runId);
  assert.equal(first.eventCount, 1);
  assert.equal(recovered.eventCount, 2);
  assert.equal(recovered.state, "context-planning");
  const repairedManifest = JSON.parse(
    await fs.readFile(path.join(directory, "manifest.json"), "utf8"),
  );
  assert.equal(repairedManifest.eventDigest, recovered.eventDigest);
  assert.equal(repairedManifest.lastSequence, 2);
  const lines = (
    await fs.readFile(path.join(directory, "events.ndjson"), "utf8")
  )
    .trim()
    .split("\n");
  assert.equal(lines.length, 2);
});

test("Engineering Run journal fails closed on tampering and partial records", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-engineering-corruption-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, "workspace");

  const tamperedId = randomUUID();
  const journal = new EngineeringRunJournal(path.join(root, "runs"));
  const createdAt = new Date().toISOString();
  await journal.append(
    tamperedId,
    "run.created",
    created(tamperedId, workspace, createdAt),
    createdAt,
  );
  const tamperedPath = path.join(root, "runs", tamperedId, "events.ndjson");
  const tampered = (await fs.readFile(tamperedPath, "utf8")).replace(
    "Change the project safely",
    "Tampered goal",
  );
  await fs.writeFile(tamperedPath, tampered);
  await assert.rejects(journal.verify(tamperedId), /HASH_MISMATCH/);

  const partialId = randomUUID();
  await journal.append(
    partialId,
    "run.created",
    created(partialId, workspace, createdAt),
    createdAt,
  );
  const partialPath = path.join(root, "runs", partialId, "events.ndjson");
  await fs.appendFile(partialPath, '{"partial":true}');
  await assert.rejects(journal.verify(partialId), /incomplete trailing record/);
});
