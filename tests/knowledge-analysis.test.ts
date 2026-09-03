import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { validateKnowledgeGraph } from "../apps/desktop/src/shared/knowledge-ir";
import {
  analyzeGraphImpact,
  buildGraphIntelligenceIndex,
  createArchitectureBrief,
  queryArchitectureGraph,
} from "../apps/desktop/src/shared/graph-intelligence";

test("ADR, RFC, manifests, and configuration become validated architecture knowledge", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-knowledge-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.mkdir(path.join(root, ".witch"));
  await fs.mkdir(path.join(root, "docs", "adr"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "export function start() { return true }\n",
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "witch-fixture",
        scripts: { hidden: "PRIVATE_TOKEN=must-not-enter-knowledge" },
        dependencies: { react: "latest" },
        devDependencies: { tsx: "latest" },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(root, "Cargo.toml"),
    '[package]\nname = "witch-core"\n\n[dependencies]\ntokio = "1"\n',
  );
  await fs.writeFile(
    path.join(root, "pyproject.toml"),
    '[project]\nname = "witch-agents"\ndependencies = [\n  "openai>=1",\n  "pydantic>=2"\n]\n',
  );
  await fs.writeFile(
    path.join(root, "requirements-dev.txt"),
    "pytest>=8\n# ignored\n-r requirements.txt\n",
  );
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{"strict":true}}\n',
  );
  await fs.writeFile(
    path.join(root, ".witch", "federation.json"),
    JSON.stringify(
      {
        version: 1,
        repositoryKey: "witch-system",
        mappings: [
          { ecosystem: "npm", package: "react", provider: "witch-ui" },
        ],
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(root, "docs", "adr", "0001-local-queue.md"),
    [
      "# Use local queue",
      "",
      "Status: Accepted",
      "",
      "## Context",
      "Jobs need deterministic isolation.",
      "",
      "## Decision",
      "Keep the queue inside the desktop host.",
      "",
      "## Consequences",
      "Remote workers require an explicit bridge.",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "docs", "adr", "0002-durable-queue.md"),
    [
      "# Use durable queue",
      "",
      "Status: Proposed",
      "Supersedes: Use local queue",
      "",
      "## Decision",
      "Persist queued work before dispatch.",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const knowledge = graph.knowledge!;
  assert.equal(knowledge.validation.valid, true);
  assert.equal(knowledge.validation.decisionCount, 2);
  assert(
    knowledge.nodes.some(
      (node) =>
        node.kind === "decision" &&
        node.label === "Use local queue" &&
        node.rationale?.decision === "Keep the queue inside the desktop host.",
    ),
  );
  for (const dependency of [
    "react",
    "tsx",
    "tokio",
    "openai",
    "pydantic",
    "pytest",
  ])
    assert(
      knowledge.nodes.some(
        (node) => node.kind === "dependency" && node.label === dependency,
      ),
      `missing ${dependency}`,
    );
  assert(
    knowledge.relations.some((relation) => relation.kind === "supersedes"),
  );
  assert(
    knowledge.nodes.some(
      (node) =>
        node.kind === "federation-repository" &&
        node.repositoryKey === "witch-system" &&
        node.trust === "authored",
    ),
  );
  assert(
    knowledge.nodes.some(
      (node) =>
        node.kind === "federation-mapping" &&
        node.label === "react" &&
        node.providerRepositoryKey === "witch-ui" &&
        node.ecosystem === "npm",
    ),
  );
  assert(
    knowledge.relations.some(
      (relation) =>
        relation.kind === "configures" &&
        relation.trust === "inferred" &&
        relation.status === "provisional",
    ),
  );
  assert(!JSON.stringify(knowledge).includes("must-not-enter-knowledge"));
  assert(
    knowledge.nodes
      .filter(
        (node) => node.kind === "manifest" || node.kind === "configuration",
      )
      .every((node) => node.evidence.every((item) => !item.excerpt)),
  );

  const index = buildGraphIntelligenceIndex(graph);
  assert.equal(index.knowledgeRevision, knowledge.revision);
  assert(index.nodes.some((node) => node.origin === "knowledge"));
  const query = queryArchitectureGraph(graph, {
    query: "openai",
    depth: 2,
    tokenBudget: 1_000,
  });
  assert.equal(query.knowledgeRevision, knowledge.revision);
  assert(
    query.nodes.some(
      (node) => node.kind === "dependency" && node.label === "openai",
    ),
  );
  const brief = createArchitectureBrief(graph);
  assert.equal(brief.knowledge?.decisions, 2);
  assert((brief.knowledge?.packages || 0) >= 9);
  const impact = analyzeGraphImpact(graph, {
    changedPaths: ["docs/adr/0002-durable-queue.md"],
  });
  assert(
    impact.changed.some(
      (node) => node.kind === "decision" && node.label === "Use durable queue",
    ),
  );

  const tampered = structuredClone(knowledge);
  tampered.nodes[0].evidence[0].hash = "stale";
  const receipt = validateKnowledgeGraph(tampered, graph.nodes, graph.semantic);
  assert.equal(receipt.valid, false);
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "KNOWLEDGE_EVIDENCE_HASH_MISMATCH",
    ),
  );

  const forged = structuredClone(knowledge);
  (forged.nodes[0] as { kind: string }).kind = "oracle";
  forged.relations[0].provenance.ruleId = "";
  const forgedReceipt = validateKnowledgeGraph(
    forged,
    graph.nodes,
    graph.semantic,
  );
  assert.equal(forgedReceipt.valid, false);
  assert(
    forgedReceipt.diagnostics.some(
      (item) => item.code === "KNOWLEDGE_NODE_KIND_INVALID",
    ),
  );
  assert(
    forgedReceipt.diagnostics.some(
      (item) => item.code === "KNOWLEDGE_PROVENANCE_INVALID",
    ),
  );
});
