import ts from "typescript";
import type { ArchitectureGraph } from "../../shared/architecture";
import type { AgentRun, ProposedChange } from "../../shared/agent";
import type {
  EngineeringPlan,
  PlanEvaluation,
  VerificationReceipt,
} from "../../shared/engineering-run";
import { analyzeRepository } from "./architecture";
import { contentHash } from "./workspace-files";

function normalizedFile(file: string) {
  return file.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function evaluateHarnessPlan(
  plan: EngineeringPlan,
  changes: readonly ProposedChange[],
): PlanEvaluation {
  const expectedFiles = [
    ...new Set(plan.expectedFiles.map(normalizedFile).filter(Boolean)),
  ].sort();
  const actualFiles = [
    ...new Set(changes.map((change) => normalizedFile(change.path))),
  ].sort();
  const expected = new Set(expectedFiles);
  const actual = new Set(actualFiles);
  return {
    expectedFiles,
    actualFiles,
    // An empty expected set means that the user attached no file-scoped
    // context. It is an intentionally open plan, not a promise to edit zero
    // files. Once a scope exists, every outside change is surfaced.
    unexpectedFiles: expectedFiles.length
      ? actualFiles.filter((file) => !expected.has(file))
      : [],
    missingFiles: expectedFiles.filter((file) => !actual.has(file)),
    evaluatedAt: new Date().toISOString(),
  };
}

export function failedVerificationReceipts(
  receipts: readonly VerificationReceipt[],
) {
  return receipts.filter((receipt) =>
    ["failed", "blocked"].includes(receipt.status),
  );
}

export function verificationFailureFingerprint(
  receipts: readonly VerificationReceipt[],
  changes: readonly ProposedChange[],
) {
  const failures = failedVerificationReceipts(receipts)
    .map((receipt) => ({
      intentId: receipt.intentId,
      status: receipt.status,
      outputHash: receipt.outputHash || null,
      changedRevision: receipt.changedRevision || null,
    }))
    .sort((left, right) => left.intentId.localeCompare(right.intentId));
  return contentHash(
    JSON.stringify({
      failures,
      changes: changes
        .map((change) => ({
          path: normalizedFile(change.path),
          afterHash: change.afterHash,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    }),
  );
}

export function createHarnessPlan(
  run: AgentRun,
  graph: ArchitectureGraph,
): EngineeringPlan {
  const expectedFiles = [...new Set(run.contexts.flatMap((item) => item.paths))]
    .sort()
    .slice(0, 500);
  return {
    objective: run.prompt,
    assumptions: [
      "Only the isolated workspace may change before explicit review approval",
      "Provider completion is provisional until Witch emits verification receipts",
      `Plan baseline architecture revision is ${graph.revision}`,
    ],
    affectedComponents: run.contexts.length
      ? run.contexts.map((item) => item.label).slice(0, 100)
      : [run.workspaceName],
    expectedFiles,
    steps: [
      {
        id: "isolate",
        description: "Create an immutable baseline and isolated workspace",
        expectedOutcome: "Original source remains unchanged",
      },
      {
        id: "execute",
        description: "Run the selected Agent Provider within its bounded mode",
        expectedOutcome:
          "Provider output and actual file changes are captured separately",
      },
      {
        id: "verify",
        description: "Validate changed syntax and rebuild the architecture IR",
        expectedOutcome: "Every executed check has a replayable receipt",
      },
      {
        id: "review",
        description: "Create a checkpoint-backed review before original apply",
        expectedOutcome: "Only explicitly selected files can be applied",
      },
    ],
    verification: [
      {
        id: "changed-source-syntax",
        kind: "syntax",
        scope: ["changed TypeScript, JavaScript, and JSON files"],
        required: false,
      },
      {
        id: "isolated-architecture",
        kind: "architecture",
        scope: ["isolated workspace"],
        required: true,
      },
    ],
    risks: [
      "Dynamic Python and Rust behavior is not proven by static architecture validation",
      "Project-defined test commands are not executed automatically in this phase",
    ],
  };
}

function scriptKind(file: string) {
  if (/\.tsx$/i.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?ts$/i.test(file)) return ts.ScriptKind.TS;
  if (/\.[cm]?js$/i.test(file)) return ts.ScriptKind.JS;
  if (/\.json$/i.test(file)) return ts.ScriptKind.JSON;
  return null;
}

function syntaxReceipt(
  changes: readonly ProposedChange[],
): VerificationReceipt {
  const startedAt = new Date().toISOString();
  const diagnostics: string[] = [];
  let checked = 0;
  for (const change of changes) {
    const kind = scriptKind(change.path);
    if (kind === null || change.after === null) continue;
    checked++;
    const source = ts.createSourceFile(
      change.path,
      change.after,
      ts.ScriptTarget.Latest,
      true,
      kind,
    );
    for (const diagnostic of (
      source as ts.SourceFile & {
        parseDiagnostics?: readonly ts.Diagnostic[];
      }
    ).parseDiagnostics || []) {
      const position =
        diagnostic.start === undefined
          ? ""
          : `:${source.getLineAndCharacterOfPosition(diagnostic.start).line + 1}`;
      diagnostics.push(
        `${change.path}${position} ${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")}`,
      );
    }
  }
  const output = checked
    ? diagnostics.length
      ? diagnostics.slice(0, 100).join("\n").slice(0, 100_000)
      : `${checked} changed source file(s) parsed without syntax diagnostics`
    : "No changed TypeScript, JavaScript, or JSON files required this check";
  return {
    intentId: "changed-source-syntax",
    status:
      checked === 0 ? "skipped" : diagnostics.length ? "failed" : "passed",
    startedAt,
    completedAt: new Date().toISOString(),
    outputHash: contentHash(output),
    boundedOutput: output,
  };
}

export async function verifyIsolatedReview(
  stagingRoot: string,
  changes: readonly ProposedChange[],
): Promise<VerificationReceipt[]> {
  const syntax = syntaxReceipt(changes);
  const startedAt = new Date().toISOString();
  let architecture: VerificationReceipt;
  try {
    const graph = await analyzeRepository(stagingRoot);
    const valid =
      graph.validation.valid &&
      (!graph.semantic || graph.semantic.validation.valid === true);
    const output = valid
      ? `Architecture ${graph.revision} validated with ${graph.nodes.length} nodes and ${graph.edges.length} relations`
      : `Architecture validation failed: ${graph.validation.diagnostics
          .map((item) => item.message)
          .slice(0, 30)
          .join("; ")}`;
    architecture = {
      intentId: "isolated-architecture",
      status: valid ? "passed" : "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      outputHash: contentHash(output),
      boundedOutput: output.slice(0, 100_000),
      changedRevision: graph.revision,
    };
  } catch (error) {
    const output = `Isolated architecture analysis failed: ${error}`.slice(
      0,
      100_000,
    );
    architecture = {
      intentId: "isolated-architecture",
      status: "failed",
      startedAt,
      completedAt: new Date().toISOString(),
      outputHash: contentHash(output),
      boundedOutput: output,
    };
  }
  return [syntax, architecture];
}
