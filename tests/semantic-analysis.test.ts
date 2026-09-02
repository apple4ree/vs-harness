import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { RepositoryAnalysisService } from "../apps/desktop/src/main/services/repository-analysis";
import { validateSemanticGraph } from "../apps/desktop/src/shared/semantic-ir";
import {
  buildSemanticView,
  groupWorkflowCatalogCards,
  shouldUseWorkflowCatalogGrid,
  workflowCatalogDisplayLabel,
  type CardNode,
} from "../apps/desktop/src/renderer/src/components/architecture-view";

const workflowCatalogCard = (
  id: string,
  label: string,
  component: string,
  support = false,
): CardNode => ({
  id,
  type: "component",
  position: { x: 0, y: 0 },
  data: {
    label,
    subtitle: `${label}.py`,
    paths: [`${label}.py`],
    kind: "workflow",
    count: 1,
    symbols: 0,
    context: {
      nodeId: id,
      revision: "test",
      label,
      paths: [`${label}.py`],
    },
    changed: false,
    dimmed: false,
    traced: false,
    workflowSummary: {
      steps: 3,
      branches: 1,
      retries: 0,
      support,
      components: [component],
    },
  },
});

test("large workflow catalogs switch to stable component groups", () => {
  const groups = groupWorkflowCatalogCards([
    workflowCatalogCard("support", "Support", "API", true),
    workflowCatalogCard("worker", "Worker", "Worker"),
    workflowCatalogCard("serve", "Serve", "API"),
  ]);
  assert.deepEqual(
    groups.map((group) => [
      group.label,
      group.workflows.map((workflow) => workflow.data.label),
    ]),
    [
      ["API", ["Serve", "Support"]],
      ["Worker", ["Worker"]],
    ],
  );
  assert.equal(
    shouldUseWorkflowCatalogGrid(
      {
        total: 13,
        production: 13,
        support: 0,
        eligible: 13,
        visible: 12,
        hidden: 1,
        supportHidden: 0,
      },
      "pass",
      { expanded: false, includeSupport: false },
    ),
    true,
  );
  assert.equal(
    shouldUseWorkflowCatalogGrid(
      {
        total: 8,
        production: 8,
        support: 0,
        eligible: 8,
        visible: 8,
        hidden: 0,
        supportHidden: 0,
      },
      "pass",
      { expanded: false, includeSupport: false },
    ),
    false,
  );
  assert.equal(
    shouldUseWorkflowCatalogGrid(
      {
        total: 0,
        production: 0,
        support: 0,
        eligible: 0,
        visible: 0,
        hidden: 0,
        supportHidden: 0,
      },
      "pass",
      { expanded: true, includeSupport: true },
    ),
    false,
  );
  assert.equal(
    workflowCatalogDisplayLabel(
      "main workflow",
      "skills/portfolio-risk/scripts/main.py",
      12,
    ),
    "portfolio-risk · main workflow",
  );
  assert.equal(
    workflowCatalogDisplayLabel(
      "main workflow",
      "skills/portfolio-risk/scripts/validate_order.py",
      12,
    ),
    "portfolio-risk/validate_order · main workflow",
  );
  assert.equal(
    workflowCatalogDisplayLabel("serve workflow", "src/server.py", 1),
    "serve workflow",
  );
});

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
      "export let planningState = 0",
      "export class Planner {",
      "  async planTrade() { planningState += 1; return planningState }",
      "}",
      "export function submitOrder() { return true }",
      "export function bootstrapAgent() { return submitOrder() }",
      "export function AgentAvatar() { return true }",
      "export function runPreview() { return true }",
      "export function codepointOrder() { return true }",
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
  for (const name of ["AgentAvatar", "runPreview", "codepointOrder"]) {
    const symbol = typescript.symbols.find((item) => item.name === name)!;
    assert.equal(
      semantic.nodes.some(
        (node) => node.kind === "workflow" && node.sourceSymbolId === symbol.id,
      ),
      false,
      `${name} must not become a workflow without entry-point evidence`,
    );
  }
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
  const component = graph.semantic!.nodes.find(
    (node) => node.kind === "component" && node.label === "src",
  )!;
  const focusedComponent = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "components",
    { componentFocusId: component.id },
  );
  assert.equal(
    focusedComponent.nodes.filter((node) => node.data.kind === "component")
      .length,
    1,
  );
  assert(focusedComponent.nodes.some((node) => node.data.kind === "file"));
  const workflows = buildSemanticView(graph, false, "", new Set(), "workflows");
  assert(workflows.workflowCatalog);
  assert(workflows.workflowCatalog.visible <= 12);
  assert(workflows.nodes.some((node) => node.data.kind === "workflow"));
  assert(workflows.nodes.some((node) => node.data.kind === "component"));
  assert.equal(
    workflows.nodes.some((node) => node.data.kind === "workflow-step"),
    false,
  );
  assert.equal(
    workflows.nodes.some((node) => node.data.kind === "symbol"),
    false,
  );
  assert(
    workflows.nodes
      .filter((node) => node.data.kind === "workflow")
      .every((node) => Boolean(node.data.workflowSummary)),
  );
  assert(
    workflows.edges.every((edge) =>
      ["component", "workflow"].includes(String(edge.label)),
    ),
  );
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
  const types = buildSemanticView(graph, false, "", new Set(), "types");
  assert(types.nodes.every((node) => node.data.kind === "symbol"));
  assert(types.edges.length > 0);
  assert(
    types.edges.every((edge) =>
      ["extends", "implements", "overrides"].includes(String(edge.label)),
    ),
  );
  const data = buildSemanticView(graph, false, "", new Set(), "data");
  assert(data.nodes.every((node) => node.data.kind === "symbol"));
  assert(data.edges.some((edge) => edge.label === "reads"));
  assert(data.edges.some((edge) => edge.label === "writes"));
  const questions = buildSemanticView(graph, false, "", new Set(), "questions");
  assert(questions.nodes.some((node) => node.data.questions));
});

test("workflow catalog merges composed system and component aliases", async (t) => {
  const root = await fixture(t);
  const graph = await analyzeRepository(root);
  const semantic = graph.semantic!;
  const system = semantic.nodes.find((node) => node.kind === "system")!;
  const component = semantic.nodes.find(
    (node) =>
      node.kind === "component" &&
      semantic.relations.some(
        (relation) => relation.kind === "contains" && relation.from === node.id,
      ),
  )!;
  const containment = semantic.relations.find(
    (relation) =>
      relation.kind === "contains" && relation.from === component.id,
  )!;
  semantic.nodes.push(
    {
      ...system,
      id: "compose:system:workspace",
      trust: "inferred",
      confidence: 0.7,
    },
    {
      ...component,
      id: "compose:component:alias",
      trust: "inferred",
      confidence: 0.7,
    },
  );
  semantic.relations.push({
    ...containment,
    id: "compose:relation:component-file",
    from: "compose:component:alias",
    trust: "inferred",
    confidence: 0.7,
  });

  const catalog = buildSemanticView(graph, false, "", new Set(), "workflows", {
    catalogLimit: 200,
    includeSupport: true,
  });
  assert.equal(
    catalog.nodes.filter((node) => node.data.kind === "system").length,
    1,
  );
  const matchingComponents = catalog.nodes.filter(
    (node) =>
      node.data.kind === "component" && node.data.label === component.label,
  );
  assert.equal(matchingComponents.length, 1);
  assert.equal(matchingComponents[0]?.id, component.id);
});

test("production workflows remain visible while support-tree entry points are bounded", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-workflow-scope-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "docs", "examples"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "server.py"),
    "async def main():\n    return True\n",
  );
  for (let index = 0; index < 20; index++)
    await fs.writeFile(
      path.join(root, "docs", "examples", `sample_${index}.py`),
      "async def main():\n    return True\n",
    );
  const graph = await analyzeRepository(root);
  const workflows = graph.semantic!.nodes.filter(
    (node) => node.kind === "workflow",
  );
  assert.equal(
    workflows.filter((node) => node.path === "src/server.py").length,
    1,
  );
  assert.equal(
    workflows.filter((node) => node.path?.startsWith("docs/examples/")).length,
    12,
  );
  assert(
    graph.coverage?.limits.some((limit) => limit.code === "workflow-support"),
  );
  const productionCatalog = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "workflows",
  );
  assert.deepEqual(productionCatalog.workflowCatalog, {
    total: 13,
    production: 1,
    support: 12,
    eligible: 1,
    visible: 1,
    hidden: 0,
    supportHidden: 12,
  });
  assert.equal(
    productionCatalog.nodes.filter((node) => node.data.kind === "workflow")
      .length,
    1,
  );
  const expandedCatalog = buildSemanticView(
    graph,
    false,
    "",
    new Set(),
    "workflows",
    { includeSupport: true, catalogLimit: 100 },
  );
  assert.equal(expandedCatalog.workflowCatalog?.visible, 13);
  assert.equal(expandedCatalog.workflowCatalog?.supportHidden, 0);
  assert.equal(expandedCatalog.quality.status === "fail", false);
});
