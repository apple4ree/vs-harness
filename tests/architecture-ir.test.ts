import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finalizeArchitectureGraph,
  validateArchitectureGraph,
  type ArchitectureGraphDraft,
} from "../apps/desktop/src/shared/architecture-ir";
import {
  traceArchitectureReach,
  traceArchitectureRoute,
} from "../apps/desktop/src/shared/architecture-navigation";

function draft(): ArchitectureGraphDraft {
  return {
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: "/fixture",
    revision: "revision-1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    scannedFiles: 2,
    totalFiles: 2,
    truncated: false,
    warnings: ["z warning", "a warning", "z warning"],
    nodes: [
      {
        id: "src/b.ts",
        label: "b.ts",
        kind: "file",
        path: "src/b.ts",
        module: "src",
        language: "ts",
        count: 1,
        hash: "hash-b",
        symbols: [],
        evidence: [{ path: "src/b.ts", line: 1, hash: "hash-b" }],
      },
      {
        id: "src/a.ts",
        label: "a.ts",
        kind: "file",
        path: "src/a.ts",
        module: "src",
        language: "ts",
        count: 1,
        hash: "hash-a",
        symbols: [],
        evidence: [{ path: "src/a.ts", line: 1, hash: "hash-a" }],
      },
    ],
    edges: [
      {
        id: "src/a.ts:imports:src/b.ts",
        from: "src/a.ts",
        to: "src/b.ts",
        kind: "imports",
        count: 1,
        evidence: [
          {
            path: "src/a.ts",
            line: 1,
            hash: "hash-a",
            excerpt: 'import "./b"',
          },
        ],
      },
    ],
  };
}

test("architecture IR is canonicalized and carries a deterministic validation receipt", () => {
  const graph = finalizeArchitectureGraph(draft());
  assert.deepEqual(
    graph.nodes.map((node) => node.id),
    ["src/a.ts", "src/b.ts"],
  );
  assert.deepEqual(graph.warnings, ["a warning", "z warning"]);
  assert.deepEqual(graph.validation, validateArchitectureGraph(graph));
  assert.equal(graph.validation.valid, true);
  assert.equal(graph.validation.nodeCount, 2);
  assert.equal(graph.validation.edgeCount, 1);
  assert.equal(graph.validation.evidenceCount, 3);
  assert.equal(graph.validation.sourceBackedNodes, 2);
  assert.equal(graph.validation.sourceBackedEdges, 1);
});

test("architecture IR fails closed when topology or evidence is ungrounded", () => {
  const broken = draft();
  broken.nodes[0].evidence[0].hash = "stale";
  broken.edges[0].to = "src/missing.ts";
  const receipt = validateArchitectureGraph(broken);
  assert.equal(receipt.valid, false);
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "IR_EVIDENCE_HASH_MISMATCH",
    ),
  );
  assert(
    receipt.diagnostics.some((item) => item.code === "IR_EDGE_TARGET_MISSING"),
  );
  assert.throws(() => finalizeArchitectureGraph(broken), /validation failed/);
});

test("reach and route traces reuse only authored directed relations", () => {
  const relations = [
    { id: "e-z", source: "a", target: "c" },
    { id: "e-a", source: "a", target: "b" },
    { id: "e-b", source: "b", target: "d" },
    { id: "e-c", source: "c", target: "d" },
    { id: "e-loop", source: "d", target: "a" },
  ];
  assert.deepEqual(traceArchitectureReach(relations, "b", "upstream"), {
    mode: "upstream",
    nodeIds: ["b", "a", "d", "c"],
    edgeIds: ["e-a", "e-loop", "e-b", "e-c", "e-z"],
  });
  assert.deepEqual(traceArchitectureRoute(relations, "a", "d"), {
    mode: "route",
    nodeIds: ["a", "b", "d"],
    edgeIds: ["e-a", "e-b"],
  });
  assert.equal(traceArchitectureRoute(relations, "missing", "d"), null);
});
