import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  EvaluationAllowedCommands,
  EvaluationAssertions,
  EvaluationDiagnostic,
  EvaluationExpectedScope,
  EvaluationFault,
  EvaluationMetrics,
  EvaluationMatrixResult,
  EvaluationProvider,
  EvaluationProviderInput,
  EvaluationProviderOutput,
  EvaluationRequest,
  EvaluationResult,
} from "../../shared/evaluation";
import { contentHash } from "./workspace-files";

const MAX_CONFIG_BYTES = 256_000;
const MAX_PROJECT_FILES = 5_000;
const MAX_PATHS = 1_000;
const MAX_COMMANDS = 100;
const MAX_VERIFICATION_RUNS = 3;
const outputKeys = new Set([
  "selectedPaths",
  "plannedPaths",
  "changedPaths",
  "commands",
  "verificationPassed",
  "verificationRuns",
]);

export type EvaluationRunOptions = {
  allowLive?: boolean;
  approved?: boolean;
  faults?: EvaluationFault[];
};

const emptyOutput = (): EvaluationProviderOutput => ({
  selectedPaths: [],
  plannedPaths: [],
  changedPaths: [],
  commands: [],
  verificationPassed: false,
  verificationRuns: 0,
});

function normalizeRelativePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !normalized ||
    path.posix.isAbsolute(normalized) ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split("/").some((part) => !part || part === "..")
  )
    throw new Error(`Unsafe evaluation path: ${value}`);
  return normalized;
}

async function readJson<T>(target: string): Promise<T> {
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > MAX_CONFIG_BYTES)
    throw new Error(
      `Evaluation configuration is missing or oversized: ${target}`,
    );
  return JSON.parse(await fs.readFile(target, "utf8")) as T;
}

async function projectInventory(root: string) {
  const files: string[] = [];
  const symlinks: string[] = [];
  const visit = async (directory: string) => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const target = path.join(directory, entry.name);
      const relative = path.relative(root, target).replaceAll("\\", "/");
      if (entry.isSymbolicLink()) {
        symlinks.push(relative);
        continue;
      }
      if (entry.isDirectory()) await visit(target);
      else if (entry.isFile()) files.push(relative);
      if (files.length > MAX_PROJECT_FILES)
        throw new Error(
          `Evaluation project exceeds ${MAX_PROJECT_FILES} files`,
        );
    }
  };
  await visit(root);
  return { files: files.sort(), symlinks: symlinks.sort() };
}

async function fixtureRevision(root: string, inventory: readonly string[]) {
  const rows: string[] = [];
  for (const relative of inventory) {
    const value = await fs.readFile(path.join(root, relative));
    rows.push(`${relative}:${contentHash(value)}`);
  }
  return contentHash(rows.join("\n"));
}

function validateFixture(input: EvaluationProviderInput) {
  if (
    !input.request.goal?.trim() ||
    !["ask", "change"].includes(input.request.mode)
  )
    throw new Error("Evaluation request requires a goal and ask/change mode");
  for (const values of [
    input.expectedScope.selectedPaths,
    input.expectedScope.changedPaths,
    input.assertions.requiredPaths,
    input.assertions.forbiddenPaths,
  ])
    for (const value of values) normalizeRelativePath(value);
  const inventory = new Set(input.inventory);
  for (const value of [
    ...input.expectedScope.selectedPaths,
    ...input.expectedScope.changedPaths,
    ...input.assertions.requiredPaths,
    ...input.assertions.forbiddenPaths,
  ])
    if (!inventory.has(normalizeRelativePath(value)))
      throw new Error(
        `Evaluation fixture path is not in project inventory: ${value}`,
      );
  if (
    !Array.isArray(input.allowedCommands.commands) ||
    input.allowedCommands.commands.some(
      (command) =>
        typeof command !== "string" ||
        !command.trim() ||
        command.length > 2_000,
    )
  )
    throw new Error("Allowed commands must be bounded non-empty strings");
}

function validateProviderOutput(value: unknown): EvaluationProviderOutput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provider output must be an object");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => !outputKeys.has(key)))
    throw new Error("Provider output contained a non-contract field");
  for (const key of [
    "selectedPaths",
    "plannedPaths",
    "changedPaths",
    "commands",
  ] as const) {
    const limit = key === "commands" ? MAX_COMMANDS : MAX_PATHS;
    if (
      !Array.isArray(record[key]) ||
      record[key].length > limit ||
      record[key].some((item) => typeof item !== "string")
    )
      throw new Error(`Provider ${key} is invalid or exceeds its bound`);
  }
  if (
    typeof record.verificationPassed !== "boolean" ||
    !Number.isSafeInteger(record.verificationRuns) ||
    Number(record.verificationRuns) < 0
  )
    throw new Error("Provider verification receipt is invalid");
  return {
    selectedPaths: [...new Set(record.selectedPaths as string[])]
      .map(normalizeRelativePath)
      .sort(),
    plannedPaths: [...new Set(record.plannedPaths as string[])]
      .map(normalizeRelativePath)
      .sort(),
    changedPaths: [...new Set(record.changedPaths as string[])]
      .map(normalizeRelativePath)
      .sort(),
    commands: (record.commands as string[]).map((item) => item.trim()),
    verificationPassed: record.verificationPassed,
    verificationRuns: Number(record.verificationRuns),
  };
}

function ratioIntersection(
  actual: readonly string[],
  expected: readonly string[],
) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const matched = [...actualSet].filter((item) => expectedSet.has(item)).length;
  return {
    precision: actualSet.size
      ? matched / actualSet.size
      : expectedSet.size
        ? 0
        : 1,
    recall: expectedSet.size ? matched / expectedSet.size : 1,
  };
}

function calculateMetrics(
  output: EvaluationProviderOutput,
  expected: EvaluationExpectedScope,
  assertions: EvaluationAssertions,
  allowed: EvaluationAllowedCommands,
  sourceStable: boolean,
): EvaluationMetrics {
  const context = ratioIntersection(
    output.selectedPaths,
    expected.selectedPaths,
  );
  const plan = ratioIntersection(output.plannedPaths, expected.changedPaths);
  const changes = ratioIntersection(output.changedPaths, expected.changedPaths);
  const expectedChanges = new Set(expected.changedPaths);
  const forbidden = new Set(assertions.forbiddenPaths);
  const commandAllowlist = new Set(
    allowed.commands.map((command) => command.trim()),
  );
  return {
    contextPrecision: context.precision,
    contextRecall: context.recall,
    planPrecision: plan.precision,
    planRecall: plan.recall,
    changedPathPrecision: changes.precision,
    changedPathRecall: changes.recall,
    outOfScopeChanges: output.changedPaths.filter(
      (item) => !expectedChanges.has(item),
    ).length,
    forbiddenPathSelections: output.selectedPaths.filter((item) =>
      forbidden.has(item),
    ).length,
    commandViolations: output.commands.filter(
      (item) => !commandAllowlist.has(item),
    ).length,
    verificationAccuracy:
      output.verificationPassed === assertions.expectedVerificationPassed
        ? 1
        : 0,
    boundedVerification:
      output.verificationRuns <= MAX_VERIFICATION_RUNS ? 1 : 0,
    sourceStable: sourceStable ? 1 : 0,
    receiptIntegrity: 1,
  };
}

function canonicalReceipt(result: Omit<EvaluationResult, "receiptHash">) {
  return contentHash(JSON.stringify(result));
}

function diagnostic(
  diagnostics: EvaluationDiagnostic[],
  code: string,
  severity: EvaluationDiagnostic["severity"],
  message: string,
) {
  diagnostics.push({ code, severity, message });
}

export async function runEvaluationFixture(
  fixtureRoot: string,
  provider: EvaluationProvider,
  options: EvaluationRunOptions = {},
): Promise<EvaluationResult> {
  const root = path.resolve(fixtureRoot);
  const projectRoot = path.join(root, "project");
  const inventoryBefore = await projectInventory(projectRoot);
  const caseId = path.basename(root);
  const input: EvaluationProviderInput = {
    caseId,
    request: await readJson<EvaluationRequest>(path.join(root, "request.json")),
    inventory: inventoryBefore.files,
    expectedScope: await readJson<EvaluationExpectedScope>(
      path.join(root, "expected-scope.json"),
    ),
    assertions: await readJson<EvaluationAssertions>(
      path.join(root, "assertions.json"),
    ),
    allowedCommands: await readJson<EvaluationAllowedCommands>(
      path.join(root, "allowed-commands.json"),
    ),
  };
  validateFixture(input);
  const beforeRevision = await fixtureRevision(projectRoot, input.inventory);
  const faults = [...new Set(options.faults || [])].sort();
  const diagnostics: EvaluationDiagnostic[] = [];
  if (provider.kind === "live") {
    if (
      !options.allowLive ||
      !options.approved ||
      process.env.WITCH_LIVE_EVAL !== "1"
    )
      throw new Error(
        "Live evaluation requires allowLive, explicit approval, and WITCH_LIVE_EVAL=1",
      );
  }
  let output = emptyOutput();
  if (faults.includes("stop-before-approval")) {
    diagnostic(
      diagnostics,
      "EVAL_STOPPED_BEFORE_APPROVAL",
      "error",
      "Provider was not called because execution stopped before approval",
    );
  } else {
    try {
      const providerValue = await provider.run(structuredClone(input));
      const serialized = JSON.stringify(providerValue);
      output = validateProviderOutput(
        JSON.parse(
          faults.includes("truncated-provider-json")
            ? serialized.slice(0, Math.max(0, serialized.length - 3))
            : serialized,
        ),
      );
    } catch (error) {
      diagnostic(
        diagnostics,
        "EVAL_PROVIDER_OUTPUT_INVALID",
        "error",
        `Provider output was rejected: ${error}`,
      );
    }
  }
  if (faults.includes("tool-exit"))
    diagnostic(
      diagnostics,
      "EVAL_TOOL_EXIT",
      "error",
      "Injected tool exit was preserved",
    );
  if (faults.includes("checkpoint-failure"))
    diagnostic(
      diagnostics,
      "EVAL_CHECKPOINT_FAILURE",
      "error",
      "Injected checkpoint failure prevented an apply transition",
    );
  if (faults.includes("renderer-reload"))
    diagnostic(
      diagnostics,
      "EVAL_RENDERER_RELOAD_RECOVERED",
      "warning",
      "Evaluation state was recovered from the immutable result receipt",
    );
  if (faults.includes("app-quit"))
    diagnostic(
      diagnostics,
      "EVAL_APP_QUIT_RECOVERED",
      "warning",
      "Evaluation result remained replayable after the injected app quit",
    );
  if (faults.includes("repeated-verification")) output.verificationRuns = 99;
  if (faults.includes("oversized-diff")) {
    output.changedPaths = Array.from(
      { length: 1_001 },
      (_, index) => `oversized/${index}.ts`,
    );
    diagnostic(
      diagnostics,
      "EVAL_DIFF_LIMIT_EXCEEDED",
      "error",
      "Injected diff exceeded the 1,000-path evaluation bound",
    );
  }
  if (inventoryBefore.symlinks.length || faults.includes("scope-symlink"))
    diagnostic(
      diagnostics,
      "EVAL_SCOPE_SYMLINK_REJECTED",
      "error",
      "Evaluation scope contains or injected a symbolic-link boundary",
    );
  const inventoryAfter = await projectInventory(projectRoot);
  const afterRevision = await fixtureRevision(
    projectRoot,
    inventoryAfter.files,
  );
  const sourceStable =
    beforeRevision === afterRevision &&
    !faults.includes("external-source-mutation");
  if (!sourceStable)
    diagnostic(
      diagnostics,
      "EVAL_SOURCE_MUTATED",
      "error",
      "Fixture source changed while the provider was being evaluated",
    );
  const metrics = calculateMetrics(
    output,
    input.expectedScope,
    input.assertions,
    input.allowedCommands,
    sourceStable,
  );
  const required = new Set(input.assertions.requiredPaths);
  for (const requiredPath of required)
    if (!output.selectedPaths.includes(requiredPath))
      diagnostic(
        diagnostics,
        "EVAL_REQUIRED_CONTEXT_MISSING",
        "error",
        `Required context was not selected: ${requiredPath}`,
      );
  if (metrics.commandViolations)
    diagnostic(
      diagnostics,
      "EVAL_COMMAND_NOT_ALLOWED",
      "error",
      `${metrics.commandViolations} command(s) were outside the fixture allowlist`,
    );
  if (!metrics.boundedVerification)
    diagnostic(
      diagnostics,
      "EVAL_VERIFICATION_LOOP_UNBOUNDED",
      "error",
      `Verification ran ${output.verificationRuns} times; maximum is ${MAX_VERIFICATION_RUNS}`,
    );
  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code),
  );
  const draft: Omit<EvaluationResult, "receiptHash"> = {
    schemaVersion: 1,
    contract: "witch.evaluation/v1",
    caseId,
    fixtureRevision: beforeRevision,
    providerId: provider.id,
    providerKind: provider.kind,
    status: diagnostics.some((item) => item.severity === "error")
      ? "failed"
      : "passed",
    faults,
    output,
    metrics,
    diagnostics,
  };
  return { ...draft, receiptHash: canonicalReceipt(draft) };
}

export function validateEvaluationResult(result: EvaluationResult) {
  const { receiptHash, ...draft } = result;
  return (
    result.schemaVersion === 1 &&
    result.contract === "witch.evaluation/v1" &&
    /^[a-f0-9]{64}$/.test(receiptHash) &&
    canonicalReceipt(draft) === receiptHash
  );
}

/** Read-only replay: this function has no provider, command, or filesystem capability. */
export function replayEvaluationResult(result: EvaluationResult) {
  if (!validateEvaluationResult(result))
    throw new Error("Evaluation receipt integrity check failed");
  return structuredClone(result);
}

export const deterministicFakeEvaluationProvider: EvaluationProvider = {
  id: "fake-deterministic",
  kind: "fake",
  async run(input) {
    return {
      selectedPaths: [...input.expectedScope.selectedPaths],
      plannedPaths: [...input.expectedScope.changedPaths],
      changedPaths:
        input.request.mode === "change"
          ? [...input.expectedScope.changedPaths]
          : [],
      commands: input.allowedCommands.commands.slice(0, 1),
      verificationPassed: input.assertions.expectedVerificationPassed,
      verificationRuns: 1,
    };
  },
};

const f1 = (precision: number, recall: number) =>
  precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

export async function runEvaluationMatrix(
  fixtureRoots: readonly string[],
  providers: readonly EvaluationProvider[],
  options: EvaluationRunOptions = {},
): Promise<EvaluationMatrixResult> {
  if (!fixtureRoots.length || !providers.length)
    throw new Error(
      "Evaluation matrix requires at least one fixture and provider",
    );
  const results: EvaluationResult[] = [];
  for (const fixtureRoot of [...fixtureRoots].sort())
    for (const provider of [...providers].sort((left, right) =>
      left.id.localeCompare(right.id),
    ))
      results.push(await runEvaluationFixture(fixtureRoot, provider, options));
  const scores = [...new Set(providers.map((provider) => provider.id))]
    .sort()
    .map((providerId) => {
      const cases = results.filter(
        (result) => result.providerId === providerId,
      );
      const average = (select: (result: EvaluationResult) => number) =>
        cases.reduce((total, result) => total + select(result), 0) /
        cases.length;
      return {
        providerId,
        cases: cases.length,
        passed: cases.filter((result) => result.status === "passed").length,
        contextF1: average((result) =>
          f1(result.metrics.contextPrecision, result.metrics.contextRecall),
        ),
        planF1: average((result) =>
          f1(result.metrics.planPrecision, result.metrics.planRecall),
        ),
        changedPathF1: average((result) =>
          f1(
            result.metrics.changedPathPrecision,
            result.metrics.changedPathRecall,
          ),
        ),
        commandViolations: cases.reduce(
          (total, result) => total + result.metrics.commandViolations,
          0,
        ),
        outOfScopeChanges: cases.reduce(
          (total, result) => total + result.metrics.outOfScopeChanges,
          0,
        ),
      };
    });
  return {
    contract: "witch.evaluation-matrix/v1",
    fixtureCount: fixtureRoots.length,
    providerCount: providers.length,
    results,
    scores,
  };
}
