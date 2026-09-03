import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { test } from "node:test";
import {
  validateComposerBenchmarkSuite,
  type ComposerBenchmarkSuite,
} from "../scripts/benchmark-semantic-composer";

test("semantic composer benchmark freezes one no-fallback candidate for three languages", async () => {
  const suite = JSON.parse(
    await fs.readFile("benchmarks/semantic-composer/suite-v1.json", "utf8"),
  ) as ComposerBenchmarkSuite;
  validateComposerBenchmarkSuite(suite);
  assert.equal(suite.policy.freezeFirstCandidate, true);
  assert.equal(suite.policy.fallbackAllowed, false);
  assert.equal(suite.policy.executeRepositoryCode, false);
});
