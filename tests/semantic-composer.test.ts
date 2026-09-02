import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { SemanticComposerService } from "../apps/desktop/src/main/services/semantic-composer";

async function fixture(t: test.TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-composer-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src/api"), { recursive: true });
  await fs.mkdir(path.join(root, "src/agent"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src/api/client.ts"),
    "export function requestModel() { return 'ok' }\n",
  );
  await fs.writeFile(
    path.join(root, "src/agent/run.ts"),
    'import { requestModel } from "../api/client";\nexport function runAgent() { return requestModel() }\n',
  );
  return { root, graph: await analyzeRepository(root) };
}

function service(
  complete?: ConstructorParameters<
    typeof SemanticComposerService
  >[0]["complete"],
) {
  return new SemanticComposerService({
    codexCommand: () => "fake-codex",
    claudeCommand: () => "fake-claude",
    readApiKey: async () => "fixture-key",
    ...(complete ? { complete } : {}),
  });
}

const aiDraft = {
  title: "Agent service",
  summary: "Agent runtime calls the model API.",
  components: [
    {
      id: "agent-runtime",
      label: "Agent Runtime",
      kind: "component" as const,
      responsibility: "Runs the agent workflow.",
      candidateIds: ["candidate:module:src/agent"],
      confidence: 0.9,
    },
    {
      id: "model-api",
      label: "Model API",
      kind: "component" as const,
      responsibility: "Wraps model requests.",
      candidateIds: ["candidate:module:src/api"],
      confidence: 0.86,
    },
  ],
  relations: [
    {
      from: "agent-runtime",
      to: "model-api",
      kind: "calls" as const,
      label: "requests inference",
      candidateRelationIds: [
        "candidate:relation:candidate:module:src/agent->candidate:module:src/api",
      ],
      confidence: 0.88,
    },
  ],
  workflows: [],
  questions: [],
};

test("rules composer adds provisional, evidence-backed system components", async (t) => {
  const { graph } = await fixture(t);
  const result = await service().compose(graph, {
    provider: "rules",
    maxComponents: 8,
  });
  assert.equal(result.receipt.valid, true);
  assert.equal(result.receipt.provider, "rules");
  assert.equal(result.receipt.autoApproved, true);
  assert.ok(result.receipt.componentCount >= 2);
  const composed = result.graph.semantic!.nodes.filter((node) =>
    node.provenance.analyzer.startsWith("witch-semantic-composer"),
  );
  assert.ok(composed.some((node) => node.kind === "system"));
  assert.ok(composed.some((node) => node.kind === "component"));
  assert.ok(composed.every((node) => node.trust === "inferred"));
  assert.ok(composed.every((node) => node.status === "provisional"));
  assert.equal(result.graph.composition?.revision, result.receipt.revision);
});

test("AI composer accepts only relations cited by the source candidate packet", async (t) => {
  const { graph } = await fixture(t);
  const result = await service(async () => aiDraft).compose(graph, {
    provider: "codex",
    fallbackToRules: false,
  });
  assert.equal(result.receipt.fallback, false);
  assert.equal(result.receipt.rejectedCount, 0);
  assert.equal(result.receipt.relationCount, 1);
  assert.ok(
    result.graph.semantic!.relations.some(
      (relation) =>
        relation.kind === "calls" &&
        relation.description === "requests inference",
    ),
  );
});

test("AI and authored responsibility conflicts remain open for GrillMe review", async (t) => {
  const { graph } = await fixture(t);
  const subject = graph.semantic!.nodes.find(
    (node) =>
      ["component", "package", "module", "file"].includes(node.kind) &&
      node.path?.includes("src/agent"),
  );
  assert.ok(subject, "fixture should expose an agent semantic candidate");
  graph.semantic!.claims.push({
    id: "authored:agent-responsibility",
    subjectId: subject.id,
    key: "responsibility",
    value: "Human-authored execution boundary.",
    trust: "authored",
    status: "accepted",
    confidence: 1,
    reason: "Authored by the workspace owner.",
    evidence: subject.evidence,
    provenance: {
      source: "authored",
      analyzer: "witch-authored-semantics",
      policy: "authored/v1",
    },
  });
  const draft = {
    ...aiDraft,
    components: [
      {
        id: "agent-runtime",
        label: "Agent Runtime",
        kind: "component" as const,
        responsibility: "AI-inferred orchestration boundary.",
        candidateIds: [`candidate:semantic:${subject.id}`],
        confidence: 0.9,
      },
    ],
    relations: [],
  };
  const result = await service(async () => draft).compose(graph, {
    provider: "codex",
    fallbackToRules: false,
  });
  const question = result.graph.semantic!.questions.find((item) =>
    item.id.startsWith("compose:question:agent-runtime:authored-"),
  );
  assert.ok(question);
  assert.equal(question.status, "open");
  assert.deepEqual(question.options, [
    "AI-inferred orchestration boundary.",
    "Human-authored execution boundary.",
  ]);
  assert.equal(result.receipt.questionCount, 1);
  assert.ok(
    question.claimIds.every(
      (claimId) =>
        result.graph.semantic!.claims.find((claim) => claim.id === claimId)
          ?.status === "conflicting",
    ),
  );
});

test("provider failures fall back visibly without losing the requested provider audit", async (t) => {
  const { graph } = await fixture(t);
  const result = await service(async () => {
    throw new Error("provider unavailable");
  }).compose(graph, { provider: "claude" });
  assert.equal(result.receipt.provider, "claude");
  assert.equal(result.receipt.fallback, true);
  assert.ok(
    result.receipt.diagnostics.some(
      (item) => item.code === "COMPOSITION_PROVIDER_FALLBACK",
    ),
  );
  assert.ok(result.receipt.componentCount >= 2);
});

test("OpenAI adapter uses Responses structured outputs without storing the response", async (t) => {
  const { graph } = await fixture(t);
  let request: { url: string; init: RequestInit } | null = null;
  const composer = new SemanticComposerService({
    codexCommand: () => null,
    claudeCommand: () => null,
    readApiKey: async () => "openai-fixture-secret",
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init: init || {} };
      return new Response(
        JSON.stringify({ output_text: JSON.stringify(aiDraft) }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch,
  });
  const result = await composer.compose(graph, {
    provider: "openai",
    model: "gpt-fixture",
    fallbackToRules: false,
  });
  assert.equal(result.receipt.fallback, false);
  assert.equal(request!.url, "https://api.openai.com/v1/responses");
  const body = JSON.parse(String(request!.init.body));
  assert.equal(body.model, "gpt-fixture");
  assert.equal(body.store, false);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.text.format.strict, true);
  assert.equal(
    (request!.init.headers as Record<string, string>).Authorization,
    "Bearer openai-fixture-secret",
  );
});

test("Anthropic adapter uses Messages output_config structured JSON", async (t) => {
  const { graph } = await fixture(t);
  let request: { url: string; init: RequestInit } | null = null;
  const composer = new SemanticComposerService({
    codexCommand: () => null,
    claudeCommand: () => null,
    readApiKey: async () => "anthropic-fixture-secret",
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      request = { url: String(url), init: init || {} };
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(aiDraft) }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch,
  });
  const result = await composer.compose(graph, {
    provider: "anthropic",
    model: "claude-fixture",
    fallbackToRules: false,
  });
  assert.equal(result.receipt.fallback, false);
  assert.equal(request!.url, "https://api.anthropic.com/v1/messages");
  const body = JSON.parse(String(request!.init.body));
  assert.equal(body.model, "claude-fixture");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.equal(
    (request!.init.headers as Record<string, string>)["x-api-key"],
    "anthropic-fixture-secret",
  );
});
