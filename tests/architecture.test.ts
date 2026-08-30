import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";

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
    '// import ghost from "./ghost"\nimport { calculate, Calculator } from "@/model"\nexport function View() { const calculator = new Calculator(); return <div>{calculate()}{calculator.calculateMember()}</div> }\n',
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
