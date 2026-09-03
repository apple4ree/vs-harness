import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  runFederationBenchmark,
  validateFederationBenchmarkSuite,
} from "../scripts/benchmark-federation";

test("federation benchmark separates exact links, ambiguity, authorship, approval, and staleness", async () => {
  const report = await runFederationBenchmark(
    path.resolve("benchmarks/federation/suite-v1.json"),
  );
  assert.equal(report.contract, "witch.federation-benchmark-run/v1");
  assert.equal(report.cases.length, 6);
  assert.equal(report.metrics.linkPrecision, 1);
  assert.equal(report.metrics.linkRecall, 1);
  assert.equal(report.metrics.questionCaseRecall, 1);
  assert.equal(report.metrics.authoredResolutionRate, 1);
  assert.equal(report.metrics.approvalResolutionRate, 1);
  assert.equal(report.metrics.staleApprovalRejectionRate, 1);
  assert.equal(report.metrics.orderInvarianceRate, 1);
  assert.equal(report.machineValid, true);
});

test("federation benchmark rejects a composite-score policy", () => {
  const invalid = {
    contract: "witch.federation-benchmark/v1",
    policy: {
      executeRepositoryCode: false,
      exactGroundTruthOnly: true,
      separateMetrics: false,
      approvalTimestamp: "2026-09-04T00:00:00.000Z",
    },
    cases: [],
  };
  assert.throws(() => validateFederationBenchmarkSuite(invalid));
});
