import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
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

const populatedGraph = (
  root: string,
  revision: string,
  files: number,
): ArchitectureGraph =>
  finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: root,
    revision,
    generatedAt: "now",
    nodes: Array.from({ length: files }, (_, index) => {
      const relative = `src/file-${index}.ts`;
      const hash = `sha256:${String(index).padStart(64, "0")}`;
      return {
        id: relative,
        label: relative,
        kind: "file" as const,
        path: relative,
        module: "src",
        language: "typescript",
        count: 2,
        hash,
        symbols: [0, 1].map((symbol) => ({
          id: `${relative}#${symbol}`,
          name: `symbol${symbol}`,
          kind: "function" as const,
          line: symbol + 1,
          endLine: symbol + 1,
          exported: true,
        })),
        evidence: [{ path: relative, line: 1, hash }],
      };
    }),
    edges: [],
    scannedFiles: files,
    totalFiles: files,
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

test("parsed symbols persist outside the project and can be rebuilt explicitly", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-index-test-"),
  );
  const root = path.join(directory, "project");
  const indexes = path.join(directory, "indexes");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "agent.ts"),
    "export function main() { return true }\n",
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const firstService = new RepositoryAnalysisService();
  firstService.setIndexRoot(indexes);
  const first = await firstService.analyze(root);
  firstService.dispose();
  assert.equal((await fs.readdir(indexes)).length, 1);

  const secondService = new RepositoryAnalysisService();
  secondService.setIndexRoot(indexes);
  const second = await secondService.analyze(root);
  assert.equal(second.revision, first.revision);
  assert.equal(second.coverage?.cache.persistentHits, 1);
  await secondService.clearIndex(root);
  assert.deepEqual(await fs.readdir(indexes), []);
  secondService.dispose();
});

test("last-known-good survives restart and quarantined candidates require explicit acceptance", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-last-good-test-"),
  );
  const root = path.join(directory, "project");
  const indexes = path.join(directory, "indexes");
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await Promise.all(
    Array.from({ length: 40 }, (_, index) =>
      fs.writeFile(path.join(root, "src", `file-${index}.ts`), "export {}\n"),
    ),
  );
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const firstService = new RepositoryAnalysisService(async () =>
    populatedGraph(root, "baseline", 40),
  );
  firstService.setIndexRoot(indexes);
  const first = await firstService.analyze(root);
  assert.equal(first.integrity?.decision, "initial");
  firstService.dispose();

  const secondService = new RepositoryAnalysisService(async () =>
    populatedGraph(root, "collapsed", 10),
  );
  secondService.setIndexRoot(indexes);
  const fallback = await secondService.analyze(root);
  assert.equal(fallback.revision, "baseline");
  assert.equal(fallback.integrity?.status, "fallback");
  assert.equal(fallback.integrity?.candidateRevision, "collapsed");

  const accepted = await secondService.acceptPendingCandidate(
    root,
    "collapsed",
  );
  assert.equal(accepted.revision, "collapsed");
  assert.equal(accepted.integrity?.decision, "user-accepted");
  await assert.rejects(
    secondService.acceptPendingCandidate(root, "collapsed"),
    /no longer available/,
  );
  secondService.dispose();
});

test("corrupt last-known-good storage fails closed without being overwritten", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-last-good-corrupt-test-"),
  );
  const root = path.join(directory, "project");
  const indexes = path.join(directory, "indexes");
  await fs.mkdir(root);
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const firstService = new RepositoryAnalysisService(async () =>
    populatedGraph(root, "baseline", 20),
  );
  firstService.setIndexRoot(indexes);
  await firstService.analyze(root);
  firstService.dispose();

  const lastGoodDirectory = path.join(directory, "last-known-good");
  const [file] = await fs.readdir(lastGoodDirectory);
  const target = path.join(lastGoodDirectory, file);
  await fs.writeFile(target, "{damaged", "utf8");

  let analyzerCalled = false;
  const secondService = new RepositoryAnalysisService(async () => {
    analyzerCalled = true;
    return populatedGraph(root, "replacement", 20);
  });
  secondService.setIndexRoot(indexes);
  await assert.rejects(
    secondService.analyze(root),
    /Cannot load the persistent last-known-good architecture/,
  );
  assert.equal(analyzerCalled, false);
  assert.equal(await fs.readFile(target, "utf8"), "{damaged");
  secondService.dispose();
});
