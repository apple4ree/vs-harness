import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import {
  buildArchitectureFederation,
  type FederationApproval,
  type FederationInput,
  type FederationLink,
} from "../apps/desktop/src/shared/federation";

type RepositoryCase = {
  id: string;
  root: string;
  role: "active" | "snapshot";
};

type ExpectedLink = {
  from: string;
  to: string;
  ecosystem: FederationLink["ecosystem"];
  packageName: string;
  status: FederationLink["status"];
  trust: FederationLink["trust"];
  resolutionSource?: FederationLink["resolutionSource"];
};

type FederationCase = {
  id: string;
  ecosystem: FederationLink["ecosystem"];
  repositories: RepositoryCase[];
  expectedLinks: ExpectedLink[];
  expectedQuestionKinds: Array<"ambiguous-provider" | "authored-mismatch">;
  approvalTarget?: string;
};

export type FederationBenchmarkSuite = {
  contract: "witch.federation-benchmark/v1";
  policy: {
    executeRepositoryCode: false;
    exactGroundTruthOnly: true;
    separateMetrics: true;
    approvalTimestamp: string;
  };
  cases: FederationCase[];
};

type CaseResult = {
  id: string;
  ecosystem: FederationLink["ecosystem"];
  expectedLinks: number;
  actualLinks: number;
  truePositiveLinks: number;
  falsePositiveLinks: number;
  falseNegativeLinks: number;
  questionsExpected: number;
  questionsFound: number;
  validationPassed: boolean;
  orderInvariant: boolean;
  exactResult: boolean;
  authoredResolution?: boolean;
  approvalResolution?: boolean;
  staleApprovalRejected?: boolean;
};

export type FederationBenchmarkReport = {
  contract: "witch.federation-benchmark-run/v1";
  algorithm: "exact-package-identity-v1";
  suite: string;
  suiteSha256: string;
  environment: {
    node: string;
    platform: NodeJS.Platform;
    architecture: string;
  };
  policy: FederationBenchmarkSuite["policy"];
  metrics: {
    linkPrecision: number;
    linkRecall: number;
    exactCaseRate: number;
    questionCaseRecall: number;
    validationRate: number;
    orderInvarianceRate: number;
    authoredResolutionRate: number | null;
    approvalResolutionRate: number | null;
    staleApprovalRejectionRate: number | null;
  };
  cases: CaseResult[];
  machineValid: boolean;
};

function boundedRoot(suiteRoot: string, relative: string) {
  assert(!path.isAbsolute(relative), "fixture roots must be relative");
  const resolved = path.resolve(suiteRoot, relative);
  const relation = path.relative(suiteRoot, resolved);
  assert(
    relation && !relation.startsWith("..") && !path.isAbsolute(relation),
    "fixture root escapes the federation benchmark",
  );
  return resolved;
}

export function validateFederationBenchmarkSuite(
  value: unknown,
): asserts value is FederationBenchmarkSuite {
  assert(value && typeof value === "object", "suite must be an object");
  const suite = value as FederationBenchmarkSuite;
  assert.equal(suite.contract, "witch.federation-benchmark/v1");
  assert.equal(suite.policy.executeRepositoryCode, false);
  assert.equal(suite.policy.exactGroundTruthOnly, true);
  assert.equal(suite.policy.separateMetrics, true);
  assert(Number.isFinite(Date.parse(suite.policy.approvalTimestamp)));
  assert(suite.cases.length >= 6, "at least six federation cases are required");
  assert.equal(
    new Set(suite.cases.map((item) => item.id)).size,
    suite.cases.length,
  );
  assert.deepEqual(
    [...new Set(suite.cases.map((item) => item.ecosystem))].sort(),
    ["cargo", "npm", "python"],
  );
  for (const item of suite.cases) {
    assert(/^[a-z0-9-]+$/.test(item.id), item.id + " is not a stable id");
    assert.equal(
      item.repositories.filter((repository) => repository.role === "active")
        .length,
      1,
      item.id + " must have one active repository",
    );
    assert(item.repositories.length >= 2 && item.repositories.length <= 12);
    assert.equal(
      new Set(item.repositories.map((repository) => repository.id)).size,
      item.repositories.length,
      item.id + " repository ids must be unique",
    );
    const ids = new Set(item.repositories.map((repository) => repository.id));
    for (const repository of item.repositories) {
      assert(/^[a-z0-9-]+$/.test(repository.id));
      assert(
        !path.isAbsolute(repository.root) && !repository.root.includes(".."),
      );
    }
    for (const link of item.expectedLinks) {
      assert(ids.has(link.from) && ids.has(link.to) && link.from !== link.to);
      assert.equal(link.ecosystem, item.ecosystem);
      assert(link.packageName);
    }
    if (item.approvalTarget) {
      assert(ids.has(item.approvalTarget));
      assert(item.expectedQuestionKinds.includes("ambiguous-provider"));
    }
  }
}

function linkKey(link: ExpectedLink) {
  return [
    link.from,
    link.to,
    link.ecosystem,
    link.packageName,
    link.status,
    link.trust,
    link.resolutionSource || "",
  ].join("\0");
}

function ratio(numerator: number, denominator: number) {
  return denominator ? Number((numerator / denominator).toFixed(4)) : 1;
}

export async function runFederationBenchmark(
  suiteFile = path.resolve("benchmarks/federation/suite-v1.json"),
): Promise<FederationBenchmarkReport> {
  suiteFile = path.resolve(suiteFile);
  const suiteSource = await fs.readFile(suiteFile, "utf8");
  const parsed: unknown = JSON.parse(suiteSource);
  validateFederationBenchmarkSuite(parsed);
  const suiteRoot = path.dirname(suiteFile);
  const cases: CaseResult[] = [];

  for (const [caseIndex, item] of parsed.cases.entries()) {
    const roots = new Map<string, string>();
    const inputs: FederationInput[] = [];
    for (const repository of item.repositories) {
      const root = await fs.realpath(boundedRoot(suiteRoot, repository.root));
      roots.set(repository.id, root);
      inputs.push({
        graph: await analyzeRepository(root, { cache: new Map() }),
        workspaceName: repository.id,
        snapshotId:
          repository.role === "snapshot"
            ? item.id + ":" + repository.id
            : undefined,
        role: repository.role,
      });
    }
    const idByRoot = new Map([...roots].map(([id, root]) => [root, id]));
    const baseline = buildArchitectureFederation(inputs);
    const actualLinks: ExpectedLink[] = baseline.links
      .map((link) => ({
        from: idByRoot.get(
          baseline.repositories.find(
            (repository) => repository.id === link.from,
          )!.workspaceRoot,
        )!,
        to: idByRoot.get(
          baseline.repositories.find((repository) => repository.id === link.to)!
            .workspaceRoot,
        )!,
        ecosystem: link.ecosystem,
        packageName: link.packageName,
        status: link.status,
        trust: link.trust,
        ...(link.resolutionSource
          ? { resolutionSource: link.resolutionSource }
          : {}),
      }))
      .sort((left, right) => linkKey(left).localeCompare(linkKey(right)));
    const expectedLinks = [...item.expectedLinks].sort((left, right) =>
      linkKey(left).localeCompare(linkKey(right)),
    );
    const actualKeys = new Set(actualLinks.map(linkKey));
    const expectedKeys = new Set(expectedLinks.map(linkKey));
    const truePositiveLinks = [...actualKeys].filter((key) =>
      expectedKeys.has(key),
    ).length;
    const falsePositiveLinks = actualKeys.size - truePositiveLinks;
    const falseNegativeLinks = expectedKeys.size - truePositiveLinks;
    const actualQuestions = baseline.questions
      .map((question) => question.kind)
      .sort();
    const expectedQuestions = [...item.expectedQuestionKinds].sort();
    const reordered = buildArchitectureFederation([...inputs].reverse());
    const orderInvariant = reordered.revision === baseline.revision;
    const authoredExpected = item.expectedLinks.some(
      (link) => link.resolutionSource === "repository-manifest",
    );
    const authoredResolution = authoredExpected
      ? baseline.links.length === item.expectedLinks.length &&
        baseline.links.every(
          (link) =>
            link.status === "resolved" &&
            link.trust === "authored" &&
            link.resolutionSource === "repository-manifest",
        )
      : undefined;
    let approvalResolution: boolean | undefined;
    let staleApprovalRejected: boolean | undefined;
    if (item.approvalTarget) {
      const question = baseline.questions.find(
        (candidate) => candidate.kind === "ambiguous-provider",
      );
      const subject = baseline.repositories.find(
        (repository) => repository.id === question?.subjectRepositoryId,
      );
      const providerRoot = roots.get(item.approvalTarget);
      const provider = baseline.repositories.find(
        (repository) => repository.workspaceRoot === providerRoot,
      );
      assert(question && subject && provider);
      const approval: FederationApproval = {
        contract: "witch.federation-approval/v1",
        id:
          "77777777-7777-4777-8777-" + String(caseIndex + 1).padStart(12, "0"),
        decision: "approve-provider",
        questionId: question.id,
        federationRevision: baseline.revision,
        subjectWorkspaceRoot: subject.workspaceRoot,
        subjectSourceRevision: subject.sourceRevision,
        providerWorkspaceRoot: provider.workspaceRoot,
        providerSourceRevision: provider.sourceRevision,
        ecosystem: question.ecosystem,
        packageName: question.packageName,
        decidedAt: parsed.policy.approvalTimestamp,
      };
      const approved = buildArchitectureFederation(inputs, {
        approvals: [approval],
      });
      approvalResolution =
        approved.validation.valid &&
        approved.links.length === 1 &&
        approved.links[0].to === provider.id &&
        approved.links[0].status === "resolved" &&
        approved.links[0].trust === "authored" &&
        approved.links[0].resolutionSource === "user-approval" &&
        approved.questions.length === 0;
      const stale = buildArchitectureFederation(inputs, {
        approvals: [{ ...approval, providerSourceRevision: "stale" }],
      });
      staleApprovalRejected =
        stale.approvals.length === 0 &&
        stale.questions.some(
          (candidate) => candidate.kind === "ambiguous-provider",
        ) &&
        stale.links.every((link) => link.status === "conflicting");
    }
    cases.push({
      id: item.id,
      ecosystem: item.ecosystem,
      expectedLinks: expectedLinks.length,
      actualLinks: actualLinks.length,
      truePositiveLinks,
      falsePositiveLinks,
      falseNegativeLinks,
      questionsExpected: expectedQuestions.length,
      questionsFound: actualQuestions.length,
      validationPassed: baseline.validation.valid,
      orderInvariant,
      exactResult:
        JSON.stringify(actualLinks) === JSON.stringify(expectedLinks) &&
        JSON.stringify(actualQuestions) === JSON.stringify(expectedQuestions),
      ...(authoredResolution !== undefined ? { authoredResolution } : {}),
      ...(approvalResolution !== undefined ? { approvalResolution } : {}),
      ...(staleApprovalRejected !== undefined ? { staleApprovalRejected } : {}),
    });
  }

  const totals = cases.reduce(
    (result, item) => ({
      truePositive: result.truePositive + item.truePositiveLinks,
      falsePositive: result.falsePositive + item.falsePositiveLinks,
      falseNegative: result.falseNegative + item.falseNegativeLinks,
    }),
    { truePositive: 0, falsePositive: 0, falseNegative: 0 },
  );
  const authoredCases = cases.filter(
    (item) => item.authoredResolution !== undefined,
  );
  const approvalCases = cases.filter(
    (item) => item.approvalResolution !== undefined,
  );
  const staleCases = cases.filter(
    (item) => item.staleApprovalRejected !== undefined,
  );
  const questionCases = cases.filter((item) => item.questionsExpected > 0);
  const metrics = {
    linkPrecision: ratio(
      totals.truePositive,
      totals.truePositive + totals.falsePositive,
    ),
    linkRecall: ratio(
      totals.truePositive,
      totals.truePositive + totals.falseNegative,
    ),
    exactCaseRate: ratio(
      cases.filter((item) => item.exactResult).length,
      cases.length,
    ),
    questionCaseRecall: ratio(
      questionCases.filter(
        (item) => item.questionsFound === item.questionsExpected,
      ).length,
      questionCases.length,
    ),
    validationRate: ratio(
      cases.filter((item) => item.validationPassed).length,
      cases.length,
    ),
    orderInvarianceRate: ratio(
      cases.filter((item) => item.orderInvariant).length,
      cases.length,
    ),
    authoredResolutionRate: authoredCases.length
      ? ratio(
          authoredCases.filter((item) => item.authoredResolution).length,
          authoredCases.length,
        )
      : null,
    approvalResolutionRate: approvalCases.length
      ? ratio(
          approvalCases.filter((item) => item.approvalResolution).length,
          approvalCases.length,
        )
      : null,
    staleApprovalRejectionRate: staleCases.length
      ? ratio(
          staleCases.filter((item) => item.staleApprovalRejected).length,
          staleCases.length,
        )
      : null,
  };
  return {
    contract: "witch.federation-benchmark-run/v1",
    algorithm: "exact-package-identity-v1",
    suite: path.basename(suiteFile),
    suiteSha256: createHash("sha256").update(suiteSource).digest("hex"),
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
    policy: parsed.policy,
    metrics,
    cases,
    machineValid:
      Object.values(metrics).every((value) => value === null || value === 1) &&
      cases.every((item) => item.exactResult),
  };
}

async function main() {
  const suite = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.resolve("benchmarks/federation/suite-v1.json");
  const report = await runFederationBenchmark(suite);
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  if (!report.machineValid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
