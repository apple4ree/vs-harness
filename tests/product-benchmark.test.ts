import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import {
  readProductBenchmarkSuite,
  validateProductBenchmarkSuite,
} from "../scripts/check-product-benchmark";

test("product benchmark contract keeps product classes and dimensions explicit", async () => {
  const suite = await readProductBenchmarkSuite(
    path.resolve("benchmarks/product/suite-v1.json"),
  );
  assert(suite.toolClasses.includes("code-structure-explorer"));
  assert(suite.toolClasses.includes("ide"));
  assert(suite.toolClasses.includes("ade"));
  assert(suite.toolClasses.includes("coding-agent-harness"));
  assert(suite.dimensions.some((item) => item.id === "analysis-fidelity"));
  assert(suite.dimensions.some((item) => item.id === "developer-workflow"));
  assert(suite.dimensions.some((item) => item.id === "agent-harness"));
});

test("product benchmark rejects a weighted overall score", async () => {
  const suite = await readProductBenchmarkSuite(
    path.resolve("benchmarks/product/suite-v1.json"),
  );
  const invalid = { ...suite, overallScore: 92 };
  assert.throws(
    () => validateProductBenchmarkSuite(invalid),
    /dimensions must remain separate/,
  );
});
