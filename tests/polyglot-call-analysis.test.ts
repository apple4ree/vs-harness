import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";

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
