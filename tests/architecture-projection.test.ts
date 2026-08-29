import { test } from "node:test";
import assert from "node:assert/strict";
import { finalizeArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";
import { projectSourceNeighborhood } from "../apps/desktop/src/shared/architecture-projection";
import { buildView } from "../apps/desktop/src/renderer/src/components/architecture-view";

function graph() {
  const files = ["src/a.ts", "src/b.ts", "src/c.ts", "src/unrelated.ts"];
  return finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "test",
    workspaceRoot: "/fixture",
    revision: "projection-revision",
    generatedAt: "2026-08-30T00:00:00.000Z",
    scannedFiles: files.length,
    totalFiles: files.length,
    truncated: false,
    warnings: [],
    nodes: [
      ...files.map((sourcePath) => ({
        id: sourcePath,
        path: sourcePath,
        label: sourcePath.split("/").at(-1)!,
        module: "src",
        kind: "file" as const,
        language: "ts",
        count: 1,
        hash: `hash:${sourcePath}`,
        symbols: [],
        evidence: [{ path: sourcePath, line: 1, hash: `hash:${sourcePath}` }],
      })),
      {
        id: "external:react",
        label: "react",
        module: "external",
        kind: "external" as const,
        language: "package",
        count: 1,
        hash: "external:react",
        symbols: [],
        evidence: [],
      },
    ],
    edges: [
      {
        id: "a-imports-b",
        from: "src/a.ts",
        to: "src/b.ts",
        kind: "imports" as const,
        count: 1,
        evidence: [
          {
            path: "src/a.ts",
            line: 2,
            hash: "hash:src/a.ts",
            excerpt: 'import "./b"',
          },
        ],
      },
      {
        id: "b-imports-c",
        from: "src/b.ts",
        to: "src/c.ts",
        kind: "imports" as const,
        count: 1,
        evidence: [
          {
            path: "src/b.ts",
            line: 3,
            hash: "hash:src/b.ts",
            excerpt: 'import "./c"',
          },
        ],
      },
      {
        id: "b-imports-react",
        from: "src/b.ts",
        to: "external:react",
        kind: "imports" as const,
        count: 1,
        evidence: [
          {
            path: "src/b.ts",
            line: 4,
            hash: "hash:src/b.ts",
            excerpt: 'import React from "react"',
          },
        ],
      },
    ],
  });
}

test("source neighborhood preserves exact one-hop evidence without runtime inference", () => {
  const source = graph();
  const projection = projectSourceNeighborhood(source, "src/b.ts");
  assert(projection);
  assert.equal(projection.contract, "witch.architecture-projection/v1");
  assert.deepEqual(
    projection.nodes.map((node) => node.id),
    ["src/b.ts", "src/a.ts", "src/c.ts"],
  );
  assert.deepEqual(
    projection.incoming.map((edge) => edge.id),
    ["a-imports-b"],
  );
  assert.deepEqual(
    projection.outgoing.map((edge) => edge.id),
    ["b-imports-c"],
  );
  assert.equal(projection.evidenceCount, 2);
  assert.equal(projectSourceNeighborhood(source, "missing.ts"), null);

  const withDependencies = projectSourceNeighborhood(source, "src/b.ts", true)!;
  assert.deepEqual(
    withDependencies.outgoing.map((edge) => edge.id),
    ["b-imports-c", "b-imports-react"],
  );
  const view = buildView(
    source,
    "focus",
    null,
    true,
    "ignored search",
    new Set(),
    withDependencies,
  );
  assert.deepEqual(
    new Set(view.nodes.map((node) => node.id)),
    new Set(["src/a.ts", "src/b.ts", "src/c.ts", "external:react"]),
  );
  assert.deepEqual(
    new Set(view.edges.map((edge) => edge.id)),
    new Set([
      "src/a.ts→src/b.ts",
      "src/b.ts→src/c.ts",
      "src/b.ts→external:react",
    ]),
  );
  assert.equal(view.totalEdges, 3);
});

test("source neighborhood fails closed for tampered topology", () => {
  const source = graph();
  source.edges[0].to = "missing.ts";
  assert.throws(
    () => projectSourceNeighborhood(source, "src/b.ts"),
    /requires validated architecture IR/,
  );
});
