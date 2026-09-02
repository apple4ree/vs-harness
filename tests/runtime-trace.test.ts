import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { RuntimeTraceService } from "../apps/desktop/src/main/services/runtime-trace-service";
import {
  compareRuntimeTrace,
  observedRuntimeRelations,
  validateRuntimeTraceSession,
} from "../apps/desktop/src/shared/runtime-trace-ir";

test("runtime trace stores structural symbol events and drops actual values", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-trace-source-"));
  const storage = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-trace-store-"),
  );
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(storage, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(root, "trace.ts"),
    [
      "export function inner() { return 1; }",
      "export function outer() { return inner(); }",
      "outer();",
      "",
    ].join("\n"),
  );
  const graph = await analyzeRepository(root);
  assert(graph.semantic?.validation.valid);
  const warnings: string[] = [];
  const service = new RuntimeTraceService(storage, (warning) =>
    warnings.push(warning),
  );
  const started = await service.start({
    graph,
    taskId: "trace-fixture",
    taskLabel: "Trace fixture",
    commandReceipt: "a".repeat(64),
  });

  service.ingest(started.id, "ordinary terminal output is ignored\n");
  service.ingest(
    started.id,
    'WITCH_TRACE_V1 {"phase":"enter","path":"trace.ts","symbol":"outer","args":["DO_NOT_STORE"]}\n',
  );
  service.ingest(
    started.id,
    'WITCH_TRACE_V1 {"phase":"enter","path":"trace.ts","symbol":"outer"}\n' +
      'WITCH_TRACE_V1 {"phase":"enter","path":"trace.ts","symbol":"inner"}\n',
  );
  service.ingest(
    started.id,
    'WITCH_TRACE_V1 {"phase":"exit","path":"trace.ts","symbol":"inner","outcome":"ok"}\n' +
      'WITCH_TRACE_V1 {"phase":"exit","path":"trace.ts","symbol":"outer","outcome":"ok"}\n',
  );
  const finished = await service.finish(started.id, "completed");
  assert(finished);
  assert.equal(finished.status, "completed");
  assert.equal(finished.events.length, 4);
  assert.equal(finished.validation.actualValueCount, 0);
  assert(
    finished.warnings.some(
      (warning) => warning.code === "TRACE_WIRE_VALUE_FIELD_DROPPED",
    ),
  );

  const observed = observedRuntimeRelations(finished);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].observationCount, 1);
  assert.equal(observed[0].trust, "observed");
  assert.equal(observed[0].provenance.traceSessionId, started.id);
  const labels = new Map(
    graph.semantic!.nodes.map((node) => [node.id, node.label]),
  );
  assert.equal(labels.get(observed[0].from), "outer");
  assert.equal(labels.get(observed[0].to), "inner");

  const loaded = await service.list(root, graph);
  assert.equal(loaded.length, 1);
  assert.deepEqual(loaded[0].events, finished.events);
  assert.equal(warnings.length, 0);
  const serializedStore = await readAllText(storage);
  assert(!serializedStore.includes("DO_NOT_STORE"));
  assert(!serializedStore.includes("ordinary terminal output"));
});

test("runtime trace validation and comparison fail closed without execution", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-trace-validate-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "main.py"),
    "def child():\n    return 1\n\ndef parent():\n    return child()\n",
  );
  const graph = await analyzeRepository(root);
  const semantic = graph.semantic!;
  const parent = semantic.nodes.find((node) => node.label === "parent")!;
  const child = semantic.nodes.find((node) => node.label === "child")!;
  const session = {
    schemaVersion: 1 as const,
    contract: "witch.runtime-trace/v1" as const,
    analyzerVersion: "test",
    policyVersion: "no-values",
    id: "11111111-1111-4111-8111-111111111111",
    workspaceRoot: root,
    sourceRevision: graph.revision,
    semanticRevision: semantic.revision,
    taskId: "test",
    taskLabel: "test",
    startedAt: "2026-09-02T00:00:00.000Z",
    completedAt: "2026-09-02T00:00:01.000Z",
    commandReceipt: "b".repeat(64),
    status: "completed" as const,
    revision: "c".repeat(64),
    events: [
      {
        id: "event-1",
        sequence: 1,
        phase: "enter" as const,
        semanticNodeId: child.id,
        parentSemanticNodeId: parent.id,
        offsetMs: 1,
        durationMs: 2,
        outcome: "ok" as const,
      },
    ],
    warnings: [],
  };
  assert.equal(validateRuntimeTraceSession(session, semantic).valid, true);
  const tampered = {
    ...session,
    events: [{ ...session.events[0], returnValue: "secret" }],
  };
  const invalid = validateRuntimeTraceSession(tampered, semantic);
  assert.equal(invalid.valid, false);
  assert(
    invalid.diagnostics.some(
      (diagnostic) => diagnostic.code === "TRACE_EVENT_VALUE_FIELD_FORBIDDEN",
    ),
  );
  const observed = observedRuntimeRelations(session);
  const compared = compareRuntimeTrace(
    [
      {
        id: "static-call",
        from: parent.id,
        to: child.id,
        kind: "calls",
        trust: "verified",
        confidence: 1,
        status: "accepted",
        evidence: [],
        provenance: { analyzer: "test", version: "1", policy: "test" },
      },
    ],
    observed,
  );
  assert.equal(compared.matchedCount, 1);
  assert.equal(compared.staticOnlyCount, 0);
  assert.equal(compared.observedOnlyCount, 0);
});

async function readAllText(directory: string): Promise<string> {
  let result = "";
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    result += entry.isDirectory()
      ? await readAllText(target)
      : await fs.readFile(target, "utf8");
  }
  return result;
}
