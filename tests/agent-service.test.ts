import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentService } from "../apps/desktop/src/main/services/agent-service";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import type { AgentRun } from "../apps/desktop/src/shared/agent";

function until(service: AgentService, predicate: (run: AgentRun) => boolean) {
  return new Promise<AgentRun>((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off("event", listener);
      reject(new Error("Agent test timed out"));
    }, 10_000);
    const listener = ({ run }: { run: AgentRun }) => {
      if (predicate(run)) {
        clearTimeout(timer);
        service.off("event", listener);
        resolve(run);
      }
    };
    service.on("event", listener);
  });
}
test("agent protocol yields a persisted review without editing the original", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-test-"),
  );
  t.after(() =>
    fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    }),
  );
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "greeting.ts"),
    'export const greeting = "Hello";\n',
  );
  const graph = await analyzeRepository(root);
  const options = {
    dataDirectory: path.join(directory, "runs"),
    command: () => process.execPath,
    version: "test",
    serverArguments: [path.resolve("tests/fixtures/fake-codex.mjs")],
  };
  const service = new AgentService(options);
  t.after(() => service.stop());
  const completed = until(service, (run) =>
    ["review", "completed", "failed"].includes(run.status),
  );
  const started = await service.start(root, graph, {
    mode: "change",
    prompt: "Change the greeting",
    contexts: [
      {
        nodeId: "greeting.ts",
        label: "untrusted label",
        paths: ["../outside"],
        revision: graph.revision,
      },
    ],
  });
  assert.deepEqual(started.contexts[0].paths, ["greeting.ts"]);
  const result = await completed;
  assert.equal(result.status, "review", result.error);
  assert.equal(result.response, "Fixture complete.");
  assert.equal(result.changes.length, 1);
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Hello/,
  );
  const reopened = new AgentService(options);
  const history = await reopened.list(root);
  assert.equal(history[0].status, "review");
  await reopened.apply(root, result.id, ["greeting.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Welcome to Witch/,
  );
  await assert.rejects(
    reopened.start(root, graph, {
      mode: "ask",
      prompt: "why",
      contexts: [{ ...started.contexts[0], revision: "stale" }],
    }),
    /older graph/,
  );
  const running = until(service, (run) => run.status === "running");
  await service.start(root, await analyzeRepository(root), {
    mode: "ask",
    prompt: "WAIT_FOREVER",
    contexts: [],
  });
  await running;
  const stopped = until(service, (run) => run.status === "interrupted");
  await service.stop();
  await stopped;
  assert.equal(service.isRunning(), false);
  const edited = until(service, (run) =>
    run.activity.some((line) => line.includes("Editing: greeting.ts")),
  );
  const partial = await service.start(root, await analyzeRepository(root), {
    mode: "change",
    prompt: "PARTIAL_EDIT",
    contexts: [],
  });
  await edited;
  await service.stop();
  const recovered = (await service.list(root)).find(
    (run) => run.id === partial.id,
  )!;
  assert.equal(recovered.status, "review", recovered.error);
  assert.match(recovered.error!, /partial changes/);
  assert.equal(recovered.changes.length, 1);
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Welcome to Witch/,
  );
  await service.apply(root, partial.id, ["greeting.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Partial edit/,
  );
});

test("corrupt agent history is reported and never overwritten by a new run", async (t) => {
  const dataDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-history-"),
  );
  t.after(() => fs.rm(dataDirectory, { recursive: true, force: true }));
  const target = path.join(dataDirectory, "history.json");
  await fs.writeFile(target, "truncated history");
  const service = new AgentService({
    dataDirectory,
    command: () => null,
    version: "test",
  });
  await assert.rejects(
    service.list(dataDirectory),
    /original file is retained/,
  );
  assert.equal(await fs.readFile(target, "utf8"), "truncated history");
  await fs.writeFile(target, "[]");
  assert.deepEqual(await service.list(dataDirectory), []);
});

test("validated semantic workflows become authoritative Agent dossiers", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-semantic-agent-"),
  );
  t.after(() =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "agent.py"),
    "@agent.command()\nasync def run_agent():\n    return True\n",
  );
  const graph = await analyzeRepository(root);
  const workflow = graph.semantic!.nodes.find(
    (node) => node.kind === "workflow",
  )!;
  assert(workflow);
  const service = new AgentService({
    dataDirectory: path.join(directory, "runs"),
    command: () => process.execPath,
    version: "test",
    serverArguments: [path.resolve("tests/fixtures/fake-codex.mjs")],
  });
  t.after(() => service.stop());
  const completed = until(service, (run) => run.status === "completed");
  const started = await service.start(root, graph, {
    mode: "ask",
    prompt: "SEMANTIC_CONTEXT explain this workflow",
    contexts: [
      {
        nodeId: workflow.id,
        label: "untrusted label",
        paths: ["untrusted semantic path"],
        revision: graph.revision,
      },
    ],
  });
  assert.equal(started.contexts[0].label, workflow.label);
  assert.deepEqual(started.contexts[0].paths, ["agent.py"]);
  assert.deepEqual(started.contexts[0].semantic, {
    kind: "workflow",
    trust: "inferred",
    status: "provisional",
    confidence: workflow.confidence,
  });
  const result = await completed;
  assert.equal(result.status, "completed", result.error);
});

test("archiving a review preserves source, staged files and the full pending diff", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-archive-test-"),
  );
  t.after(() =>
    fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    }),
  );
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  const original = 'export const greeting = "Hello";\n';
  await fs.writeFile(path.join(root, "greeting.ts"), original);
  const options = {
    dataDirectory: path.join(directory, "runs"),
    command: () => process.execPath,
    version: "test",
    serverArguments: [path.resolve("tests/fixtures/fake-codex.mjs")],
  };
  const service = new AgentService(options);
  t.after(() => service.stop());
  const finished = until(service, (run) =>
    ["review", "failed"].includes(run.status),
  );
  const started = await service.start(root, await analyzeRepository(root), {
    mode: "change",
    prompt: "Change the greeting",
    contexts: [],
  });
  const review = await finished;
  assert.equal(review.status, "review", review.error);
  await assert.rejects(
    service.archive(directory, started.id),
    /no pending review/,
  );
  const historyPath = path.join(options.dataDirectory, "history.json");
  const savedHistoryPath = historyPath + ".test-backup";
  await fs.rename(historyPath, savedHistoryPath);
  await fs.mkdir(historyPath);
  try {
    await assert.rejects(
      service.archive(root, started.id),
      /review is still active/,
    );
    const retained = (await service.list(root))[0];
    assert.equal(retained.status, "review");
    assert.deepEqual(retained.changes, review.changes);
    assert.equal(retained.archivePath, undefined);
    assert.equal(
      await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
      original,
    );
  } finally {
    await fs.rmdir(historyPath);
    await fs.rename(savedHistoryPath, historyPath);
  }
  const archived = await service.archive(root, started.id);
  assert.equal(archived.status, "archived");
  assert.deepEqual(archived.changes, []);
  assert.equal(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    original,
  );
  const snapshot = JSON.parse(await fs.readFile(archived.archivePath!, "utf8"));
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.run.changes, review.changes);
  assert.equal(snapshot.run.changes[0].before, original);
  assert.equal(
    await fs.readFile(path.join(archived.stagingRoot!, "greeting.ts"), "utf8"),
    snapshot.run.changes[0].after,
  );
  await assert.rejects(
    service.apply(root, started.id, ["greeting.ts"]),
    /not ready for review/,
  );
  await assert.rejects(service.archive(root, started.id), /no pending review/);
  const reopened = (await new AgentService(options).list(root))[0];
  assert.equal(reopened.status, "archived");
  assert.equal(reopened.archivePath, archived.archivePath);
});
