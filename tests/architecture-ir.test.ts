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
import { compareArchitectureGraphs } from "../apps/desktop/src/shared/architecture-delta";
import {
  renderArchitectureHtml,
  serializeArchitectureJson,
} from "../apps/desktop/src/shared/architecture-export";

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

test("architecture delta reports only exact authored snapshot changes", () => {
  const base = finalizeArchitectureGraph(draft());
  const next = draft();
  next.revision = "revision-2";
  next.generatedAt = "2026-01-02T00:00:00.000Z";
  next.nodes[0].hash = "hash-b-2";
  next.nodes[0].evidence[0].hash = "hash-b-2";
  next.edges[0].evidence[0].excerpt = 'import "./b.js"';
  next.nodes.push({
    id: "src/c.ts",
    label: "c.ts",
    kind: "file",
    path: "src/c.ts",
    module: "src",
    language: "ts",
    count: 1,
    hash: "hash-c",
    symbols: [],
    evidence: [{ path: "src/c.ts", line: 1, hash: "hash-c" }],
  });
  next.edges.push({
    id: "src/b.ts:imports:src/c.ts",
    from: "src/b.ts",
    to: "src/c.ts",
    kind: "imports",
    count: 1,
    evidence: [{ path: "src/b.ts", line: 1, hash: "hash-b-2" }],
  });
  const delta = compareArchitectureGraphs(
    base,
    finalizeArchitectureGraph(next),
  );
  assert.deepEqual(delta.summary, {
    addedNodes: 1,
    removedNodes: 0,
    changedNodes: 1,
    addedEdges: 1,
    removedEdges: 0,
    changedEdges: 1,
  });
  assert.equal(delta.nodes.added.items[0].id, "src/c.ts");
  assert.deepEqual(delta.nodes.changed.items[0].fields, ["hash"]);
  assert.equal(delta.edges.added.items[0].id, "src/b.ts:imports:src/c.ts");
  assert.deepEqual(delta.edges.changed.items[0].fields, [
    "evidenceFingerprint",
  ]);
  assert.deepEqual(compareArchitectureGraphs(base, base).summary, {
    addedNodes: 0,
    removedNodes: 0,
    changedNodes: 0,
    addedEdges: 0,
    removedEdges: 0,
    changedEdges: 0,
  });
});

test("validated architecture exports are deterministic, portable and script-safe", () => {
  const source = draft();
  source.nodes[0].label = '</script><script>alert("witch")</script>';
  const graph = finalizeArchitectureGraph(source);
  const json = serializeArchitectureJson(graph);
  assert.deepEqual(JSON.parse(json), graph);
  const html = renderArchitectureHtml(graph);
  assert.equal(renderArchitectureHtml(graph), html);
  assert(html.startsWith("<!doctype html>"));
  assert(html.includes("witch.architecture/v1"));
  assert(!html.includes('</script><script>alert("witch")</script>'));
  assert(!/https?:\/\//.test(html));
});
