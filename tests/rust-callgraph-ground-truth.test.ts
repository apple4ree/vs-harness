import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { evaluateCallgraphBenchmark } from "../scripts/benchmark-callgraph";

test("Rust ground-truth call graph stays precise and exposes hard indirect calls", async () => {
  const result = await evaluateCallgraphBenchmark(
    path.resolve("tests/fixtures/rust-callgraph"),
  );
  assert.equal(result.evaluatedCases, 12);
  assert.equal(result.failedCases, 0);
  assert.equal(result.metrics.precision, 1);
  assert.equal(result.metrics.f1, 0.9375);
  assert.deepEqual(
    result.cases
      .filter((item) => !item.exact)
      .map((item) => item.caseId),
    ["11-callable-parameter", "12-returned-callable"],
  );
});
