import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  ArchitectureNode,
  SourceEvidence,
} from "../apps/desktop/src/shared/architecture";
import { finalizeArchitectureGraph } from "../apps/desktop/src/shared/architecture-ir";
import { finalizeSemanticGraph } from "../apps/desktop/src/shared/semantic-ir";
import type {
  SemanticNode,
  SemanticRelation,
} from "../apps/desktop/src/shared/semantic";
import {
  analyzeGraphImpact,
  buildGraphIntelligenceIndex,
  createArchitectureBrief,
  projectGraphCommunities,
  queryArchitectureGraph,
} from "../apps/desktop/src/shared/graph-intelligence";
import {
  buildArchitectureMetaGraph,
  projectArchitectureMetaFrame,
  validateArchitectureMetaGraph,
} from "../apps/desktop/src/shared/graph-meta";
import {
  createAgentExperienceOverlay,
  evaluateAgentExperience,
  resolveChangedGraphNodes,
  type AgentExperienceRecord,
} from "../apps/desktop/src/shared/agent-graph-tools";

const fixtureHash = (value: string) =>
  ({
    "order-hash": "a".repeat(64),
    "broker-hash": "b".repeat(64),
    "risk-hash": "c".repeat(64),
    "test-hash": "d".repeat(64),
  })[value] || value;

const source = (path: string, hash: string): ArchitectureNode => ({
  id: path,
  label: path.split("/").at(-1)!,
  kind: "file",
  path,
  module: path.split("/")[0],
  language: path.endsWith(".py") ? "python" : "typescript",
  count: 1,
  hash: fixtureHash(hash),
  symbols: [],
  evidence: [{ path, line: 1, hash: fixtureHash(hash) }],
});

const evidence = (path: string, hash: string, line = 1): SourceEvidence[] => [
  { path, line, hash: fixtureHash(hash) },
];

function node(
  id: string,
  label: string,
  kind: SemanticNode["kind"],
  path: string,
  hash: string,
  trust: SemanticNode["trust"] = "verified",
  status: SemanticNode["status"] = trust === "verified"
    ? "accepted"
    : "provisional",
  line = 1,
): SemanticNode {
  return {
    id,
    label,
    kind,
    trust,
    status,
    confidence: trust === "verified" ? 1 : 0.78,
    path,
    sourceNodeId: path,
    description: `${label} architecture responsibility`,
    evidence: evidence(path, hash, line),
    provenance: {
      source: trust === "verified" ? "static-analysis" : "heuristic",
      analyzer: "fixture",
      policy: "fixture-v1",
    },
  };
}

function relation(
  id: string,
  from: string,
  to: string,
  kind: SemanticRelation["kind"],
  path: string,
  hash: string,
  trust: SemanticRelation["trust"] = "verified",
  status: SemanticRelation["status"] = trust === "verified"
    ? "accepted"
    : "provisional",
): SemanticRelation {
  return {
    id,
    from,
    to,
    kind,
    trust,
    status,
    confidence: trust === "verified" ? 1 : 0.72,
    evidence: evidence(path, hash),
    provenance: {
      source: trust === "verified" ? "static-analysis" : "heuristic",
      analyzer: "fixture",
      policy: "fixture-v1",
    },
  };
}

function fixture() {
  const sources = [
    source("src/order.py", "order-hash"),
    source("src/broker.py", "broker-hash"),
    source("src/risk.py", "risk-hash"),
    source("tests/test_order.py", "test-hash"),
  ];
  const semantic = finalizeSemanticGraph(
    {
      schemaVersion: 1,
      contract: "witch.semantic/v1",
      analyzerVersion: "fixture",
      policyVersion: "fixture-v1",
      workspaceRoot: "/fixture",
      sourceRevision: "source-revision",
      revision: "semantic-revision",
      generatedAt: "2026-09-03T00:00:00.000Z",
      nodes: [
        node(
          "component:execution",
          "Execution",
          "component",
          "src/order.py",
          "order-hash",
        ),
        node("component:risk", "Risk", "component", "src/risk.py", "risk-hash"),
        node(
          "workflow:order",
          "Order workflow",
          "workflow",
          "src/order.py",
          "order-hash",
        ),
        node(
          "symbol:validate",
          "validate limit",
          "symbol",
          "src/risk.py",
          "risk-hash",
        ),
        node(
          "symbol:submit:order",
          "submit",
          "symbol",
          "src/order.py",
          "order-hash",
          "verified",
          "accepted",
          20,
        ),
        node(
          "symbol:submit:broker",
          "submit",
          "symbol",
          "src/broker.py",
          "broker-hash",
        ),
        node(
          "symbol:test-order",
          "test order retry",
          "symbol",
          "tests/test_order.py",
          "test-hash",
        ),
      ],
      relations: [
        relation(
          "contains:execution:workflow",
          "component:execution",
          "workflow:order",
          "contains",
          "src/order.py",
          "order-hash",
        ),
        relation(
          "contains:workflow:submit",
          "workflow:order",
          "symbol:submit:order",
          "contains",
          "src/order.py",
          "order-hash",
        ),
        relation(
          "contains:risk:validate",
          "component:risk",
          "symbol:validate",
          "contains",
          "src/risk.py",
          "risk-hash",
        ),
        relation(
          "precedes:validate:submit",
          "symbol:validate",
          "symbol:submit:order",
          "precedes",
          "src/order.py",
          "order-hash",
        ),
        relation(
          "calls:order:broker",
          "symbol:submit:order",
          "symbol:submit:broker",
          "calls",
          "src/order.py",
          "order-hash",
        ),
        relation(
          "retries:order:broker",
          "symbol:submit:order",
          "symbol:submit:broker",
          "retries",
          "src/order.py",
          "order-hash",
        ),
        relation(
          "calls:broker:order",
          "symbol:submit:broker",
          "symbol:submit:order",
          "calls",
          "src/broker.py",
          "broker-hash",
          "inferred",
          "conflicting",
        ),
        relation(
          "calls:test:broker",
          "symbol:test-order",
          "symbol:submit:broker",
          "calls",
          "tests/test_order.py",
          "test-hash",
        ),
      ],
      claims: [],
      questions: [],
      revisions: [
        {
          id: "semantic-revision",
          sourceRevision: "source-revision",
          createdAt: "2026-09-03T00:00:00.000Z",
          policyVersion: "fixture-v1",
          approval: "provisional-inference",
          changedIds: [],
          summary: {
            nodesAdded: 7,
            nodesChanged: 0,
            nodesRemoved: 0,
            relationsAdded: 8,
            relationsChanged: 0,
            relationsRemoved: 0,
            claimsAdded: 0,
            claimsChanged: 0,
            claimsRemoved: 0,
            questionsOpened: 0,
          },
        },
      ],
    },
    sources,
  );
  return finalizeArchitectureGraph({
    schemaVersion: 1,
    diagramKind: "architecture",
    analyzerVersion: "fixture",
    workspaceRoot: "/fixture",
    revision: "source-revision",
    generatedAt: "2026-09-03T00:00:00.000Z",
    nodes: sources,
    edges: [
      {
        id: "src/order.py:imports:src/broker.py",
        from: "src/order.py",
        to: "src/broker.py",
        kind: "imports",
        count: 1,
        evidence: evidence("src/order.py", "order-hash"),
      },
    ],
    scannedFiles: 4,
    totalFiles: 4,
    truncated: false,
    warnings: [],
    semantic,
  });
}

test("intelligence index preserves typed direction and parallel relations", () => {
  const index = buildGraphIntelligenceIndex(fixture());
  assert.equal(index.sourceRevision, "source-revision");
  assert.equal(index.semanticRevision, "semantic-revision");
  assert.deepEqual(
    index.relations
      .filter(
        (item) =>
          item.from === "symbol:submit:order" &&
          item.to === "symbol:submit:broker",
      )
      .map((item) => item.kind),
    ["calls", "retries"],
  );
  assert(
    index.relations.some(
      (item) =>
        item.kind === "evidenced-by" &&
        item.from === "symbol:submit:broker" &&
        item.to === "src/broker.py",
    ),
  );
});

test("query returns bounded evidence and refuses to hide exact ambiguity", () => {
  const result = queryArchitectureGraph(fixture(), {
    query: "submit",
    depth: 2,
    tokenBudget: 512,
  });
  assert.equal(result.contract, "witch.graph-query/v1");
  assert.deepEqual(result.ambiguities[0].candidateIds, [
    "symbol:submit:broker",
    "symbol:submit:order",
  ]);
  assert(result.seeds.some((item) => item.id === "symbol:submit:broker"));
  assert(result.nodes.every((item) => item.depth <= 2));
  assert(result.relations.every((item) => item.from && item.to));
  assert(result.estimatedTokens <= result.tokenBudget);
});

test("query retains explicit Agent seeds even when prompt terms do not match", () => {
  const result = queryArchitectureGraph(fixture(), {
    query: "unrelated maintenance request",
    seedNodeIds: ["component:risk", "missing:selection"],
    depth: 1,
    tokenBudget: 512,
  });
  assert.equal(result.seeds[0]?.id, "component:risk");
  assert.deepEqual(result.seeds[0]?.reasons, ["explicit seed"]);
  assert(result.nodes.some((item) => item.id === "symbol:validate"));
  assert(result.notices.some((notice) => /explicit seed node/.test(notice)));
});

test("Agent diff resolution selects the nearest owning symbol instead of every file symbol", () => {
  const before = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
  const after = [...before];
  after[23] = "changed implementation";
  const result = resolveChangedGraphNodes(fixture(), [
    {
      path: "src/order.py",
      before: before.join("\n"),
      after: after.join("\n"),
    },
  ]);
  assert(result.nodeIds.includes("src/order.py"));
  assert(result.nodeIds.includes("symbol:submit:order"));
  assert(!result.nodeIds.includes("workflow:order"));
  assert.deepEqual(result.lineRanges, [
    { path: "src/order.py", start: 24, end: 24 },
  ]);
});

test("Experience overlay includes only source-hash-fresh records", () => {
  const record = (
    id: string,
    expectedSourceHash: string | null,
  ): AgentExperienceRecord => ({
    contract: "witch.agent-experience/v1",
    id,
    runId: "run-1",
    outcome: "useful",
    sourceRevision: "older-unrelated-revision",
    subjectNodeIds: ["src/order.py"],
    evidence: [{ path: "src/order.py", expectedSourceHash }],
    reason: "The reviewed change was applied.",
    createdAt: "2026-09-03T01:00:00.000Z",
  });
  const fresh = record("fresh", "a".repeat(64));
  const stale = record("stale", "e".repeat(64));
  const unknown = { ...record("unknown", null), evidence: [] };
  assert.equal(evaluateAgentExperience(fixture(), fresh).freshness, "fresh");
  assert.deepEqual(evaluateAgentExperience(fixture(), stale).mismatchedPaths, [
    "src/order.py",
  ]);
  const overlay = createAgentExperienceOverlay(fixture(), [
    fresh,
    stale,
    unknown,
  ]);
  assert.deepEqual(
    overlay.included.map((item) => item.id),
    ["fresh"],
  );
  assert.deepEqual(overlay.staleRecordIds, ["stale"]);
  assert.deepEqual(overlay.unknownRecordIds, ["unknown"]);
});

test("community projection is deterministic when input order changes", () => {
  const graph = fixture();
  const reversed = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
    semantic: graph.semantic
      ? {
          ...graph.semantic,
          nodes: [...graph.semantic.nodes].reverse(),
          relations: [...graph.semantic.relations].reverse(),
        }
      : undefined,
  };
  const first = projectGraphCommunities(graph);
  const second = projectGraphCommunities(reversed);
  assert.deepEqual(first.communities, second.communities);
  assert(first.communities.length >= 2);
  assert(first.communities.every((item) => item.trust === "derived"));
});

test("multi-resolution meta graph drills from communities to source symbols", () => {
  const graph = fixture();
  const meta = buildArchitectureMetaGraph(graph);
  assert.equal(meta.contract, "witch.graph-meta/v1");
  assert.equal(meta.validation.valid, true);
  assert.deepEqual(meta.levels, [
    "system",
    "community",
    "component",
    "workflow",
    "symbol",
  ]);

  const workflow = meta.nodes.find(
    (node) => node.sourceNodeId === "workflow:order",
  )!;
  const execution = meta.nodes.find(
    (node) => node.sourceNodeId === "component:execution",
  )!;
  const submit = meta.nodes.find(
    (node) => node.sourceNodeId === "symbol:submit:order",
  )!;
  assert.equal(workflow.parentId, execution.id);
  assert.equal(workflow.assignment, "explicit-containment");
  assert.equal(submit.parentId, workflow.id);
  assert.equal(submit.assignment, "explicit-containment");

  const symbolEdge = meta.edges.find(
    (edge) =>
      edge.level === "symbol" &&
      edge.from === submit.id &&
      edge.relationKinds.includes("calls") &&
      edge.relationKinds.includes("retries"),
  )!;
  assert.equal(symbolEdge.relationCount, 2);
  assert.equal(symbolEdge.evidence.length > 0, true);

  const rootFrame = projectArchitectureMetaFrame(meta);
  assert.equal(rootFrame.focus.level, "system");
  assert.equal(rootFrame.nextLevel, "community");
  const componentFrame = projectArchitectureMetaFrame(meta, execution.parentId);
  assert(componentFrame.nodes.some((node) => node.id === execution.id));
  const workflowFrame = projectArchitectureMetaFrame(meta, execution.id);
  assert(workflowFrame.nodes.some((node) => node.id === workflow.id));

  const reversed = {
    ...graph,
    nodes: [...graph.nodes].reverse(),
    edges: [...graph.edges].reverse(),
    semantic: graph.semantic
      ? {
          ...graph.semantic,
          nodes: [...graph.semantic.nodes].reverse(),
          relations: [...graph.semantic.relations].reverse(),
        }
      : undefined,
  };
  const repeated = buildArchitectureMetaGraph(reversed);
  assert.equal(repeated.revision, meta.revision);
  assert.deepEqual(repeated.nodes, meta.nodes);
  assert.deepEqual(repeated.edges, meta.edges);
  assert.throws(
    () =>
      buildArchitectureMetaGraph(graph, {
        ...projectGraphCommunities(graph),
        sourceRevision: "stale-source",
      }),
    /same graph revisions/,
  );

  const tampered = structuredClone(meta);
  tampered.edges[0].evidence[0].hash = "stale";
  const receipt = validateArchitectureMetaGraph(tampered, graph);
  assert.equal(receipt.valid, false);
  assert(
    receipt.diagnostics.some((item) => item.code === "META_EVIDENCE_STALE"),
  );
  assert(
    receipt.diagnostics.some((item) => item.code === "META_REVISION_MISMATCH"),
  );
});

test("impact analysis follows typed reverse and workflow propagation paths", () => {
  const result = analyzeGraphImpact(fixture(), {
    changedNodeIds: ["symbol:submit:broker"],
    maxDepth: 4,
  });
  assert.equal(result.contract, "witch.graph-impact/v1");
  assert(result.affected.some((item) => item.id === "symbol:submit:order"));
  assert(result.workflows.some((item) => item.id === "workflow:order"));
  assert(result.components.some((item) => item.id === "component:execution"));
  assert.deepEqual(result.suggestedTestPaths, ["tests/test_order.py"]);
  assert(
    result.affected.every((item) => item.relationPath.length === item.depth),
  );
});

test("architecture brief reports communities, cycles, hubs and conflicts", () => {
  const result = createArchitectureBrief(fixture());
  assert.equal(result.contract, "witch.architecture-brief/v1");
  assert.equal(result.summary.files, 4);
  assert(result.communities.length >= 2);
  assert(
    result.cycles.some((cycle) =>
      cycle.nodeIds.includes("symbol:submit:broker"),
    ),
  );
  assert(result.hubs.length > 0);
  assert(
    result.questions.some((question) =>
      question.id.includes("calls:broker:order"),
    ),
  );
});
