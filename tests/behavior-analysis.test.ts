import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { validateBehaviorGraph } from "../apps/desktop/src/shared/behavior-ir";
import { buildSemanticView } from "../apps/desktop/src/renderer/src/components/architecture-view";

test("TypeScript, Python, and Rust direct bindings produce a validated behavior overlay", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-behavior-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "flow.ts"),
    [
      "export let state = 0;",
      "export function normalize(amount: number): number { return amount + 1; }",
      "export function execute(raw: number): number {",
      "  const normalized = normalize(raw);",
      "  state = normalized;",
      "  return normalized;",
      "}",
      "const dynamic = { normalize };",
      "export function ambiguous(raw: number) { return dynamic.normalize(raw); }",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "agent.py"),
    [
      "def validate(order, strict):",
      "    return order",
      "",
      "def spread(*orders):",
      "    return orders",
      "",
      "def run(order):",
      "    checked = validate(order, strict=True)",
      "    ignored = spread(*order)",
      "    return checked",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "lib.rs"),
    [
      "fn validate(order: i32, limit: i32) -> i32 { order + limit }",
      "pub fn run(order: i32) -> i32 {",
      "    let checked = validate(order, 10);",
      "    checked",
      "}",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const behavior = graph.behavior!;
  assert(behavior);
  assert.equal(behavior.contract, "witch.behavior/v1");
  assert.equal(behavior.validation.valid, true);
  assert.equal(behavior.validation.relationCount, behavior.relations.length);
  assert(behavior.relations.every((relation) => relation.evidence.length > 0));
  assert(
    behavior.relations.every(
      (relation) =>
        relation.provenance.analyzer &&
        relation.provenance.version &&
        relation.provenance.policy,
    ),
  );

  const semanticLabel = new Map(
    graph.semantic!.nodes.map((node) => [node.id, node.label]),
  );
  const passes = behavior.relations.filter(
    (relation) => relation.kind === "passes",
  );
  assert(
    passes.some(
      (relation) =>
        semanticLabel.get(relation.from) === "execute" &&
        semanticLabel.get(relation.to) === "normalize" &&
        relation.trust === "verified",
    ),
  );
  assert(
    passes.some(
      (relation) =>
        semanticLabel.get(relation.from) === "run" &&
        semanticLabel.get(relation.to) === "validate" &&
        relation.trust === "inferred" &&
        behavior.values
          .find((value) => value.id === relation.valueId)
          ?.label.includes("strict"),
    ),
  );
  assert(
    passes.some(
      (relation) =>
        relation.evidence[0].path === "lib.rs" &&
        relation.trust === "inferred",
    ),
  );
  assert(
    behavior.relations.some(
      (relation) =>
        relation.kind === "returns" &&
        semanticLabel.get(relation.from) === "normalize" &&
        semanticLabel.get(relation.to) === "execute" &&
        relation.trust === "verified",
    ),
  );
  assert(
    behavior.relations.some(
      (relation) =>
        relation.kind === "writes-state" &&
        semanticLabel.get(relation.from) === "execute" &&
        semanticLabel.get(relation.to) === "state",
    ),
  );
  assert.equal(
    passes.some((relation) =>
      relation.evidence[0].excerpt?.includes("dynamic.normalize"),
    ),
    false,
  );
  assert.equal(
    passes.some((relation) =>
      relation.evidence[0].excerpt?.includes("spread(*order)"),
    ),
    false,
  );
  assert.equal(
    graph.semantic!.validation.relationCount,
    graph.semantic!.relations.length,
    "the behavior overlay must not mutate semantic topology",
  );
  const behaviorView = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "behavior",
    {},
    "complete",
  );
  assert.equal(behaviorView.totalEdges, behavior.relations.length);
  assert(
    behaviorView.edges.some(
      (edge) => edge.data?.behavior === true && edge.label === "passes",
    ),
  );
  const workflowView = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "workflows",
    { catalogLimit: 20 },
    "complete",
  );
  assert(
    workflowView.nodes.some(
      (node) =>
        node.data.kind === "workflow" &&
        Boolean(node.data.behaviorSummary) &&
        (node.data.behaviorSummary?.inputs.length || 0) > 0,
    ),
  );
});

test("behavior validation rejects missing endpoints, stale evidence, and provenance", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-behavior-validation-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "main.ts"),
    "export function target(value: number) { return value }\nexport function main(input: number) { return target(input) }\n",
  );
  const graph = await analyzeRepository(root);
  const behavior = structuredClone(graph.behavior!);
  assert(behavior.relations.length > 0);
  behavior.relations[0].to = "semantic:missing";
  behavior.relations[0].evidence[0].hash = "0".repeat(64);
  behavior.relations[0].provenance.policy = "";
  const receipt = validateBehaviorGraph(
    behavior,
    graph.semantic,
    graph.nodes,
  );
  assert.equal(receipt.valid, false);
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "BEHAVIOR_RELATION_ENDPOINT_MISSING",
    ),
  );
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "BEHAVIOR_EVIDENCE_HASH_MISMATCH",
    ),
  );
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "BEHAVIOR_PROVENANCE_MISSING",
    ),
  );
});
