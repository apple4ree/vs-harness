import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildView,
  relationsForEdge,
} from "../apps/desktop/src/renderer/src/components/architecture-view";
import { componentContext } from "../apps/desktop/src/shared/architecture";
import { finalizeArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";

test("dense source maps cap rendered connections without losing source evidence", () => {
  const nodes = Array.from({ length: 230 }, (_, index) => ({
    id: `module${index}/index.ts`,
    path: `module${index}/index.ts`,
    label: "index.ts",
    module: `module${index}`,
    kind: "file" as const,
    language: "ts",
    count: 1,
    hash: String(index),
    symbols: [],
    evidence: [
      {
        path: `module${index}/index.ts`,
        line: 1,
        hash: String(index),
      },
    ],
  }));
  const edges = nodes.flatMap((from, index) =>
    nodes.slice(index + 1).map((to) => ({
      id: `${from.id}->${to.id}`,
      from: from.id,
      to: to.id,
      kind: "imports" as const,
      count: 1,
      evidence: [{ path: from.id, line: 1, hash: from.hash }],
    })),
  );
  const graph = finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: "/fixture",
    revision: "test",
    generatedAt: "test",
    nodes,
    edges,
    scannedFiles: nodes.length,
    totalFiles: nodes.length,
    truncated: false,
    warnings: [],
  });
  const started = performance.now();
  const view = buildView(
    graph,
    "modules",
    null,
    false,
    "",
    new Set(),
    null,
    "overview",
    {},
    "complete",
  );
  assert.equal(view.nodes.length, 220);
  assert.equal(view.edges.length, 600);
  assert(view.totalEdges > 20000);
  assert.equal(relationsForEdge(graph, view.edges[0]).length, 1);
  assert(
    view.nodes.every(
      (node) =>
        Number.isFinite(node.position.x) && Number.isFinite(node.position.y),
    ),
  );
  console.log(
    `Dense map: ${nodes.length} nodes / ${edges.length} relations → ${view.nodes.length} cards / ${view.edges.length} connections in ${Math.round(performance.now() - started)} ms`,
  );
});

test("readable maps retain a sparse source-backed backbone and visual receipt", () => {
  const nodes = Array.from({ length: 40 }, (_, index) => ({
    id: `module${index}/index.ts`,
    path: `module${index}/index.ts`,
    label: "index.ts",
    module: `module${index}`,
    kind: "file" as const,
    language: "ts",
    count: 1,
    hash: String(index),
    symbols: [],
    evidence: [
      { path: `module${index}/index.ts`, line: 1, hash: String(index) },
    ],
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `${nodes[index].id}->${node.id}`,
    from: nodes[index].id,
    to: node.id,
    kind: "imports" as const,
    count: nodes.length - index,
    evidence: [{ path: nodes[index].id, line: 1, hash: String(index) }],
  }));
  const graph = finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: "/fixture",
    revision: "readable",
    generatedAt: "test",
    nodes,
    edges,
    scannedFiles: nodes.length,
    totalFiles: nodes.length,
    truncated: false,
    warnings: [],
  });

  const view = buildView(graph, "modules", null, false, "", new Set());
  assert(view.nodes.length <= 12);
  assert(view.edges.length <= 11);
  assert.equal(view.projection.density, "readable");
  assert(view.projection.omittedNodes > 0);
  assert(view.projection.omittedEdges > 0);
  assert.equal(view.quality.profile, "showcase");
  assert.equal(view.quality.nodeCount, view.nodes.length);
});

test("large module attachments keep full scope with a bounded path preview", () => {
  const paths = Array.from(
    { length: 20000 },
    (_, index) => `src/large/component-${index}.ts`,
  );
  const context = componentContext(
    "module:src/large",
    "src/large",
    paths,
    "revision",
  );
  assert.equal(context.paths.length, 80);
  assert.equal(context.totalPaths, 20000);
  assert(JSON.stringify(context).length < 50000);
  const long = componentContext(
    "module:src",
    "src",
    paths.slice(0, 100).map((file) => file + "a".repeat(4000)),
    "revision",
  );
  assert(long.paths.length < 80);
  assert(JSON.stringify(long).length < 50000);
});
