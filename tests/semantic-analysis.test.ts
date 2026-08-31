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
      "from .risk import RiskEngine, validate_limit, submit_order, record_rejection",
      "",
      "@agent.command()",
      "async def run_agent():",
      "    validate_limit()",
      "    if approved:",
      "        submit_order()",
      "    else:",
      "        record_rejection()",
      "    for retry_attempt in range(3):",
      "        submit_order()",
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
      "def validate_limit():",
      "    return True",
      "",
      "def submit_order():",
      "    return True",
      "",
      "def record_rejection():",
      "    return False",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "lib.rs"),
    [
      "mod broker;",
      "use crate::broker::Broker;",
      "use crate::broker::{validate_risk, submit_order, record_rejection};",
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
      "pub async fn main() {",
      "    validate_risk();",
      "    if allowed {",
      "        submit_order();",
      "    } else {",
      "        record_rejection();",
      "    }",
      "    for retry_attempt in 0..3 {",
      "        submit_order();",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "broker.rs"),
    [
      "pub struct Broker;",
      "pub fn validate_risk() {}",
      "pub fn submit_order() {}",
      "pub fn record_rejection() {}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "agent.ts"),
    [
      "export class Planner {",
      "  async planTrade() { return true }",
      "}",
      "export function submitOrder() { return true }",
      "export function bootstrapAgent() { return submitOrder() }",
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
  const pythonRun = python.symbols.find(
    (symbol) => symbol.name === "run_agent",
  )!;
  const pythonValidate = graph.nodes
    .find((node) => node.id === "src/risk.py")!
    .symbols.find(
      (symbol) => symbol.name === "validate_limit" && !symbol.containerId,
    )!;
  assert(
    semantic.relations.some(
      (relation) =>
        relation.kind === "calls" &&
        relation.from === `semantic:symbol:${pythonRun.id}` &&
        relation.to === `semantic:symbol:${pythonValidate.id}` &&
        relation.trust === "inferred" &&
        relation.description?.includes("Python static binding"),
    ),
  );
  const rustMain = rust.symbols.find((symbol) => symbol.name === "main")!;
  const rustValidate = graph.nodes
    .find((node) => node.id === "src/broker.rs")!
    .symbols.find((symbol) => symbol.name === "validate_risk")!;
  assert(
    semantic.relations.some(
      (relation) =>
        relation.kind === "calls" &&
        relation.from === `semantic:symbol:${rustMain.id}` &&
        relation.to === `semantic:symbol:${rustValidate.id}` &&
        relation.trust === "inferred" &&
        relation.description?.includes("Rust source-resolved"),
    ),
  );
  assert(
    semantic.relations.some((relation) => relation.kind === "branches-to"),
  );
  assert(semantic.relations.some((relation) => relation.kind === "retries"));
  assert(semantic.relations.some((relation) => relation.kind === "precedes"));
  assert(
    semantic.nodes.some(
      (node) =>
        node.kind === "workflow-step" &&
        node.stepKind === "retry" &&
        node.description?.includes("3 attempts"),
    ),
  );
  const bootstrap = typescript.symbols.find(
    (symbol) => symbol.name === "bootstrapAgent",
  )!;
  const submit = typescript.symbols.find(
    (symbol) => symbol.name === "submitOrder",
  )!;
  assert(
    semantic.relations.some(
      (relation) =>
        relation.kind === "calls" &&
        relation.from === `semantic:symbol:${bootstrap.id}` &&
        relation.to === `semantic:symbol:${submit.id}` &&
        relation.trust === "verified",
    ),
  );
  const bootstrapWorkflow = semantic.nodes.find(
    (node) => node.kind === "workflow" && node.sourceSymbolId === bootstrap.id,
  )!;
  assert(
    semantic.relations.some(
      (relation) =>
        relation.kind === "contains" &&
        relation.from === bootstrapWorkflow.id &&
        semantic.nodes.find((node) => node.id === relation.to)?.description ===
          "Direct compiler-resolved call participant; branch and runtime order are not asserted.",
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

test("language-server disagreements preserve both call targets and open a relation question", async (t) => {
  const root = await fixture(t);
  const graph = await analyzeRepository(root, {
    callCorroborator: async ({ nodes, calls }) => {
      const caller = nodes
        .find((node) => node.id === "src/main.py")!
        .symbols.find((symbol) => symbol.name === "run_agent")!;
      const inferred = nodes
        .find((node) => node.id === "src/risk.py")!
        .symbols.find(
          (symbol) => symbol.name === "validate_limit" && !symbol.containerId,
        )!;
      const observed = nodes
        .find((node) => node.id === "src/risk.py")!
        .symbols.find((symbol) => symbol.name === "submit_order")!;
      const call = calls.find(
        (item) =>
          item.fromSourceSymbolId === caller.id &&
          item.toSourceSymbolId === inferred.id,
      )!;
      return {
        observations: [
          {
            fromSourceSymbolId: caller.id,
            inferredToSourceSymbolId: inferred.id,
            observedToSourceSymbolId: observed.id,
            status: "conflicting" as const,
            provider: "pyright" as const,
            evidence: call.evidence,
          },
        ],
        warnings: [],
      };
    },
  });
  const semantic = graph.semantic!;
  const caller = graph.nodes
    .find((node) => node.id === "src/main.py")!
    .symbols.find((symbol) => symbol.name === "run_agent")!;
  const inferred = graph.nodes
    .find((node) => node.id === "src/risk.py")!
    .symbols.find(
      (symbol) => symbol.name === "validate_limit" && !symbol.containerId,
    )!;
  const observed = graph.nodes
    .find((node) => node.id === "src/risk.py")!
    .symbols.find((symbol) => symbol.name === "submit_order")!;
  const inferredRelation = semantic.relations.find(
    (relation) =>
      relation.kind === "calls" &&
      relation.from === `semantic:symbol:${caller.id}` &&
      relation.to === `semantic:symbol:${inferred.id}`,
  )!;
  const observedRelation = semantic.relations.find(
    (relation) =>
      relation.kind === "calls" &&
      relation.from === `semantic:symbol:${caller.id}` &&
      relation.to === `semantic:symbol:${observed.id}`,
  )!;
  assert.equal(inferredRelation.status, "conflicting");
  assert.equal(observedRelation.status, "corroborated");
  const question = semantic.questions.find((item) =>
    item.relationIds?.includes(inferredRelation.id),
  )!;
  assert.deepEqual(
    question.relationIds,
    [inferredRelation.id, observedRelation.id].sort(),
  );
  assert.match(question.recommendation, /pyright call hierarchy/);
});

test("optional call corroboration failure preserves the source graph", async (t) => {
  const root = await fixture(t);
  const graph = await analyzeRepository(root, {
    callCorroborator: async () => {
      throw new Error("provider unavailable");
    },
  });
  assert.equal(graph.semantic?.validation.valid, true);
  assert(
    graph.semantic?.relations.some((relation) => relation.kind === "calls"),
  );
  assert(
    graph.warnings.some((warning) => warning.includes("provider unavailable")),
  );
});

test("semantic revisions are stable for identical scans and record source changes", async (t) => {
  const root = await fixture(t);
  const service = new RepositoryAnalysisService();
  t.after(() => service.dispose());
  const first = await service.analyze(root);
  const second = await service.analyze(root);
  assert.equal(second.semantic?.revision, first.semantic?.revision);
  assert.equal(
    second.semantic?.revisions.length,
    1,
    JSON.stringify(second.semantic?.revisions.at(-1)),
  );
  assert.equal(
    second.semantic?.revisions.at(-1)?.analyzerVersion,
    second.semantic?.analyzerVersion,
  );

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
  assert(
    view.nodes.every((node) =>
      ["system", "component", "workflow", "workflow-step"].includes(
        node.data.kind,
      ),
    ),
  );
  const workflows = buildSemanticView(graph, false, "", new Set(), "workflows");
  assert(workflows.nodes.some((node) => node.data.kind === "workflow-step"));
  assert(workflows.nodes.some((node) => node.data.kind === "symbol"));
  assert(workflows.edges.some((edge) => edge.label === "executes"));
  const workflow = graph.semantic!.nodes.find(
    (node) => node.kind === "workflow" && node.label.includes("run_agent"),
  )!;
  const focused = buildSemanticView(graph, false, "", new Set(), "workflows", {
    focusId: workflow.id,
    mode: "graph",
  });
  assert.equal(
    focused.nodes.filter((node) => node.data.kind === "workflow").length,
    1,
  );
  const sequence = buildSemanticView(graph, false, "", new Set(), "workflows", {
    focusId: workflow.id,
    mode: "sequence",
  });
  assert.equal(
    sequence.nodes.some((node) => node.data.kind === "symbol"),
    false,
  );
  assert(
    sequence.edges.every((edge) =>
      ["contains", "precedes", "branches-to", "retries"].includes(
        String(edge.label),
      ),
    ),
  );
  const collapsed = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "workflows",
    { focusId: workflow.id, mode: "sequence", collapseBranches: true },
  );
  assert(collapsed.nodes.length < sequence.nodes.length);
  assert(
    collapsed.nodes.some((node) => node.data.subtitle.includes("branch step")),
  );
  assert(
    collapsed.nodes.some((node) => node.data.label.includes("retry_attempt")),
    "collapsing a single-arm branch must preserve the post-branch retry flow",
  );
  assert(
    collapsed.edges.some((edge) => edge.id.startsWith("projection:collapsed:")),
    "a collapsed branch should retain a display-only continuation edge",
  );
  const calls = buildSemanticView(graph, false, "", new Set(), "calls");
  assert(calls.nodes.every((node) => node.data.kind === "symbol"));
  assert(calls.edges.some((edge) => edge.label === "calls"));
  const questions = buildSemanticView(graph, false, "", new Set(), "questions");
  assert(questions.nodes.some((node) => node.data.questions));
});
