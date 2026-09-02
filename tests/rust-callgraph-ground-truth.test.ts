import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { evaluateCallgraphBenchmark } from "../scripts/benchmark-callgraph";

test("Rust ground-truth call graph cannot regress and may close known gaps", async () => {
  const result = await evaluateCallgraphBenchmark(
    path.resolve("tests/fixtures/rust-callgraph"),
  );
  assert.equal(result.evaluatedCases, 12);
  assert.equal(result.failedCases, 0);
  assert.equal(result.contract, "witch.external-callgraph-evaluation/v2");
  assert.equal(result.coverage.oracleEdgeCoverage, 1);
  assert.equal(result.coverage.nonVacuousCases, 12);
  assert.equal(result.coverage.vacuousScopedCases, 0);
  assert(result.coverage.nonVacuousExactRate >= 10 / 12);
  assert.equal(result.metrics.precision, 1);
  assert(result.metrics.recall >= 15 / 17);
  assert(result.metrics.f1 >= 0.9375);
  assert(result.exactCases >= 10);
  const knownGaps = new Set([
    "11-callable-parameter::src.lib.apply -> src.lib.job",
    "12-returned-callable::src.lib.run -> src.lib.job",
  ]);
  const currentMisses = result.cases.flatMap((item) =>
    item.missed.map((edge) => `${item.caseId}::${edge}`),
  );
  assert(
    currentMisses.every((edge) => knownGaps.has(edge)),
    `New Rust call-graph misses: ${currentMisses.filter((edge) => !knownGaps.has(edge)).join(", ")}`,
  );
});
