import { test } from "node:test";
import assert from "node:assert/strict";
import {
  acceptedByUserReceipt,
  evaluateArchitectureCandidate,
} from "../apps/desktop/src/shared/analysis-integrity";
import { finalizeArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";
import type { ArchitectureGraph } from "../apps/desktop/src/shared/architecture";

function fixture(
  root: string,
  revision: string,
  files: number,
  symbolsPerFile = 2,
): ArchitectureGraph {
  return finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "integrity-test",
    workspaceRoot: root,
    revision,
    generatedAt: "2026-09-03T00:00:00.000Z",
    nodes: Array.from({ length: files }, (_, index) => {
      const file = `src/file-${index}.ts`;
      const hash = `sha256:${String(index).padStart(64, "0")}`;
      return {
        id: file,
        label: `file-${index}.ts`,
        kind: "file" as const,
        path: file,
        module: "src",
        language: "typescript",
        count: symbolsPerFile,
        hash,
        symbols: Array.from({ length: symbolsPerFile }, (_, symbol) => ({
          id: `${file}#symbol-${symbol}`,
          name: `symbol${symbol}`,
          kind: "function" as const,
          line: symbol + 1,
          endLine: symbol + 1,
          exported: true,
        })),
        evidence: [{ path: file, line: 1, hash }],
      };
    }),
    edges: [],
    scannedFiles: files,
    totalFiles: files,
    truncated: false,
    warnings: [],
  });
}

test("large unexplained source graph loss is quarantined", () => {
  const baseline = fixture("project", "baseline", 40);
  const candidate = fixture("project", "candidate", 10);
  const receipt = evaluateArchitectureCandidate(
    baseline,
    candidate,
    new Set(),
    "2026-09-03T01:00:00.000Z",
  );
  assert.equal(receipt.status, "fallback");
  assert.equal(receipt.decision, "unexplained-shrink");
  assert.deepEqual(receipt.loss, {
    files: 30,
    nodes: 30,
    symbols: 60,
    relations: 0,
    semanticNodes: 0,
    workflows: 0,
    knowledgeNodes: 0,
  });
});

test("source deletions explain a large graph shrink", () => {
  const baseline = fixture("project", "baseline", 40);
  const candidate = fixture("project", "candidate", 10);
  const deleted = new Set(
    Array.from({ length: 30 }, (_, index) => `src/file-${index + 10}.ts`),
  );
  const receipt = evaluateArchitectureCandidate(baseline, candidate, deleted);
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.decision, "explained-shrink");
  assert.equal(receipt.confirmedDeletedPaths.length, 30);
});

test("small repository changes do not over-trigger and explicit acceptance is audited", () => {
  const baseline = fixture("project", "baseline", 9);
  const candidate = fixture("project", "candidate", 1);
  const receipt = evaluateArchitectureCandidate(baseline, candidate);
  assert.equal(receipt.status, "accepted");
  assert.equal(receipt.decision, "stable");
  assert.equal(acceptedByUserReceipt(receipt).decision, "user-accepted");
});
