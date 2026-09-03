import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ComprehensionTask = {
  id: string;
  prompt: string;
  expectedEvidencePaths: string[];
};

export type ComprehensionSuite = {
  contract: "witch.comprehension-benchmark/v1";
  policy: {
    sourceContentsForbidden: true;
    namedReviewerRequired: true;
    aggregateScoreForbidden: true;
    taskOrder: "fixed";
    practiceTasks: number;
  };
  cases: Array<{
    id: string;
    language: "python" | "rust" | "typescript";
    root: string;
    tasks: ComprehensionTask[];
  }>;
};

export type ComprehensionSession = {
  contract: "witch.comprehension-session/v1";
  caseId: string;
  participantId: string;
  startedAt: string;
  endedAt: string;
  events: Array<{
    at: string;
    taskId: string;
    type:
      | "task-start"
      | "view-open"
      | "node-select"
      | "edge-select"
      | "source-open"
      | "answer";
    target?: string;
  }>;
  answers: Array<{
    taskId: string;
    outcome: "success" | "failure" | "skipped";
  }>;
  reviewer?: { name: string; reviewedAt: string };
};

function forbiddenCompositeOrContent(value: unknown, location = "session") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      ![
        "source",
        "sourceText",
        "sourceContent",
        "contents",
        "overallScore",
        "compositeScore",
        "weight",
      ].includes(key),
      `${location}.${key} is forbidden`,
    );
    forbiddenCompositeOrContent(child, `${location}.${key}`);
  }
}

export function validateComprehensionSuite(
  input: unknown,
): asserts input is ComprehensionSuite {
  assert(input && typeof input === "object", "suite must be an object");
  const suite = input as ComprehensionSuite;
  assert.equal(suite.contract, "witch.comprehension-benchmark/v1");
  assert.equal(suite.policy.sourceContentsForbidden, true);
  assert.equal(suite.policy.namedReviewerRequired, true);
  assert.equal(suite.policy.aggregateScoreForbidden, true);
  assert.equal(suite.policy.taskOrder, "fixed");
  assert.deepEqual(
    [...new Set(suite.cases.map((item) => item.language))].sort(),
    ["python", "rust", "typescript"],
  );
  const ids = suite.cases.flatMap((item) => item.tasks.map((task) => task.id));
  assert.equal(new Set(ids).size, ids.length, "task ids must be globally unique");
  for (const item of suite.cases) {
    assert(
      !path.isAbsolute(item.root) &&
        /^(?:fixtures|\.\.\/semantic-composer\/fixtures)\/[a-z0-9-]+$/.test(
          item.root,
        ),
      `${item.id} fixture root is outside the benchmark fixtures`,
    );
    assert(item.tasks.length >= 5, `${item.id} requires at least five tasks`);
    for (const task of item.tasks) {
      assert(task.prompt.trim());
      assert(task.expectedEvidencePaths.length > 0);
      assert(task.expectedEvidencePaths.every((file) => !path.isAbsolute(file)));
    }
  }
  forbiddenCompositeOrContent(suite, "suite");
}

const timestamp = (value: string) => {
  const result = Date.parse(value);
  assert(Number.isFinite(result), `Invalid timestamp: ${value}`);
  return result;
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
};

export function evaluateComprehensionSession(
  suite: ComprehensionSuite,
  session: ComprehensionSession,
) {
  forbiddenCompositeOrContent(session);
  assert.equal(session.contract, "witch.comprehension-session/v1");
  assert(/^[a-zA-Z0-9._-]{3,80}$/.test(session.participantId));
  const selected = suite.cases.find((item) => item.id === session.caseId);
  assert(selected, `Unknown case: ${session.caseId}`);
  assert(timestamp(session.endedAt) >= timestamp(session.startedAt));
  const taskIds = new Set(selected.tasks.map((task) => task.id));
  assert(session.events.every((event) => taskIds.has(event.taskId)));
  assert(session.answers.every((answer) => taskIds.has(answer.taskId)));
  assert.equal(
    new Set(session.answers.map((answer) => answer.taskId)).size,
    session.answers.length,
    "answers must be unique per task",
  );
  const evidenceTimes: number[] = [];
  let wrongSourceSelections = 0;
  for (const task of selected.tasks) {
    const events = session.events.filter((event) => event.taskId === task.id);
    const start = events.find((event) => event.type === "task-start");
    const matching = events.find(
      (event) =>
        event.type === "source-open" &&
        event.target !== undefined &&
        task.expectedEvidencePaths.includes(event.target),
    );
    if (start && matching)
      evidenceTimes.push(Math.max(0, timestamp(matching.at) - timestamp(start.at)));
    wrongSourceSelections += events.filter(
      (event) =>
        event.type === "source-open" &&
        (!event.target || !task.expectedEvidencePaths.includes(event.target)),
    ).length;
  }
  const completed = session.answers.filter(
    (answer) => answer.outcome !== "skipped",
  );
  const successes = completed.filter(
    (answer) => answer.outcome === "success",
  ).length;
  const reviewState = session.reviewer?.name.trim() ? "reviewed" : "pending";
  return {
    contract: "witch.comprehension-result/v1",
    caseId: session.caseId,
    participantId: session.participantId,
    reviewState,
    reviewer: session.reviewer?.name || null,
    metrics: {
      taskSuccess: completed.length ? successes / completed.length : null,
      completedTasks: completed.length,
      skippedTasks: session.answers.length - completed.length,
      medianTimeToEvidenceMs: median(evidenceTimes),
      matchedEvidenceTasks: evidenceTimes.length,
      wrongSourceSelections,
      navigationCount: session.events.filter((event) =>
        ["view-open", "node-select", "edge-select", "source-open"].includes(
          event.type,
        ),
      ).length,
    },
    valid:
      reviewState === "reviewed" &&
      session.answers.length === selected.tasks.length &&
      evidenceTimes.length === selected.tasks.length,
  };
}

async function main() {
  const suiteIndex = process.argv.indexOf("--suite");
  const suiteFile = path.resolve(
    (suiteIndex >= 0 ? process.argv[suiteIndex + 1] : undefined) ||
      "benchmarks/comprehension/suite-v1.json",
  );
  const parsed: unknown = JSON.parse(await fs.readFile(suiteFile, "utf8"));
  validateComprehensionSuite(parsed);
  const sessionIndex = process.argv.indexOf("--session");
  if (sessionIndex < 0) {
    process.stdout.write(
      `Comprehension suite valid: ${parsed.cases.length} cases, ${parsed.cases.reduce((sum, item) => sum + item.tasks.length, 0)} tasks. Human result: pending.\n`,
    );
    return;
  }
  const sessionFile = path.resolve(process.argv[sessionIndex + 1]);
  const session = JSON.parse(
    await fs.readFile(sessionFile, "utf8"),
  ) as ComprehensionSession;
  const result = evaluateComprehensionSession(parsed, session);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
)
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
