import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import type { CodeSymbol } from "../apps/desktop/src/shared/architecture";

async function project(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-call-flow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "__init__.py"), "");
  await fs.writeFile(
    path.join(root, "src", "targets.py"),
    [
      "def exact_call():",
      "    return True",
      "",
      "def dynamic_call():",
      "    return False",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "agent.py"),
    [
      "from .targets import exact_call as check_order",
      "",
      "async def run_agent(client):",
      '    \"\"\"ignored_call()\"\"\"',
      "    # ignored_call()",
      "    check_order()",
      "    if approved:",
      "        check_order()",
      "    else:",
      "        client.dynamic_call()",
      "    for retry_attempt in range(1, 3):",
      "        check_order()",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "base.py"),
    [
      "class BaseAgent:",
      "    def execute(self):",
      "        return False",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "types.py"),
    [
      "from .base import BaseAgent as InternalBase",
      "",
      "class TradingAgent(InternalBase):",
      "    def execute(self):",
      "        return True",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "worker.rs"),
    ["pub fn exact_call() {}", "pub fn dynamic_call() {}", ""].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "lib.rs"),
    [
      "mod worker;",
      "use crate::worker::exact_call as imported_call;",
      "",
      "pub fn run(client: &Client) {",
      "    // ignored_call();",
      '    let ignored = \"ignored_call()\";',
      "    imported_call();",
      "    if approved {",
      "        imported_call();",
      "    } else {",
      "        client.dynamic_call();",
      "    }",
      "    for retry_attempt in 1..=4 {",
      "        imported_call();",
      "    }",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "src", "types.rs"),
    [
      "pub trait Runner {",
      "    fn run(&self);",
      "}",
      "pub struct Worker;",
      "impl Runner for Worker {",
      "    fn run(&self) {}",
      "}",
      "",
    ].join("\n"),
  );
  return root;
}

test("Python and Rust calls stay conservative while branch and retry controls retain evidence", async (t) => {
  const root = await project(t);
  const graph = await analyzeRepository(root);
  const semantic = graph.semantic!;
  assert.equal(semantic.validation.valid, true);

  const pythonRun = graph.nodes
    .find((node) => node.id === "src/agent.py")!
    .symbols.find((symbol) => symbol.name === "run_agent")!;
  const pythonExact = graph.nodes
    .find((node) => node.id === "src/targets.py")!
    .symbols.find((symbol) => symbol.name === "exact_call")!;
  const rustRun = graph.nodes
    .find((node) => node.id === "src/lib.rs")!
    .symbols.find((symbol) => symbol.name === "run")!;
  const rustExact = graph.nodes
    .find((node) => node.id === "src/worker.rs")!
    .symbols.find((symbol) => symbol.name === "exact_call")!;

  const calls = semantic.relations.filter(
    (relation) => relation.kind === "calls",
  );
  assert(
    calls.some(
      (relation) =>
        relation.from === `semantic:symbol:${pythonRun.id}` &&
        relation.to === `semantic:symbol:${pythonExact.id}` &&
        relation.trust === "inferred" &&
        relation.evidence.map((item) => item.line).join(",") === "6,8,12",
    ),
  );
  assert(
    calls.some(
      (relation) =>
        relation.from === `semantic:symbol:${rustRun.id}` &&
        relation.to === `semantic:symbol:${rustExact.id}` &&
        relation.trust === "inferred" &&
        relation.evidence.map((item) => item.line).join(",") === "7,9,14",
    ),
    JSON.stringify(calls),
  );
  assert.equal(
    calls.some((relation) =>
      semantic.nodes
        .find((node) => node.id === relation.to)
        ?.label.includes("dynamic_call"),
    ),
    false,
    "arbitrary instance dispatch must not become a call edge",
  );
  assert.equal(
    calls.some((relation) =>
      relation.evidence.some((item) => item.excerpt?.includes("ignored_call")),
    ),
    false,
    "comments and strings must not become call evidence",
  );

  const branches = semantic.relations.filter(
    (relation) => relation.kind === "branches-to",
  );
  const retries = semantic.relations.filter(
    (relation) => relation.kind === "retries",
  );
  assert(
    branches.some((relation) => relation.evidence[0].path === "src/agent.py"),
  );
  assert(
    branches.some((relation) => relation.evidence[0].path === "src/lib.rs"),
  );
  assert(
    retries.some((relation) => relation.description?.includes("2 attempts")),
  );
  assert(
    retries.some((relation) => relation.description?.includes("4 attempts")),
  );
  assert(
    semantic.relations.some(
      (relation) =>
        relation.kind === "precedes" &&
        relation.status === "provisional" &&
        Boolean(relation.description),
    ),
  );
});

test("Python and Rust type hierarchy keeps conservative trust and source evidence", async (t) => {
  const root = await project(t);
  const graph = await analyzeRepository(root);
  const semantic = graph.semantic!;
  const python = graph.nodes.find((node) => node.id === "src/types.py")!;
  const baseNode = graph.nodes.find((node) => node.id === "src/base.py")!;
  const base = baseNode.symbols.find((symbol) => symbol.name === "BaseAgent")!;
  const child = python.symbols.find(
    (symbol) => symbol.name === "TradingAgent",
  )!;
  const baseExecute = baseNode.symbols.find(
    (symbol) => symbol.name === "execute" && symbol.containerId === base.id,
  )!;
  const childExecute = python.symbols.find(
    (symbol) => symbol.name === "execute" && symbol.containerId === child.id,
  )!;
  const rust = graph.nodes.find((node) => node.id === "src/types.rs")!;
  const trait = rust.symbols.find((symbol) => symbol.name === "Runner")!;
  const implementation = rust.symbols.find(
    (symbol) => symbol.kind === "implementation",
  )!;
  const traitRun = rust.symbols.find(
    (symbol) => symbol.name === "run" && symbol.containerId === trait.id,
  )!;
  const implementationRun = rust.symbols.find(
    (symbol) =>
      symbol.name === "run" && symbol.containerId === implementation.id,
  )!;
  const relation = (kind: string, from: CodeSymbol, to: CodeSymbol) =>
    semantic.relations.find(
      (item) =>
        item.kind === kind &&
        item.from === `semantic:symbol:${from.id}` &&
        item.to === `semantic:symbol:${to.id}`,
    );
  assert.equal(relation("extends", child, base)?.trust, "inferred");
  assert.equal(
    relation("overrides", childExecute, baseExecute)?.evidence[0].line,
    childExecute.line,
  );
  assert.equal(
    relation("implements", implementation, trait)?.trust,
    "inferred",
  );
  assert.equal(
    relation("implements", implementationRun, traitRun)?.evidence[0].line,
    implementationRun.line,
  );
});

test("Python and JavaScript propagate callable arguments through stable aliases", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-callable-flow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "main.py"),
    [
      "def callback():",
      "    return True",
      "",
      "def invoke(action):",
      "    return action()",
      "",
      "alias = callback",
      "invoke(alias)",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "main.js"),
    [
      "function callbackJs() { return true; }",
      "function invokeJs(action) { return action(); }",
      "const aliasJs = callbackJs;",
      "invokeJs(aliasJs);",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const python = graph.nodes.find((node) => node.id === "main.py")!;
  const javascript = graph.nodes.find((node) => node.id === "main.js")!;
  const pythonCallback = python.symbols.find(
    (symbol) => symbol.name === "callback",
  )!;
  const pythonInvoke = python.symbols.find(
    (symbol) => symbol.name === "invoke",
  )!;
  const jsCallback = javascript.symbols.find(
    (symbol) => symbol.name === "callbackJs",
  )!;
  const jsInvoke = javascript.symbols.find(
    (symbol) => symbol.name === "invokeJs",
  )!;
  const call = (from: CodeSymbol, to: CodeSymbol) =>
    graph.semantic!.relations.find(
      (relation) =>
        relation.kind === "calls" &&
        relation.from === `semantic:symbol:${from.id}` &&
        relation.to === `semantic:symbol:${to.id}`,
    );

  assert.equal(call(pythonInvoke, pythonCallback)?.trust, "inferred");
  assert.equal(call(pythonInvoke, pythonCallback)?.evidence[0].line, 5);
  assert.equal(call(jsInvoke, jsCallback)?.trust, "inferred");
  assert.equal(call(jsInvoke, jsCallback)?.evidence[0].line, 2);
});

test("Python self aliases and TypeScript-resolved properties remain bounded inferred calls", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-property-flow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "worker.py"),
    [
      "class Worker:",
      "    def target(self):",
      "        return True",
      "",
      "    def invoke(self):",
      "        alias = self",
      "        return alias.target()",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(root, "worker.ts"),
    [
      "export class WorkerTs {",
      "  target() { return true; }",
      "  invoke() {",
      "    const alias = this;",
      "    return alias.target();",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const relation = (file: string, fromName: string, toName: string) => {
    const node = graph.nodes.find((candidate) => candidate.id === file)!;
    const from = node.symbols.find((symbol) => symbol.name === fromName)!;
    const to = node.symbols.find((symbol) => symbol.name === toName)!;
    return graph.semantic!.relations.find(
      (candidate) =>
        candidate.kind === "calls" &&
        candidate.from === `semantic:symbol:${from.id}` &&
        candidate.to === `semantic:symbol:${to.id}`,
    );
  };

  assert.equal(relation("worker.py", "invoke", "target")?.trust, "inferred");
  assert.equal(relation("worker.py", "invoke", "target")?.evidence[0].line, 7);
  assert.equal(relation("worker.ts", "invoke", "target")?.trust, "inferred");
  assert.equal(relation("worker.ts", "invoke", "target")?.evidence[0].line, 5);
});

test("Python MRO, decorator composition, and returned callables retain bounded targets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-python-flow-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(
    path.join(root, "main.py"),
    [
      "def leaf():",
      "    return True",
      "",
      "def factory():",
      "    return leaf",
      "",
      "def invoke():",
      "    selected = factory()",
      "    selected()",
      "    factory()()",
      "",
      "def d1(fn):",
      "    def wrapper1():",
      "        return fn()",
      "    return wrapper1",
      "",
      "def d2(fn):",
      "    def wrapper2():",
      "        return fn()",
      "    return wrapper2",
      "",
      "@d1",
      "@d2",
      "def decorated():",
      "    return leaf()",
      "",
      "def run_decorated():",
      "    decorated()",
      "",
      "class Base:",
      "    def execute(self):",
      "        self.hook()",
      "",
      "class Child(Base):",
      "    def hook(self):",
      "        return True",
      "",
      "    def relay(self):",
      "        super().execute()",
      "",
    ].join("\n"),
  );

  const graph = await analyzeRepository(root);
  const node = graph.nodes.find((candidate) => candidate.id === "main.py")!;
  const symbol = (qualifiedName: string) =>
    node.symbols.find((candidate) => candidate.qualifiedName === qualifiedName)!;
  const call = (from: CodeSymbol, to: CodeSymbol) =>
    graph.semantic!.relations.find(
      (relation) =>
        relation.kind === "calls" &&
        relation.from === `semantic:symbol:${from.id}` &&
        relation.to === `semantic:symbol:${to.id}`,
    );

  assert.deepEqual(
    call(symbol("invoke"), symbol("leaf"))?.evidence.map((item) => item.line),
    [9, 10],
  );
  assert.equal(
    call(symbol("run_decorated"), symbol("d1.wrapper1"))?.trust,
    "inferred",
  );
  assert.equal(
    call(symbol("d1.wrapper1"), symbol("d2.wrapper2"))?.trust,
    "inferred",
  );
  assert.equal(
    call(symbol("d2.wrapper2"), symbol("decorated"))?.trust,
    "inferred",
  );
  assert.equal(
    call(symbol("Base.execute"), symbol("Child.hook"))?.trust,
    "inferred",
  );
  assert.equal(
    call(symbol("Child.relay"), symbol("Base.execute"))?.trust,
    "inferred",
  );
});
