import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  deterministicFakeEvaluationProvider,
  replayEvaluationResult,
  runEvaluationFixture,
  runEvaluationMatrix,
  validateEvaluationResult,
} from "../apps/desktop/src/main/services/evaluation-harness";
import type {
  EvaluationFault,
  EvaluationProvider,
} from "../apps/desktop/src/shared/evaluation";

const fixture = path.resolve("evals/bounded-agent-change");

test("offline evaluation fixture is deterministic and separates harness metrics", async () => {
  const first = await runEvaluationFixture(
    fixture,
    deterministicFakeEvaluationProvider,
  );
  const second = await runEvaluationFixture(
    fixture,
    deterministicFakeEvaluationProvider,
  );
  assert.deepEqual(second, first);
  assert.equal(first.status, "passed");
  assert.equal(first.metrics.contextPrecision, 1);
  assert.equal(first.metrics.contextRecall, 1);
  assert.equal(first.metrics.planPrecision, 1);
  assert.equal(first.metrics.changedPathRecall, 1);
  assert.equal(first.metrics.commandViolations, 0);
  assert.equal(first.metrics.boundedVerification, 1);
  assert.equal(first.metrics.receiptIntegrity, 1);
  assert(validateEvaluationResult(first));
});

test("provider matrix compares the same fixture without merging provider scores", async () => {
  const scoped: EvaluationProvider = {
    ...deterministicFakeEvaluationProvider,
    id: "scoped",
  };
  const noisy: EvaluationProvider = {
    id: "noisy",
    kind: "fake",
    async run(input) {
      const output = await deterministicFakeEvaluationProvider.run(input);
      return {
        ...output,
        selectedPaths: [...output.selectedPaths, "README.md"],
        changedPaths: [...output.changedPaths, "README.md"],
        commands: ["git push --force"],
      };
    },
  };
  const matrix = await runEvaluationMatrix([fixture], [noisy, scoped]);
  assert.equal(matrix.fixtureCount, 1);
  assert.equal(matrix.providerCount, 2);
  assert.equal(matrix.results.length, 2);
  assert.equal(
    matrix.scores.find((score) => score.providerId === "scoped")?.passed,
    1,
  );
  assert.equal(
    matrix.scores.find((score) => score.providerId === "noisy")?.passed,
    0,
  );
  assert.equal(
    matrix.scores.find((score) => score.providerId === "noisy")
      ?.commandViolations,
    1,
  );
});

test("evaluation replay cannot call a provider or execute a command", async () => {
  let calls = 0;
  const provider: EvaluationProvider = {
    ...deterministicFakeEvaluationProvider,
    id: "counted-fake",
    async run(input) {
      calls++;
      return deterministicFakeEvaluationProvider.run(input);
    },
  };
  const result = await runEvaluationFixture(fixture, provider);
  assert.equal(calls, 1);
  assert.deepEqual(replayEvaluationResult(result), result);
  assert.equal(calls, 1);
  const tampered = {
    ...result,
    metrics: { ...result.metrics, contextRecall: 0 },
  };
  assert.equal(validateEvaluationResult(tampered), false);
  assert.throws(() => replayEvaluationResult(tampered), /integrity/);
});

test("live evaluation is triple gated and stop-before-approval skips provider", async () => {
  let calls = 0;
  const live: EvaluationProvider = {
    id: "live-test",
    kind: "live",
    async run(input) {
      calls++;
      return deterministicFakeEvaluationProvider.run(input);
    },
  };
  await assert.rejects(
    () =>
      runEvaluationFixture(fixture, live, { allowLive: true, approved: true }),
    /WITCH_LIVE_EVAL=1/,
  );
  assert.equal(calls, 0);
  const stopped = await runEvaluationFixture(
    fixture,
    {
      ...live,
      kind: "fake",
    },
    { faults: ["stop-before-approval"] },
  );
  assert.equal(calls, 0);
  assert.equal(stopped.status, "failed");
  assert(
    stopped.diagnostics.some(
      (item) => item.code === "EVAL_STOPPED_BEFORE_APPROVAL",
    ),
  );
});

test("fault matrix is deterministic, bounded, and fail closed", async () => {
  const faults: EvaluationFault[] = [
    "truncated-provider-json",
    "tool-exit",
    "checkpoint-failure",
    "external-source-mutation",
    "repeated-verification",
    "oversized-diff",
    "scope-symlink",
  ];
  for (const fault of faults) {
    const result = await runEvaluationFixture(
      fixture,
      deterministicFakeEvaluationProvider,
      { faults: [fault] },
    );
    assert.equal(result.status, "failed", fault);
    assert(validateEvaluationResult(result), fault);
  }
  for (const fault of ["renderer-reload", "app-quit"] as const) {
    const result = await runEvaluationFixture(
      fixture,
      deterministicFakeEvaluationProvider,
      { faults: [fault] },
    );
    assert.equal(result.status, "passed", fault);
    assert(
      result.diagnostics.some((item) => item.severity === "warning"),
      fault,
    );
    assert.deepEqual(replayEvaluationResult(result), result);
  }
});
