import { test } from "node:test";
import assert from "node:assert/strict";
import { RepositoryAnalysisService } from "../apps/desktop/src/main/services/repository-analysis";
import type { ArchitectureGraph } from "../apps/desktop/src/shared/architecture";
import { finalizeArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";

const graph = (root: string, revision: string): ArchitectureGraph =>
  finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: root,
    revision,
    generatedAt: "now",
    nodes: [],
    edges: [],
    scannedFiles: 0,
    totalFiles: 0,
    truncated: false,
    warnings: [],
  });
test("repository watcher bursts coalesce without concurrent scans", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0,
    active = 0,
    maxActive = 0;
  const service = new RepositoryAnalysisService(async (root) => {
    const sequence = ++calls;
    active++;
    maxActive = Math.max(active, maxActive);
    await gate;
    active--;
    return graph(root, String(sequence));
  });
  const first = service.analyze("project");
  const burst = Array.from({ length: 30 }, () => service.analyze("project"));
  assert.equal(calls, 1);
  release();
  assert.equal((await first).revision, "1");
  const results = await Promise.all(burst);
  assert(results.every((value) => value.revision === "2"));
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
  service.dispose();
  await assert.rejects(service.analyze("project"), /closed/);
});
test("project changes cancel obsolete source analysis", async () => {
  const service = new RepositoryAnalysisService(async (root, { signal }) => {
    if (root === "first")
      await new Promise<void>((_resolve, reject) =>
        signal!.addEventListener("abort", () => reject(signal!.reason), {
          once: true,
        }),
      );
    return graph(root, "complete");
  });
  const first = assert.rejects(service.analyze("first"), /superseded/);
  const next = service.analyze("next");
  await first;
  assert.equal((await next).workspaceRoot, "next");
  service.dispose();
});
