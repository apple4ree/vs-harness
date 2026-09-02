import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  normalizeOracleSymbol,
  resolveBenchmarkPath,
} from "../scripts/benchmark-callgraph";

test("normalizes DyPyBench checkout and src prefixes against Witch declarations", () => {
  const declared = new Set(["click.core.Context.invoke"]);
  assert.equal(
    normalizeOracleSymbol(
      ".DyPyBench.temp.project10.src.click.core.Context.invoke",
      "dypybench-dynapyt",
      declared,
      ["src"],
    ),
    "click.core.Context.invoke",
  );
});

test("removes package __init__ without erasing constructor symbols", () => {
  const declared = new Set(["schedule.Job.__init__"]);
  assert.equal(
    normalizeOracleSymbol(
      ".DyPyBench.temp.project4.schedule.__init__.Job.__init__",
      "dypybench-dynapyt",
      declared,
    ),
    "schedule.Job.__init__",
  );
});

test("leaves ordinary adjacency-list names unchanged", () => {
  assert.equal(
    normalizeOracleSymbol("package.module.function", "adjacency", new Set()),
    "package.module.function",
  );
});

test("benchmark paths allow dotted children but reject corpus escapes", () => {
  const root = path.resolve("benchmark-root");
  assert.equal(
    resolveBenchmarkPath(root, ".fixtures/case"),
    path.join(root, ".fixtures/case"),
  );
  assert.throws(
    () => resolveBenchmarkPath(root, "../outside"),
    /escapes its corpus root/,
  );
  assert.throws(
    () => resolveBenchmarkPath(root, path.resolve("outside")),
    /non-empty and relative/,
  );
});
