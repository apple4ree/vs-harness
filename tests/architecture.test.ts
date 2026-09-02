import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  analyzeRepository,
  type ArchitectureCache,
} from "../apps/desktop/src/main/services/architecture";
import type { CodeSymbol } from "../apps/desktop/src/shared/architecture";

test("AST graph resolves aliases, re-exports and JSX components with source evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-graph-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    }),
  );
  await fs.writeFile(
    path.join(root, "src", "model.ts"),
    "export const answer = 42\nexport function calculate() { return answer }\nexport class Calculator { calculateMember() { return answer } }\n",
  );
  await fs.writeFile(
    path.join(root, "src", "View.tsx"),
    '// import ghost from "./ghost"\nimport { calculate, Calculator, answer } from "@/model"\nexport function View() { const calculator = new Calculator(); return <div>{answer}{calculate()}{calculator.calculateMember()}</div> }\n',
  );
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    'export { View } from "./View"\n',
  );
  const graph = await analyzeRepository(root);
  assert(
    graph.nodes
      .find((node) => node.id === "src/View.tsx")
      ?.symbols.some(
        (symbol) => symbol.name === "View" && symbol.kind === "component",
      ),
  );
  const edge = graph.edges.find(
    (edge) => edge.from === "src/View.tsx" && edge.to === "src/model.ts",
  );
  assert.equal(edge?.evidence[0].line, 2);
  assert(
    graph.edges.some(
      (edge) => edge.kind === "exports" && edge.to === "src/View.tsx",
    ),
  );
  const viewSymbol = graph.nodes
    .find((node) => node.id === "src/View.tsx")!
    .symbols.find((symbol) => symbol.name === "View")!;
  const calculateSymbol = graph.nodes
    .find((node) => node.id === "src/model.ts")!
    .symbols.find((symbol) => symbol.name === "calculate")!;
  const call = graph.semantic?.relations.find(
    (relation) =>
      relation.kind === "calls" &&
      relation.from === `semantic:symbol:${viewSymbol.id}` &&
      relation.to === `semantic:symbol:${calculateSymbol.id}`,
  );
  assert.equal(call?.trust, "verified");
  assert.equal(call?.evidence[0].line, 3);
  const answerSymbol = graph.nodes
    .find((node) => node.id === "src/model.ts")!
    .symbols.find((symbol) => symbol.name === "answer")!;
  assert(
    graph.semantic?.relations.some(
      (relation) =>
        relation.kind === "reads" &&
        relation.from === `semantic:symbol:${viewSymbol.id}` &&
        relation.to === `semantic:symbol:${answerSymbol.id}` &&
        relation.trust === "verified",
    ),
    "resolved imported module variables should remain eligible read targets",
  );
  const member = graph.nodes
    .find((node) => node.id === "src/model.ts")!
    .symbols.find((symbol) => symbol.name === "calculateMember")!;
  assert(
    !graph.semantic?.relations.some(
      (relation) =>
        relation.kind === "calls" &&
        relation.to === `semantic:symbol:${member.id}`,
    ),
  );
  assert(!graph.warnings.some((warning) => warning.includes("ghost")));
  const oldRevision = graph.revision;
  await fs.writeFile(
    path.join(root, "src", "model.ts"),
    "export const answer = 43\nexport function calculate() { return answer }\nexport class Calculator { calculateMember() { return answer } }\n",
  );
  const updated = await analyzeRepository(root);
  assert.notEqual(updated.revision, oldRevision);
  assert.deepEqual(
    updated.nodes.map((node) => node.id),
    graph.nodes.map((node) => node.id),
  );
  const cache = new Map();
  const cached = await analyzeRepository(root, { cache });
  assert.equal(cached.revision, updated.revision);
  assert.equal(
    (await analyzeRepository(root, { cache })).revision,
    cached.revision,
  );
  const bounded = await analyzeRepository(root, { byteBudget: 1 });
  assert(bounded.truncated);
  assert(bounded.warnings.some((warning) => warning.includes("safety budget")));
});

test("same-line JavaScript declarations receive unique ids and exact call bindings", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-js-symbol-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "src", "compact.js"),
    [
      "function alpha() { return 1 } function beta() { return 2 }",
      "const first = class { shared() { return alpha() } }; const second = class { shared() { return beta() } };",
      "const lexer = class { parse() { return alpha() } parse(value) { return beta() + value } };",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const file = graph.nodes.find((node) => node.id === "src/compact.js")!;
  const ids = file.symbols.map((symbol) => symbol.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(graph.semantic?.validation.valid, true);

  const shared = file.symbols.filter((symbol) => symbol.name === "shared");
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].id, shared[1].id);
  assert.deepEqual(
    shared.map((symbol) => symbol.qualifiedName),
    ["first.shared", "second.shared"],
  );
  assert(shared.every((symbol) => symbol.column && symbol.startOffset));

  const parse = file.symbols.filter((symbol) => symbol.name === "parse");
  assert.equal(parse.length, 2);
  assert.notEqual(parse[0].id, parse[1].id);
  assert(parse.every((symbol) => symbol.qualifiedName === "lexer.parse"));

  const alpha = file.symbols.find((symbol) => symbol.name === "alpha")!;
  const beta = file.symbols.find((symbol) => symbol.name === "beta")!;
  const calls = graph.semantic!.relations.filter(
    (relation) => relation.kind === "calls",
  );
  assert(
    calls.some(
      (relation) =>
        relation.from === `semantic:symbol:${shared[0].id}` &&
        relation.to === `semantic:symbol:${alpha.id}`,
    ),
  );
  assert(
    calls.some(
      (relation) =>
        relation.from === `semantic:symbol:${shared[1].id}` &&
        relation.to === `semantic:symbol:${beta.id}`,
    ),
  );
  assert(
    graph.warnings.some((warning) =>
      warning.includes("same-line symbol id collisions"),
    ),
  );
});

test("TypeScript hierarchy resolves internal extends, implements, and overrides with evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-ts-types-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "src", "types.ts"),
    [
      "export interface Runnable { run(): void }",
      "export interface RichRunnable extends Runnable { rich(): void }",
      "export let runCount = 0",
      "export class BaseRunner { run(): void {} }",
      "export class AgentRunner extends BaseRunner implements Runnable {",
      "  override run(): void { runCount += 1; console.log(runCount) }",
      "}",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const file = graph.nodes.find((node) => node.id === "src/types.ts")!;
  const byName = (name: string, containerId?: string) =>
    file.symbols.find(
      (symbol) =>
        symbol.name === name &&
        (containerId === undefined || symbol.containerId === containerId),
    )!;
  const runnable = byName("Runnable");
  const rich = byName("RichRunnable");
  const base = byName("BaseRunner");
  const child = byName("AgentRunner");
  const state = byName("runCount");
  const baseRun = byName("run", base.id);
  const childRun = byName("run", child.id);
  const relations = graph.semantic!.relations;
  const has = (kind: string, from: CodeSymbol, to: CodeSymbol) =>
    relations.some(
      (relation) =>
        relation.kind === kind &&
        relation.from === `semantic:symbol:${from.id}` &&
        relation.to === `semantic:symbol:${to.id}` &&
        relation.trust === "verified" &&
        relation.evidence.length > 0,
    );
  assert(has("extends", rich, runnable), "interface extends relation");
  assert(has("extends", child, base), "class extends relation");
  assert(has("implements", child, runnable), "class implements relation");
  assert(has("overrides", childRun, baseRun), "method overrides relation");
  assert(has("reads", childRun, state), "module state read relation");
  assert(has("writes", childRun, state), "module state write relation");
});

test("a residual duplicate symbol id is isolated to its file", async (t) => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-symbol-safety-test-"),
  );
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "src", "safe.js"),
    "export function safe() { return true }\n",
  );
  const cache: ArchitectureCache = new Map();
  await analyzeRepository(root, { cache });
  const cached = cache.get("src/safe.js")!;
  cached.symbols = [cached.symbols[0], { ...cached.symbols[0] }];

  const graph = await analyzeRepository(root, { cache });
  assert.equal(
    graph.nodes.find((node) => node.id === "src/safe.js")?.symbols.length,
    0,
  );
  assert.equal(graph.semantic?.validation.valid, true);
  assert(
    graph.warnings.some(
      (warning) =>
        warning.includes("symbol-level analysis was isolated") &&
        warning.includes("file and import structure remain available"),
    ),
  );
});

test("analysis coverage separates deep semantics from file-only languages and reports cache reuse", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-coverage-test-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"));
  await fs.writeFile(
    path.join(root, "src", "agent.py"),
    "def main():\n    return True\n",
  );
  await fs.writeFile(
    path.join(root, "src", "Ledger.java"),
    "final class Ledger {}\n",
  );
  await fs.writeFile(path.join(root, "README.md"), "# Fixture\n");
  const cache: ArchitectureCache = new Map();
  const first = await analyzeRepository(root, { cache });
  assert.equal(first.coverage?.indexedFiles, 3);
  assert.equal(first.coverage?.deepFiles, 1);
  assert.equal(first.coverage?.fileOnlyFiles, 2);
  assert.equal(
    first.coverage?.languages.find((item) => item.language === "java")?.mode,
    "file-only",
  );
  assert.equal(
    first.coverage?.languages.find((item) => item.language === "python")?.mode,
    "deep",
  );
  const second = await analyzeRepository(root, { cache });
  assert.equal(second.revision, first.revision);
  assert.equal(second.coverage?.cache.memoryHits, 3);
  assert.equal(second.coverage?.cache.misses, 0);
});
