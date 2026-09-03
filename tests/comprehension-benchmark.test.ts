import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import {
  evaluateComprehensionSession,
  validateComprehensionSuite,
  type ComprehensionSession,
  type ComprehensionSuite,
} from "../scripts/benchmark-comprehension";

async function suite() {
  const parsed = JSON.parse(
    await fs.readFile("benchmarks/comprehension/suite-v1.json", "utf8"),
  ) as ComprehensionSuite;
  validateComprehensionSuite(parsed);
  return parsed;
}

test("comprehension benchmark keeps language tasks equivalent and separately measured", async () => {
  const manifest = await suite();
  const selected = manifest.cases[0];
  const started = Date.parse("2026-09-03T00:00:00.000Z");
  const session: ComprehensionSession = {
    contract: "witch.comprehension-session/v1",
    caseId: selected.id,
    participantId: "participant-001",
    startedAt: new Date(started).toISOString(),
    endedAt: new Date(started + 60_000).toISOString(),
    events: selected.tasks.flatMap((task, index) => [
      {
        at: new Date(started + index * 10_000).toISOString(),
        taskId: task.id,
        type: "task-start" as const,
      },
      {
        at: new Date(started + index * 10_000 + 4_000).toISOString(),
        taskId: task.id,
        type: "source-open" as const,
        target: task.expectedEvidencePaths[0],
      },
    ]),
    answers: selected.tasks.map((task) => ({
      taskId: task.id,
      outcome: "success" as const,
    })),
    reviewer: { name: "Reviewer A", reviewedAt: new Date(started + 60_000).toISOString() },
  };
  const result = evaluateComprehensionSession(manifest, session);
  assert.equal(result.valid, true);
  assert.equal(result.metrics.taskSuccess, 1);
  assert.equal(result.metrics.medianTimeToEvidenceMs, 4_000);
  assert.equal(result.metrics.wrongSourceSelections, 0);
});

test("comprehension session rejects embedded source contents", async () => {
  const manifest = await suite();
  assert.throws(
    () =>
      evaluateComprehensionSession(manifest, {
        contract: "witch.comprehension-session/v1",
        caseId: manifest.cases[0].id,
        participantId: "participant-002",
        startedAt: "2026-09-03T00:00:00.000Z",
        endedAt: "2026-09-03T00:00:01.000Z",
        events: [],
        answers: [],
        sourceContent: "secret",
      } as unknown as ComprehensionSession),
    /sourceContent is forbidden/,
  );
});
