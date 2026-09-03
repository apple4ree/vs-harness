import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { findCliExecutable } from "../apps/desktop/src/main/services/cli-discovery";
import { SemanticComposerService } from "../apps/desktop/src/main/services/semantic-composer";
import { buildView } from "../apps/desktop/src/renderer/src/components/architecture-view";
import type { SemanticComposerProviderId } from "../apps/desktop/src/shared/semantic-composer";

type ComposerCase = {
  id: string;
  language: "python" | "rust" | "typescript";
  root: string;
  minimum: {
    components: number;
    relations: number;
    workflows: number;
    evidenceCoverage: number;
  };
};

export type ComposerBenchmarkSuite = {
  contract: "witch.semantic-composer-benchmark/v1";
  policy: {
    freezeFirstCandidate: true;
    fallbackAllowed: false;
    executeRepositoryCode: false;
    aggregateProviders: false;
    humanReview: "pending-until-named-reviewer";
  };
  cases: ComposerCase[];
};

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function validateComposerBenchmarkSuite(
  input: unknown,
): asserts input is ComposerBenchmarkSuite {
  assert(input && typeof input === "object", "suite must be an object");
  const suite = input as ComposerBenchmarkSuite;
  assert.equal(suite.contract, "witch.semantic-composer-benchmark/v1");
  assert.equal(suite.policy.freezeFirstCandidate, true);
  assert.equal(suite.policy.fallbackAllowed, false);
  assert.equal(suite.policy.executeRepositoryCode, false);
  assert.equal(suite.policy.aggregateProviders, false);
  assert.equal(suite.policy.humanReview, "pending-until-named-reviewer");
  assert(suite.cases.length >= 3, "at least three language cases are required");
  assert.equal(new Set(suite.cases.map((item) => item.id)).size, suite.cases.length);
  assert.deepEqual(
    [...new Set(suite.cases.map((item) => item.language))].sort(),
    ["python", "rust", "typescript"],
  );
  for (const item of suite.cases) {
    assert(/^[a-z0-9-]+$/.test(item.id));
    assert(!path.isAbsolute(item.root) && !item.root.includes(".."));
    assert(item.minimum.components > 0);
    assert(item.minimum.relations >= 0);
    assert(item.minimum.workflows >= 0);
    assert(item.minimum.evidenceCoverage >= 0 && item.minimum.evidenceCoverage <= 1);
  }
}

async function runCase(
  suiteRoot: string,
  item: ComposerCase,
  provider: "rules" | "codex" | "claude",
  output: string,
) {
  const root = await fs.realpath(path.join(suiteRoot, item.root));
  const started = performance.now();
  const source = await analyzeRepository(root, { cache: new Map() });
  const analyzedMs = Math.round(performance.now() - started);
  const composer = new SemanticComposerService({
    codexCommand: () =>
      findCliExecutable("codex", process.env.WITCH_CODEX_PATH),
    claudeCommand: () =>
      findCliExecutable("claude", process.env.WITCH_CLAUDE_PATH),
    readApiKey: async () => null,
  });
  const composeStarted = performance.now();
  const result = await composer.compose(source, {
    provider: provider as SemanticComposerProviderId,
    focus: "architecture",
    maxComponents: 12,
    fallbackToRules: false,
  });
  const composedMs = Math.round(performance.now() - composeStarted);
  const composedNodes =
    result.graph.semantic?.nodes.filter(
      (node) => node.provenance.analyzer === "witch-semantic-composer/v1",
    ) || [];
  const composedRelations =
    result.graph.semantic?.relations.filter(
      (relation) => relation.provenance.analyzer === "witch-semantic-composer/v1",
    ) || [];
  const grounded = [...composedNodes, ...composedRelations];
  const evidenceCoverage = grounded.length
    ? grounded.filter((item) => item.evidence.length > 0).length / grounded.length
    : 0;
  const projection = buildView(
    result.graph,
    "semantics",
    null,
    false,
    "",
    new Set(),
    null,
    "overview",
  );
  const checks = {
    sourceReceipt: source.validation.valid,
    semanticReceipt: result.graph.semantic?.validation.valid === true,
    compositionReceipt: result.receipt.valid,
    noFallback: result.receipt.fallback === false,
    componentMinimum: result.receipt.componentCount >= item.minimum.components,
    relationMinimum: result.receipt.relationCount >= item.minimum.relations,
    workflowMinimum: result.receipt.workflowCount >= item.minimum.workflows,
    evidenceCoverage:
      evidenceCoverage + Number.EPSILON >= item.minimum.evidenceCoverage,
    projection: projection.quality.status !== "fail",
  };
  const candidate = {
    contract: "witch.semantic-composer-first-candidate/v1",
    caseId: item.id,
    language: item.language,
    provider,
    model: result.receipt.model,
    frozenAt: new Date().toISOString(),
    sourceRevision: source.revision,
    semanticRevision: result.graph.semantic?.revision || null,
    compositionRevision: result.receipt.revision,
    timings: { analyzedMs, composedMs },
    metrics: {
      components: result.receipt.componentCount,
      relations: result.receipt.relationCount,
      workflows: result.receipt.workflowCount,
      questions: result.receipt.questionCount,
      rejected: result.receipt.rejectedCount,
      evidenceCoverage: Number(evidenceCoverage.toFixed(4)),
      projectionNodes: projection.nodes.length,
      projectionEdges: projection.edges.length,
      layoutViolations:
        projection.quality.errors + projection.quality.warnings,
    },
    checks,
    machineValid: Object.values(checks).every(Boolean),
    humanVisualReview: "pending",
    graph: result.graph,
    compositionReceipt: result.receipt,
    projectionReceipt: projection.quality,
  };
  await fs.writeFile(
    path.join(output, `${item.id}-${provider}.json`),
    JSON.stringify(candidate, null, 2),
  );
  return candidate;
}

async function main() {
  const suiteFile = path.resolve(
    argument("--suite") || "benchmarks/semantic-composer/suite-v1.json",
  );
  const suiteRoot = path.dirname(suiteFile);
  const parsed: unknown = JSON.parse(await fs.readFile(suiteFile, "utf8"));
  validateComposerBenchmarkSuite(parsed);
  const provider = (argument("--provider") || "rules") as
    | "rules"
    | "codex"
    | "claude";
  if (!["rules", "codex", "claude"].includes(provider))
    throw new Error("--provider must be rules, codex, or claude");
  const selectedCase = argument("--case");
  const cases = selectedCase
    ? parsed.cases.filter((item) => item.id === selectedCase)
    : parsed.cases;
  if (!cases.length) throw new Error(`Unknown benchmark case: ${selectedCase}`);
  const output = path.resolve(
    argument("--output") || "test-results/semantic-composer",
  );
  await fs.mkdir(output, { recursive: true });
  const candidates = [];
  for (const item of cases) {
    process.stdout.write(`[${item.id}] ${provider} first candidate\n`);
    const candidate = await runCase(suiteRoot, item, provider, output);
    candidates.push(candidate);
    process.stdout.write(
      `  ${candidate.machineValid ? "pass" : "fail"} · ${JSON.stringify(candidate.metrics)}\n`,
    );
  }
  const run = {
    contract: "witch.semantic-composer-benchmark-run/v1",
    generatedAt: new Date().toISOString(),
    suite: path.basename(suiteFile),
    provider,
    candidateFiles: cases.map((item) => `${item.id}-${provider}.json`),
    machineValid: candidates.every((candidate) => candidate.machineValid),
    humanVisualReview: "pending",
  };
  await fs.writeFile(
    path.join(output, `run-${provider}.json`),
    JSON.stringify(run, null, 2),
  );
  if (!run.machineValid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
