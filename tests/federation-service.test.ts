import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import {
  federateSnapshots,
  federationCandidates,
} from "../apps/desktop/src/main/services/federation-service";
import type { ArchitectureGraph } from "../apps/desktop/src/shared/architecture";
import type {
  SnapshotMetadata,
  WorkbenchState,
} from "../apps/desktop/src/shared/history";

async function repository(
  root: string,
  name: string,
  dependencies: string[] = [],
) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "export function identity(value: string) { return value }\n",
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name,
      dependencies: Object.fromEntries(
        dependencies.map((dependency) => [dependency, "workspace:*"]),
      ),
    }),
  );
  return analyzeRepository(root);
}

function metadata(
  graph: ArchitectureGraph,
  id: string,
  workspaceName: string,
): SnapshotMetadata {
  return {
    schemaVersion: 1,
    diagramKind: "architecture",
    id,
    workspaceRoot: graph.workspaceRoot,
    workspaceName,
    commit: "uncommitted",
    createdAt: graph.generatedAt,
    generatedAt: graph.generatedAt,
    analyzerVersion: graph.analyzerVersion,
    revision: graph.revision,
    scannedFiles: graph.scannedFiles,
    totalFiles: graph.totalFiles,
    truncated: graph.truncated,
    warnings: graph.warnings,
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  };
}

test("federation service exposes only latest inactive readings and resolves them", async (t) => {
  const parent = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-federation-service-"),
  );
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const active = await repository(path.join(parent, "app"), "@witch/app", [
    "@witch/core",
  ]);
  const core = await repository(path.join(parent, "core"), "@witch/core");
  const activeId = "11111111-1111-4111-8111-111111111111";
  const coreId = "22222222-2222-4222-8222-222222222222";
  const staleId = "33333333-3333-4333-8333-333333333333";
  const state: WorkbenchState = {
    version: 2,
    projects: [
      {
        root: active.workspaceRoot,
        name: "App",
        lastOpenedAt: "2026-09-03T12:00:00.000Z",
        lastBranch: "main",
        lastCommit: "uncommitted",
        latestSnapshotId: activeId,
      },
      {
        root: core.workspaceRoot,
        name: "Core",
        lastOpenedAt: "2026-09-03T11:00:00.000Z",
        lastBranch: "main",
        lastCommit: "uncommitted",
        latestSnapshotId: coreId,
      },
    ],
    snapshots: [
      metadata(active, activeId, "App"),
      metadata(core, coreId, "Core"),
      metadata(core, staleId, "Core old"),
    ],
    tasks: [],
  };

  const candidates = federationCandidates(state, active.workspaceRoot);
  assert.deepEqual(
    candidates.map((item) => item.snapshotId),
    [coreId],
  );
  const stored = new Map([[coreId, core]]);
  const federation = await federateSnapshots({
    activeGraph: active,
    activeWorkspaceName: "App",
    snapshotIds: [coreId],
    state,
    loadSnapshot: async (id) => stored.get(id)!,
  });
  assert.equal(federation.validation.valid, true);
  assert.equal(federation.repositories.length, 2);
  assert.equal(federation.links[0].packageName, "@witch/core");

  await assert.rejects(
    federateSnapshots({
      activeGraph: active,
      activeWorkspaceName: "App",
      snapshotIds: [staleId],
      state,
      loadSnapshot: async (id) => stored.get(id)!,
    }),
    /latest reading/,
  );
  await assert.rejects(
    federateSnapshots({
      activeGraph: active,
      activeWorkspaceName: "App",
      snapshotIds: [coreId, coreId],
      state,
      loadSnapshot: async (id) => stored.get(id)!,
    }),
    /unique/,
  );
});
