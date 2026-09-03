import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

type Metric = {
  id: string;
  unit: string;
  direction: "higher" | "lower";
};

type Dimension = {
  id: string;
  title: string;
  question: string;
  metrics: Metric[];
};

type Lane = {
  id: string;
  title: string;
  maturity: "automated" | "partial" | "protocol-defined" | "planned";
  dimensionIds: string[];
  commands: string[];
};

export type ProductBenchmarkSuite = {
  contractVersion: number;
  id: string;
  policy: {
    aggregation: string;
    evidenceLevels: string[];
    resultStates: string[];
    comparisonUnit: string;
  };
  toolClasses: string[];
  dimensions: Dimension[];
  lanes: Lane[];
  externalAdapters: Array<{
    id: string;
    scope: string;
    applicability: string[];
    status: string;
    url: string;
  }>;
};

function unique(values: string[], label: string) {
  assert.equal(new Set(values).size, values.length, `${label} must be unique`);
  for (const value of values) {
    assert(value.trim().length > 0, `${label} must not contain empty values`);
  }
}

function rejectCompositeScore(value: unknown, location = "suite") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !["weight", "overallScore", "compositeScore"].includes(key),
      `${location}.${key} is forbidden; dimensions must remain separate`,
    );
    rejectCompositeScore(child, `${location}.${key}`);
  }
}

export function validateProductBenchmarkSuite(
  input: unknown,
): asserts input is ProductBenchmarkSuite {
  assert(input && typeof input === "object", "suite must be an object");
  const suite = input as ProductBenchmarkSuite;
  assert.equal(suite.contractVersion, 1);
  assert.equal(suite.id, "witch.product-benchmark/v1");
  assert.equal(suite.policy.aggregation, "separate-dimensions");
  assert(suite.policy.comparisonUnit.includes("product-build"));
  unique(suite.policy.evidenceLevels, "evidence levels");
  assert.deepEqual(suite.policy.evidenceLevels, [
    "documented",
    "observed",
    "measured",
  ]);
  unique(suite.policy.resultStates, "result states");
  unique(suite.toolClasses, "tool classes");
  assert(suite.dimensions.length >= 6, "at least six dimensions are required");
  unique(
    suite.dimensions.map((dimension) => dimension.id),
    "dimension ids",
  );
  const dimensionIds = new Set(suite.dimensions.map((item) => item.id));
  const metricIds: string[] = [];
  for (const dimension of suite.dimensions) {
    assert(dimension.title && dimension.question);
    assert(dimension.metrics.length > 0, `${dimension.id} requires metrics`);
    for (const metric of dimension.metrics) {
      assert(["higher", "lower"].includes(metric.direction));
      assert(metric.unit.trim().length > 0);
      metricIds.push(metric.id);
    }
  }
  unique(metricIds, "metric ids");
  unique(
    suite.lanes.map((lane) => lane.id),
    "lane ids",
  );
  for (const lane of suite.lanes) {
    assert(lane.title);
    assert(lane.dimensionIds.length > 0, `${lane.id} requires dimensions`);
    for (const id of lane.dimensionIds) {
      assert(
        dimensionIds.has(id),
        `${lane.id} references unknown dimension ${id}`,
      );
    }
    if (lane.maturity === "automated") {
      assert(lane.commands.length > 0, `${lane.id} requires a command`);
    }
  }
  unique(
    suite.externalAdapters.map((adapter) => adapter.id),
    "external adapter ids",
  );
  for (const adapter of suite.externalAdapters) {
    assert(adapter.scope);
    assert(adapter.url.startsWith("https://"));
    assert(adapter.applicability.length > 0);
    for (const toolClass of adapter.applicability) {
      assert(
        suite.toolClasses.includes(toolClass),
        `${adapter.id} references unknown tool class ${toolClass}`,
      );
    }
  }
  rejectCompositeScore(suite);
}

export async function readProductBenchmarkSuite(file: string) {
  const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
  validateProductBenchmarkSuite(parsed);
  return parsed;
}

async function main() {
  const file = path.resolve(
    process.argv[2] || "benchmarks/product/suite-v1.json",
  );
  const suite = await readProductBenchmarkSuite(file);
  process.stdout.write(
    `Product benchmark contract valid: ${suite.dimensions.length} dimensions, ${suite.lanes.length} lanes, ${suite.externalAdapters.length} external adapters.\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
