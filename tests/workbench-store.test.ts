import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { WorkbenchStore } from "../apps/desktop/src/main/services/workbench-store";
import type { ArchitectureGraph } from "../apps/desktop/src/shared/architecture";
import { finalizeArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";

function graph(root: string): ArchitectureGraph {
  return finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: root,
    revision: "fixture",
    generatedAt: new Date().toISOString(),
    scannedFiles: 200,
    totalFiles: 200,
    truncated: false,
    warnings: [],
    edges: [],
    nodes: Array.from({ length: 200 }, (_, index) => ({
      id: `file-${index}.ts`,
      label: `file-${index}.ts`,
      kind: "file",
      path: `file-${index}.ts`,
      module: ".",
      language: "typescript",
      count: 1,
      hash: "fixture",
      symbols: [],
      evidence: [{ path: `file-${index}.ts`, line: 1, hash: "fixture" }],
    })),
  });
}

test("workbench index stays small, serializes updates and retains full immutable graph readings", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "witch-history-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkbenchStore(directory);
  await Promise.all(
    Array.from({ length: 12 }, (_, index) =>
      store.update((state) => {
        state.projects.push({
          root: path.join(directory, String(index)),
          name: String(index),
          lastOpenedAt: new Date().toISOString(),
          lastBranch: "none",
          lastCommit: "none",
        });
      }),
    ),
  );
  assert.equal((await store.get()).projects.length, 12);
  await assert.rejects(
    store.update((state) => {
      state.projects = [];
      throw new Error("mutator failed");
    }),
    /mutator failed/,
  );
  assert.equal((await store.get()).projects.length, 12);
  const snapshot = await store.saveSnapshot(
    graph(directory),
    "fixture",
    "none",
  );
  assert.equal(snapshot.nodeCount, 200);
  assert(!("nodes" in snapshot));
  const index = await fs.readFile(path.join(directory, "witch-state.json"));
  const stored = await fs.readFile(
    path.join(directory, "snapshots", snapshot.id + ".json"),
  );
  assert(index.length < stored.length / 4);
  assert.equal(JSON.parse(stored.toString()).nodes.length, 200);
  const reopened = new WorkbenchStore(directory);
  assert.equal((await reopened.get()).snapshots[0].id, snapshot.id);
  await reopened.update((state) => {
    state.projects = [];
  });
  assert.deepEqual(
    await fs.readFile(path.join(directory, "snapshots", snapshot.id + ".json")),
    stored,
  );
});

test("legacy embedded graphs migrate with byte-for-byte backup preservation", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-history-migrate-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const snapshot = {
    ...graph(directory),
    id: randomUUID(),
    workspaceName: "legacy",
    commit: "none",
    createdAt: new Date().toISOString(),
  };
  const legacy = JSON.stringify(
    { version: 1, projects: [], snapshots: [snapshot], tasks: [] },
    null,
    2,
  );
  await fs.writeFile(path.join(directory, "witch-state.json"), legacy);
  const store = new WorkbenchStore(directory);
  const [first, second] = await Promise.all([store.get(), store.get()]);
  assert.equal(first.version, 2);
  assert.deepEqual(first, second);
  assert(!("nodes" in first.snapshots[0]));
  const backups = (await fs.readdir(directory)).filter((name) =>
    name.startsWith("witch-state.v1-"),
  );
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(directory, backups[0]), "utf8"),
    legacy,
  );
  assert.deepEqual(
    JSON.parse(
      await fs.readFile(
        path.join(directory, "snapshots", snapshot.id + ".json"),
        "utf8",
      ),
    ),
    snapshot,
  );
});

test("corrupt workbench indexes recover from previous saves without losing damaged originals", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-history-recover-"),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new WorkbenchStore(directory);
  await store.update(() => undefined);
  await store.update(() => undefined);
  const broken = "{ interrupted write";
  await fs.writeFile(path.join(directory, "witch-state.json"), broken);
  const warnings: string[] = [];
  const recovered = new WorkbenchStore(directory, (message) =>
    warnings.push(message),
  );
  assert.equal((await recovered.get()).version, 2);
  assert.equal(warnings.length, 1);
  await recovered.update(() => undefined);
  const archive = (await fs.readdir(directory)).find((name) =>
    name.includes(".corrupt-"),
  );
  assert(archive);
  assert.equal(
    await fs.readFile(path.join(directory, archive), "utf8"),
    broken,
  );
  assert.equal(
    JSON.parse(
      await fs.readFile(path.join(directory, "witch-state.json"), "utf8"),
    ).version,
    2,
  );
  await fs.writeFile(path.join(directory, "witch-state.json"), broken);
  await fs.writeFile(path.join(directory, "witch-state.json.previous"), broken);
  const blocked = new WorkbenchStore(directory);
  await assert.rejects(blocked.get(), /original files are retained/);
  await assert.rejects(
    blocked.update(() => undefined),
    /original files are retained/,
  );
  assert.equal(
    await fs.readFile(path.join(directory, "witch-state.json"), "utf8"),
    broken,
  );
});
