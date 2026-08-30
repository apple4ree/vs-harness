import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { RepositoryAnalysisService } from "../apps/desktop/src/main/services/repository-analysis";
import { validateSemanticGraph } from "../apps/desktop/src/shared/semantic-ir";
import { buildSemanticView } from "../apps/desktop/src/renderer/src/components/architecture-view";

async function fixture(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-semantic-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, ".witch"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "main.py"),
    [
      "from .risk import RiskEngine",
      "",
      "@agent.command()",
      "async def run_agent():",
      "    return RiskEngine()",
      "",
      "class Agent:",
      "    @tool",
      "    async def execute_order(self):",
      "        return True",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "risk.py"),
    [
      "class RiskEngine:",
      "    def validate_limit(self):",
      "        return True",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "lib.rs"),
    [
      "mod broker;",
      "use crate::broker::Broker;",
      "",
      "pub trait Strategy {",
      "    fn decide(&self);",
      "}",
      "",
      "pub struct LiveStrategy;",
      "impl Strategy for LiveStrategy {",
      "    fn decide(&self) {}",
      "}",
      "",
      "#[tokio::main]",
      "pub async fn main() {}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "broker.rs"),
    "pub struct Broker;\n",
  );
  await fs.writeFile(
    path.join(root, "src", "agent.ts"),
    [
      "export class Planner {",
      "  async planTrade() { return true }",
      "}",
      "export function bootstrapAgent() { return new Planner() }",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, ".witch", "analysis.json"),
    JSON.stringify({
      schemaVersion: 1,
      claims: [
        {
          subjectId: "component:src",
          key: "responsibility",
          value: "Owns the authored agent and trading runtime boundary.",
          reason: "Declared by the project maintainer.",
        },
      ],
    }),
  );
  return root;
}

test("Python, Rust, and TypeScript facts feed a validated semantic graph", async (t) => {
  const root = await fixture(t);
  const graph = await analyzeRepository(root);
  const semantic = graph.semantic;
  assert(semantic);
  assert.equal(validateSemanticGraph(semantic, graph.nodes).valid, true);

  const python = graph.nodes.find((node) => node.id === "src/main.py")!;
  const agent = python.symbols.find((symbol) => symbol.name === "Agent")!;
  const execute = python.symbols.find(
    (symbol) => symbol.name === "execute_order",
  )!;
  assert.equal(execute.kind, "method");
  assert.equal(execute.containerId, agent.id);
  assert.equal(execute.async, true);
  assert.deepEqual(execute.decorators, ["tool"]);
  assert(execute.endLine > execute.line);

  const rust = graph.nodes.find((node) => node.id === "src/lib.rs")!;
  assert(rust.symbols.some((symbol) => symbol.kind === "trait"));
  assert(rust.symbols.some((symbol) => symbol.kind === "implementation"));
  assert(
    rust.symbols.some(
      (symbol) => symbol.kind === "method" && symbol.name === "decide",
    ),
  );
  assert(
    graph.edges.some(
      (edge) => edge.from === "src/lib.rs" && edge.to === "src/broker.rs",
    ),
  );

  const typescript = graph.nodes.find((node) => node.id === "src/agent.ts")!;
  assert(
    typescript.symbols.some(
      (symbol) => symbol.kind === "method" && symbol.name === "planTrade",
    ),
  );
  assert(
    semantic.nodes.some(
      (node) => node.kind === "workflow" && node.label.includes("run_agent"),
    ),
  );
  assert(semantic.relations.some((relation) => relation.kind === "defines"));
  assert(
    semantic.relations.some(
      (relation) =>
        relation.kind === "imports" && relation.trust === "verified",
    ),
  );
});

test("authored conflicts remain provisional questions with recommendation first", async (t) => {
  const root = await fixture(t);
  const graph = await analyzeRepository(root);
  const semantic = graph.semantic!;
  const inferred = semantic.claims.find(
    (claim) =>
      claim.subjectId === "semantic:component:src" &&
      claim.key === "responsibility" &&
      claim.trust === "inferred",
  );
  const authored = semantic.claims.find((claim) => claim.trust === "authored");
  assert.equal(inferred?.status, "conflicting");
  assert.equal(authored?.status, "conflicting");
  const question = semantic.questions[0];
  assert.equal(question.status, "open");
  assert.equal(question.recommendation, inferred?.value);
  assert.deepEqual(
    question.claimIds.sort(),
    [inferred!.id, authored!.id].sort(),
  );
});

test("semantic revisions are stable for identical scans and record source changes", async (t) => {
  const root = await fixture(t);
  const service = new RepositoryAnalysisService();
  t.after(() => service.dispose());
  const first = await service.analyze(root);
  const second = await service.analyze(root);
  assert.equal(second.semantic?.revision, first.semantic?.revision);
  assert.equal(second.semantic?.revisions.length, 1);

  await fs.appendFile(
    path.join(root, "src", "risk.py"),
    "\ndef monitor_risk():\n    return True\n",
  );
  const changed = await service.analyze(root);
  assert.notEqual(changed.semantic?.revision, first.semantic?.revision);
  assert.equal(changed.semantic?.revisions.length, 2);
  assert.equal(
    changed.semantic?.revisions.at(-1)?.parentRevision,
    first.semantic?.revision,
  );
  assert(
    (changed.semantic?.revisions.at(-1)?.summary.nodesAdded || 0) > 0 ||
      (changed.semantic?.revisions.at(-1)?.summary.nodesChanged || 0) > 0,
  );
});

test("meaning view exposes trust, workflow hierarchy, and source context", async (t) => {
  const root = await fixture(t);
  const graph = await analyzeRepository(root);
  const view = buildSemanticView(graph, false, "", new Set());
  assert(view.nodes.some((node) => node.data.kind === "system"));
  assert(view.nodes.some((node) => node.data.kind === "component"));
  assert(view.nodes.some((node) => node.data.kind === "workflow"));
  assert(
    view.nodes.some(
      (node) =>
        node.data.trust === "inferred" && node.data.status === "provisional",
    ),
  );
  assert(view.edges.some((edge) => edge.label === "contains"));
});
