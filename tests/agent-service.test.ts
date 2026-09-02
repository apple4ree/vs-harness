import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import {
  AgentHost,
  AgentService,
} from "../apps/desktop/src/main/services/agent-service";
import type { AgentProviderAdapter } from "../apps/desktop/src/main/services/agent-provider";
import { ClaudeCodeAgentAdapter } from "../apps/desktop/src/main/services/claude-code-agent-adapter";
import { EngineeringRunJournal } from "../apps/desktop/src/main/services/engineering-run-journal";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import { contentHash } from "../apps/desktop/src/main/services/workspace-files";
import type { AgentRun } from "../apps/desktop/src/shared/agent";
import { defaultRunBudget } from "../apps/desktop/src/shared/engineering-run";

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

function changeProvider(
  execute: AgentProviderAdapter["execute"],
): AgentProviderAdapter {
  return {
    id: "codex",
    descriptor: () => ({
      id: "codex",
      label: "Repair Fixture",
      available: true,
      message: "Repair fixture ready",
      capabilities: {
        modes: ["change"],
        streaming: true,
        toolEvents: false,
        fileChanges: true,
        approvals: false,
        questions: false,
        sessionResume: false,
        fork: false,
        modelSelection: false,
        thinkingSelection: false,
        permissionModes: false,
      },
    }),
    isConnected: () => false,
    execute,
    stop: async () => undefined,
  };
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
  const analysisCalls: string[][] = [];
  const options = {
    dataDirectory: path.join(directory, "runs"),
    command: () => process.execPath,
    version: "test",
    serverArguments: [path.resolve("tests/fixtures/fake-codex.mjs")],
    onApplied: async (
      _root: string,
      paths: string[],
      sourceRevision: string,
    ) => {
      analysisCalls.push(paths);
      return {
        status: "completed" as const,
        beforeRevision: sourceRevision,
        afterRevision: `analysis:${analysisCalls.length}`,
        invalidatedPaths: [...paths],
        changedNodes: paths.length,
        changedRelations: 0,
        completedAt: new Date().toISOString(),
      };
    },
  };
  const service = new AgentService(options);
  t.after(() => service.stop());
  assert.deepEqual(service.status(), {
    defaultProviderId: "codex",
    providers: [
      {
        id: "codex",
        label: "Codex",
        available: true,
        message:
          "Codex CLI is installed and available to the Witch Agent Host.",
        capabilities: {
          modes: ["ask", "change"],
          streaming: true,
          toolEvents: true,
          fileChanges: true,
          approvals: false,
          questions: false,
          sessionResume: false,
          fork: false,
          modelSelection: false,
          thinkingSelection: false,
          permissionModes: false,
        },
      },
    ],
  });
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
  assert.equal(started.providerId, "codex");
  assert.equal(started.providerLabel, "Codex");
  const result = await completed;
  assert.equal(result.status, "review", result.error);
  assert.equal(result.response, "Fixture complete.");
  assert.equal(result.changes.length, 1);
  assert.equal(result.engineering?.state, "review-ready");
  assert.equal(result.engineering?.checkpointCount, 2);
  assert.equal(result.engineering?.verificationPassed, 2);
  assert.equal(result.engineering?.verificationFailed, 0);
  assert.deepEqual(result.nativeSession, {
    providerId: "codex",
    sessionId: "fixture-thread",
    turnId: "fixture-turn",
  });
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Hello/,
  );
  const reopened = new AgentService(options);
  const history = await reopened.list(root);
  assert.equal(history[0].status, "review");
  assert.deepEqual(history[0].nativeSession, result.nativeSession);
  await reopened.apply(root, result.id, ["greeting.ts"]);
  assert.deepEqual(analysisCalls[0], ["greeting.ts"]);
  const appliedProjection = await new EngineeringRunJournal(
    path.join(directory, "engineering-runs"),
  ).verify(result.id);
  assert.deepEqual(appliedProjection.analysisUpdates.at(-1), {
    status: "completed",
    beforeRevision: graph.revision,
    afterRevision: "analysis:1",
    invalidatedPaths: ["greeting.ts"],
    changedNodes: 1,
    changedRelations: 0,
    completedAt: appliedProjection.analysisUpdates.at(-1)?.completedAt,
  });
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

test("AgentHost blocks apply when the Engineering Run journal is corrupted", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-journal-guard-"),
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
  const dataDirectory = path.join(directory, "runs");
  const service = new AgentService({
    dataDirectory,
    command: () => process.execPath,
    version: "test",
    serverArguments: [path.resolve("tests/fixtures/fake-codex.mjs")],
  });
  t.after(() => service.stop());
  const completed = until(service, (run) => run.status === "review");
  const started = await service.start(root, await analyzeRepository(root), {
    mode: "change",
    prompt: "Change the greeting",
    contexts: [],
  });
  await completed;
  const eventsPath = path.join(
    path.dirname(dataDirectory),
    "engineering-runs",
    started.id,
    "events.ndjson",
  );
  const tampered = (await fs.readFile(eventsPath, "utf8")).replace(
    "Change the greeting",
    "Tampered instruction",
  );
  await fs.writeFile(eventsPath, tampered);

  await assert.rejects(
    service.apply(root, started.id, ["greeting.ts"]),
    /HASH_MISMATCH/,
  );
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Hello/,
  );
});

test("AgentHost deterministically recovers an executing journal as interrupted after reload", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-reload-recovery-"),
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
  const dataDirectory = path.join(directory, "runs");
  await fs.mkdir(root);
  await fs.mkdir(dataDirectory);
  const createdAt = new Date(Date.now() - 1_000).toISOString();
  const run: AgentRun = {
    id: randomUUID(),
    providerId: "codex",
    providerLabel: "Codex",
    workspaceRoot: root,
    workspaceName: "project",
    prompt: "Inspect the project",
    mode: "ask",
    contexts: [],
    status: "running",
    createdAt,
    response: "",
    activity: [],
    changes: [],
    isolation: "read-only",
  };
  await fs.writeFile(
    path.join(dataDirectory, "history.json"),
    JSON.stringify([run]),
  );
  const journal = new EngineeringRunJournal(
    path.join(path.dirname(dataDirectory), "engineering-runs"),
  );
  await journal.append(
    run.id,
    "run.created",
    {
      contract: "witch.engineering-run/v1",
      schemaVersion: 1,
      runId: run.id,
      workspaceRoot: root,
      workspaceName: run.workspaceName,
      sourceRevision: "sha256:reload-test",
      providerId: run.providerId,
      providerLabel: run.providerLabel,
      mode: run.mode,
      goal: run.prompt,
      createdAt,
      budget: defaultRunBudget(run.mode),
    },
    createdAt,
  );
  await journal.append(run.id, "state.changed", {
    from: "created",
    to: "context-planning",
  });
  await journal.append(run.id, "state.changed", {
    from: "context-planning",
    to: "executing",
  });

  const reopened = new AgentService({
    dataDirectory,
    command: () => null,
  });
  const recovered = (await reopened.list(root))[0];
  assert.equal(recovered.status, "interrupted");
  assert.equal(recovered.engineering?.state, "interrupted");
  assert.equal(recovered.engineering?.healthy, true);
  assert.match(recovered.error || "", /closed before this run finished/);
  assert.equal((await journal.verify(run.id)).state, "interrupted");
});

test("AgentHost routes a run through the selected Provider contract", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-host-test-"),
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
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  const provider: AgentProviderAdapter = {
    id: "claude",
    descriptor: () => ({
      id: "claude",
      label: "Claude Code",
      available: true,
      message: "Test Provider ready",
      capabilities: {
        modes: ["ask"],
        streaming: true,
        toolEvents: false,
        fileChanges: false,
        approvals: false,
        questions: false,
        sessionResume: true,
        fork: false,
        modelSelection: false,
        thinkingSelection: false,
        permissionModes: false,
      },
    }),
    isConnected: () => false,
    execute: async (_input, handlers) => {
      await handlers.onSession({
        providerId: "claude",
        sessionId: "native-claude-session",
        turnId: "native-claude-turn",
      });
      handlers.onEvent({
        type: "message-completed",
        text: "Claude contract response",
      });
      return { status: "completed" };
    },
    stop: async () => undefined,
  };
  const host = new AgentHost({
    dataDirectory: path.join(directory, "runs"),
    providers: [provider],
    defaultProviderId: "claude",
  });
  t.after(() => host.stop());
  const completed = until(host, (run) => run.status === "completed");
  const started = await host.start(root, await analyzeRepository(root), {
    providerId: "claude",
    mode: "ask",
    prompt: "Explain the project",
    contexts: [],
  });
  assert.equal(started.providerId, "claude");
  const result = await completed;
  assert.equal(result.providerLabel, "Claude Code");
  assert.equal(result.response, "Claude contract response");
  assert.deepEqual(result.nativeSession, {
    providerId: "claude",
    sessionId: "native-claude-session",
    turnId: "native-claude-turn",
  });
  await assert.rejects(
    host.start(root, await analyzeRepository(root), {
      providerId: "claude",
      mode: "change",
      prompt: "Change the project",
      contexts: [],
    }),
    /does not support change/,
  );
});

test("Engineering Run repairs a failed isolated verification within its budget", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-repair-"),
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
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  let executions = 0;
  const host = new AgentHost({
    dataDirectory: path.join(directory, "runs"),
    providers: [
      changeProvider(async (input, handlers) => {
        executions++;
        await fs.writeFile(
          path.join(input.cwd, "main.ts"),
          executions === 1
            ? "export const value = ;\n"
            : "export const value = 2;\n",
        );
        handlers.onEvent({
          type: "message-completed",
          text: executions === 1 ? "Initial change" : "Syntax repaired",
        });
        return { status: "completed" };
      }),
    ],
  });
  t.after(() => host.stop());
  const graph = await analyzeRepository(root);
  const finished = until(host, (run) => run.status === "review");
  const started = await host.start(root, graph, {
    mode: "change",
    prompt: "Update the value",
    contexts: [
      {
        nodeId: "main.ts",
        label: "main",
        paths: ["main.ts"],
        revision: graph.revision,
      },
    ],
  });
  const review = await finished;
  assert.equal(executions, 2);
  assert.equal(review.engineering?.repairAttempts, 1);
  assert.equal(review.engineering?.verificationFailed, 0);
  assert.equal(review.engineering?.verificationPassed, 2);
  assert.equal(review.engineering?.checkpointCount, 3);
  assert.equal(review.engineering?.planUnexpectedFiles, 0);
  assert.match(review.response, /Initial change[\s\S]*Syntax repaired/);
  assert.match(review.changes[0]?.after || "", /value = 2/);
  assert.match(await fs.readFile(path.join(root, "main.ts"), "utf8"), /value = 1/);
  const projection = await new EngineeringRunJournal(
    path.join(directory, "engineering-runs"),
  ).verify(started.id);
  assert.equal(projection.repairs.length, 1);
  assert.equal(projection.repairs[0].status, "passed");
  assert.equal(projection.planEvaluations.length, 2);
  assert.equal(projection.repairStopReason, undefined);
});

test("Engineering Run stops repair when the same failure fingerprint repeats", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-repair-repeat-"),
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
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  let executions = 0;
  const host = new AgentHost({
    dataDirectory: path.join(directory, "runs"),
    providers: [
      changeProvider(async (input, handlers) => {
        executions++;
        if (executions === 1)
          await fs.writeFile(
            path.join(input.cwd, "main.ts"),
            "export const value = ;\n",
          );
        handlers.onEvent({
          type: "message-completed",
          text: executions === 1 ? "Initial invalid change" : "No effective repair",
        });
        return { status: "completed" };
      }),
    ],
  });
  t.after(() => host.stop());
  const finished = until(host, (run) => run.status === "review");
  const started = await host.start(root, await analyzeRepository(root), {
    mode: "change",
    prompt: "Make an invalid fixture change",
    contexts: [],
  });
  const review = await finished;
  assert.equal(executions, 2, "the repeated fingerprint must prevent attempt 2");
  assert.equal(review.engineering?.repairAttempts, 1);
  assert.equal(review.engineering?.verificationFailed, 1);
  assert.equal(review.engineering?.repairStopReason, "same-fingerprint");
  const projection = await new EngineeringRunJournal(
    path.join(directory, "engineering-runs"),
  ).verify(started.id);
  assert.equal(projection.repairs[0].status, "failed");
  assert.equal(projection.repairStopReason, "same-fingerprint");
});

test("Engineering Run never exceeds the configured repair budget", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-repair-budget-"),
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
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  let executions = 0;
  const host = new AgentHost({
    dataDirectory: path.join(directory, "runs"),
    providers: [
      changeProvider(async (input, handlers) => {
        executions++;
        await fs.writeFile(
          path.join(input.cwd, "main.ts"),
          `export const value = ; // distinct-${executions}\n`,
        );
        handlers.onEvent({
          type: "message-completed",
          text: `Still invalid ${executions}`,
        });
        return { status: "completed" };
      }),
    ],
  });
  t.after(() => host.stop());
  const finished = until(host, (run) => run.status === "review");
  const started = await host.start(root, await analyzeRepository(root), {
    mode: "change",
    prompt: "Exercise the repair budget",
    contexts: [],
  });
  const review = await finished;
  assert.equal(executions, 3, "initial execution plus two repairs are allowed");
  assert.equal(review.engineering?.repairAttempts, 2);
  assert.equal(review.engineering?.repairStopReason, "budget-exhausted");
  const projection = await new EngineeringRunJournal(
    path.join(directory, "engineering-runs"),
  ).verify(started.id);
  assert.equal(projection.repairs.length, 2);
  assert.equal(projection.usage.repairAttempts, 2);
  assert.equal(projection.budget.maxRepairAttempts, 2);
});

test("Engineering Plan records changes outside an attached file scope", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-plan-scope-"),
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
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  const host = new AgentHost({
    dataDirectory: path.join(directory, "runs"),
    providers: [
      changeProvider(async (input, handlers) => {
        await fs.writeFile(
          path.join(input.cwd, "outside.ts"),
          "export const outside = true;\n",
        );
        handlers.onEvent({ type: "message-completed", text: "Added file" });
        return { status: "completed" };
      }),
    ],
  });
  t.after(() => host.stop());
  const graph = await analyzeRepository(root);
  const finished = until(host, (run) => run.status === "review");
  const started = await host.start(root, graph, {
    mode: "change",
    prompt: "Add a related helper",
    contexts: [
      {
        nodeId: "main.ts",
        label: "main",
        paths: ["main.ts"],
        revision: graph.revision,
      },
    ],
  });
  const review = await finished;
  assert.equal(review.engineering?.planUnexpectedFiles, 1);
  assert(review.activity.some((line) => line.includes("outside the expected")));
  const projection = await new EngineeringRunJournal(
    path.join(directory, "engineering-runs"),
  ).verify(started.id);
  assert.deepEqual(projection.planEvaluations.at(-1)?.unexpectedFiles, [
    "outside.ts",
  ]);
  assert.deepEqual(projection.planEvaluations.at(-1)?.missingFiles, ["main.ts"]);
});

test("two Provider forks retain the same immutable source baseline", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-agent-provider-fork-"),
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
  const dataDirectory = path.join(directory, "runs");
  await fs.mkdir(root);
  await fs.writeFile(path.join(root, "main.ts"), "export const value = 1;\n");
  const inputs: Array<{
    providerId: "codex" | "claude";
    continuation?: "resume" | "fork";
    nativeProvider?: "codex" | "claude";
  }> = [];
  const provider = (id: "codex" | "claude"): AgentProviderAdapter => ({
    id,
    descriptor: () => ({
      id,
      label: id === "codex" ? "Codex Fork Fixture" : "Claude Fork Fixture",
      available: true,
      message: "Fork fixture ready",
      capabilities: {
        modes: ["change"],
        streaming: true,
        toolEvents: false,
        fileChanges: true,
        approvals: false,
        questions: false,
        sessionResume: true,
        fork: true,
        modelSelection: false,
        thinkingSelection: false,
        permissionModes: false,
      },
    }),
    isConnected: () => false,
    execute: async (input, handlers) => {
      inputs.push({
        providerId: id,
        continuation: input.continuation,
        nativeProvider: input.nativeSession?.providerId,
      });
      await handlers.onSession({
        providerId: id,
        sessionId: `${id}-session-${inputs.length}`,
      });
      handlers.onEvent({ type: "message-completed", text: `${id} complete` });
      return { status: "completed" };
    },
    stop: async () => undefined,
  });
  const host = new AgentHost({
    dataDirectory,
    providers: [provider("codex"), provider("claude")],
    defaultProviderId: "codex",
  });
  t.after(() => host.stop());
  const graph = await analyzeRepository(root);
  const parentDone = until(host, (run) => run.status === "completed");
  const parent = await host.start(root, graph, {
    providerId: "codex",
    mode: "change",
    prompt: "Prepare a baseline",
    contexts: [],
  });
  await parentDone;
  const codexDone = until(
    host,
    (run) =>
      run.parentRunId === parent.id &&
      run.providerId === "codex" &&
      run.status === "completed",
  );
  const codexFork = await host.fork(
    root,
    graph,
    parent.id,
    "codex",
    "Try the Codex path",
  );
  await codexDone;
  const claudeDone = until(
    host,
    (run) =>
      run.parentRunId === parent.id &&
      run.providerId === "claude" &&
      run.status === "completed",
  );
  const claudeFork = await host.fork(
    root,
    graph,
    parent.id,
    "claude",
    "Try the Claude path",
  );
  await claudeDone;
  const journal = new EngineeringRunJournal(
    path.join(directory, "engineering-runs"),
  );
  const projections = await Promise.all(
    [parent.id, codexFork.id, claudeFork.id].map((id) => journal.verify(id)),
  );
  assert.deepEqual(
    projections.map((projection) => projection.sourceRevision),
    [graph.revision, graph.revision, graph.revision],
  );
  assert.deepEqual(
    projections.slice(1).map((projection) => projection.parentRunId),
    [parent.id, parent.id],
  );
  const manifests = await Promise.all(
    [parent.id, codexFork.id, claudeFork.id].map(async (id, index) =>
      JSON.parse(
        await fs.readFile(
          path.join(
            dataDirectory,
            id,
            "checkpoints",
            projections[index].checkpointIds[0],
            "manifest.json",
          ),
          "utf8",
        ),
      ),
    ),
  );
  assert.deepEqual(manifests[1].entries, manifests[0].entries);
  assert.deepEqual(manifests[2].entries, manifests[0].entries);
  assert.equal(inputs[1].continuation, "fork");
  assert.equal(inputs[1].nativeProvider, "codex");
  assert.equal(inputs[2].continuation, "fork");
  assert.equal(inputs[2].nativeProvider, undefined);
  const resumedDone = until(
    host,
    (run) =>
      run.parentRunId === parent.id &&
      run.id !== codexFork.id &&
      run.providerId === "codex" &&
      run.status === "completed",
  );
  const resumed = await host.resume(
    root,
    graph,
    parent.id,
    "Continue the native Codex session",
  );
  await resumedDone;
  assert.equal((await journal.verify(resumed.id)).parentRunId, parent.id);
  assert.equal(inputs[3].continuation, "resume");
  assert.equal(inputs[3].nativeProvider, "codex");
});

test("ClaudeCodeAdapter streams a bounded isolated change into Witch review", async (t) => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "witch-claude-adapter-test-"),
  );
  t.after(() =>
    fs.rm(directory, { recursive: true, force: true, maxRetries: 5 }),
  );
  const root = path.join(directory, "project");
  await fs.mkdir(root);
  await fs.writeFile(
    path.join(root, "main.ts"),
    'export const provider = "none";\n',
  );
  const host = new AgentHost({
    dataDirectory: path.join(directory, "runs"),
    defaultProviderId: "claude",
    providers: [
      new ClaudeCodeAgentAdapter({
        command: () => process.execPath,
        authenticated: () => true,
        serverArguments: [path.resolve("tests/fixtures/fake-claude.mjs")],
      }),
    ],
  });
  t.after(() => host.stop());
  const finished = until(host, (run) =>
    ["review", "failed"].includes(run.status),
  );
  await host.start(root, await analyzeRepository(root), {
    providerId: "claude",
    mode: "change",
    prompt: "CLAUDE_CHANGE update the provider",
    contexts: [],
  });
  const review = await finished;
  assert.equal(review.status, "review", review.error);
  assert.equal(review.response, "Claude fixture complete.");
  assert.equal(review.providerId, "claude");
  assert.equal(review.nativeSession?.providerId, "claude");
  assert.match(review.nativeSession?.sessionId || "", /^[a-f0-9-]{36}$/i);
  assert.equal(review.changes.length, 1);
  assert.match(
    await fs.readFile(path.join(root, "main.ts"), "utf8"),
    /provider = "none"/,
  );
  await host.apply(root, review.id, ["main.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "main.ts"), "utf8"),
    /provider = "claude"/,
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
    path.join(root, "agent.ts"),
    "export function submitOrder() { return true }\nexport function bootstrapAgent() { return submitOrder() }\n",
  );
  const graph = await analyzeRepository(root);
  const workflow = graph.semantic!.nodes.find(
    (node) => node.kind === "workflow" && node.label.includes("bootstrapAgent"),
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
  assert.deepEqual(started.contexts[0].paths, ["agent.ts"]);
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
  assert.equal(snapshot.version, 2);
  const { payloadHash, ...archivePayload } = snapshot;
  assert.equal(contentHash(JSON.stringify(archivePayload)), payloadHash);
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
  const archiveContents = await fs.readFile(archived.archivePath!, "utf8");
  await fs.writeFile(
    archived.archivePath!,
    archiveContents.replace("Welcome to Witch", "Tampered archive"),
  );
  await assert.rejects(
    service.restore(root, archived.id),
    /integrity check failed/,
  );
  await fs.writeFile(archived.archivePath!, archiveContents);
  const archivedDigest = archived.engineering?.eventDigest;
  const restored = await service.restore(root, started.id);
  assert.equal(restored.status, "review", restored.error);
  assert.equal(restored.parentRunId, archived.id);
  assert.equal(restored.engineering?.checkpointCount, 2);
  assert.equal(restored.engineering?.verificationFailed, 0);
  assert.equal(restored.engineering?.verificationPassed, 2);
  assert.equal(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    original,
  );
  assert.equal(
    await fs.readFile(path.join(archived.stagingRoot!, "greeting.ts"), "utf8"),
    snapshot.run.changes[0].after,
  );
  assert.equal(
    (await service.list(root)).find((item) => item.id === archived.id)
      ?.engineering?.eventDigest,
    archivedDigest,
  );
  await service.apply(root, restored.id, ["greeting.ts"]);
  assert.match(
    await fs.readFile(path.join(root, "greeting.ts"), "utf8"),
    /Welcome to Witch/,
  );
  const reopened = (await new AgentService(options).list(root)).find(
    (item) => item.id === archived.id,
  )!;
  assert.equal(reopened.status, "archived");
  assert.equal(reopened.archivePath, archived.archivePath);
});
