import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { AgentRun } from "../apps/desktop/src/shared/agent";
import {
  applyHarnessEvent,
  canTransitionHarnessRun,
  createHarnessEvent,
  hashHarnessPayload,
  projectLegacyAgentRun,
  replayHarnessEvents,
  validateHarnessEvent,
} from "../apps/desktop/src/shared/engineering-run-reducer";
import {
  defaultRunBudget,
  type AnyHarnessEvent,
  type HarnessEvent,
  type HarnessEventPayloads,
  type HarnessEventType,
} from "../apps/desktop/src/shared/engineering-run";

const runId = "11111111-1111-4111-8111-111111111111";
const createdAt = "2026-09-01T00:00:00.000Z";

function event<T extends HarnessEventType>(
  sequence: number,
  type: T,
  payload: HarnessEventPayloads[T],
): HarnessEvent<T> {
  return createHarnessEvent({
    id: `event-${sequence}`,
    runId,
    sequence,
    timestamp: new Date(Date.parse(createdAt) + sequence * 1_000).toISOString(),
    type,
    payload,
  });
}

function createdEvent() {
  return event(1, "run.created", {
    contract: "witch.engineering-run/v1",
    schemaVersion: 1,
    runId,
    workspaceRoot: path.resolve("tests/fixtures/engineering-run"),
    workspaceName: "engineering-run",
    sourceRevision: "source-revision-1",
    providerId: "codex",
    providerLabel: "Codex",
    mode: "change",
    goal: "Add bounded retry verification",
    createdAt,
    budget: defaultRunBudget("change"),
  });
}

test("Engineering Run replay is deterministic and preserves evidence receipts", () => {
  const events: AnyHarnessEvent[] = [
    createdEvent(),
    event(2, "state.changed", {
      from: "created",
      to: "context-planning",
    }),
    event(3, "context.selected", {
      subjectId: "semantic:workflow:retry",
      reason: "user-selected",
      evidenceIds: ["evidence:retry:1"],
      priority: 1_000,
    }),
    event(4, "state.changed", {
      from: "context-planning",
      to: "planning",
    }),
    event(5, "plan.created", {
      plan: {
        objective: "Add bounded retry verification",
        assumptions: ["Existing behavior remains source-grounded"],
        affectedComponents: ["Agent Harness"],
        expectedFiles: ["src/retry.ts", "tests/retry.test.ts"],
        steps: [
          {
            id: "step-1",
            description: "Implement the retry bound",
            expectedOutcome: "Repeated verification failures stop",
          },
        ],
        verification: [
          {
            id: "verify-1",
            kind: "unit-test",
            scope: ["tests/retry.test.ts"],
            required: true,
          },
        ],
        risks: ["Stopping a recoverable run too early"],
      },
    }),
    event(6, "state.changed", { from: "planning", to: "executing" }),
    event(7, "file.changed", {
      paths: ["tests/retry.test.ts", "src/retry.ts", "src/retry.ts"],
    }),
    event(8, "state.changed", { from: "executing", to: "verifying" }),
    event(9, "verification.completed", {
      receipt: {
        intentId: "verify-1",
        status: "passed",
        startedAt: "2026-09-01T00:00:08.000Z",
        completedAt: "2026-09-01T00:00:09.000Z",
        exitCode: 0,
        outputHash: "a".repeat(64),
        boundedOutput: "1 test passed",
      },
    }),
    event(10, "state.changed", {
      from: "verifying",
      to: "review-ready",
    }),
    event(11, "review.created", {
      reviewId: "review-1",
      changeSetIds: ["change-set-1"],
      changedPaths: ["src/retry.ts", "tests/retry.test.ts"],
    }),
  ];

  const first = replayHarnessEvents(events);
  const second = replayHarnessEvents(structuredClone(events));
  assert.deepEqual(second, first);
  assert.equal(first.state, "review-ready");
  assert.equal(first.eventCount, 11);
  assert.equal(first.lastSequence, 11);
  assert.match(first.eventDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.changedPaths, ["src/retry.ts", "tests/retry.test.ts"]);
  assert.equal(first.verification[0]?.status, "passed");
  assert.equal(first.reviewId, "review-1");
  assert.equal(first.plan?.steps[0]?.id, "step-1");
  assert.equal(first.usage.wallTimeMs, 11_000);
  assert.equal(first.usage.providerTurns, 1);

  const duplicate = applyHarnessEvent(first, events.at(-1)!);
  assert.equal(duplicate, first, "an exact duplicate event must be idempotent");
});

test("Engineering Run fails closed on invalid transitions, gaps, and tampering", () => {
  const initial = applyHarnessEvent(null, createdEvent());
  const invalidTransition = event(2, "state.changed", {
    from: "created",
    to: "applied",
  });
  assert.equal(canTransitionHarnessRun("created", "applied"), false);
  assert.throws(
    () => applyHarnessEvent(initial, invalidTransition),
    /Invalid engineering run transition/,
  );
  assert.equal(initial.state, "created");
  assert.equal(initial.lastSequence, 1);

  const gap = event(3, "state.changed", {
    from: "created",
    to: "context-planning",
  });
  assert.throws(() => applyHarnessEvent(initial, gap), /sequence gap/);

  const valid = event(2, "state.changed", {
    from: "created",
    to: "context-planning",
  });
  const tampered = {
    ...valid,
    payload: { ...valid.payload, to: "planning" },
  };
  const validation = validateHarnessEvent(tampered);
  assert.equal(validation.valid, false);
  assert(
    validation.diagnostics.some(
      (diagnostic) => diagnostic.code === "HARNESS_EVENT_HASH_MISMATCH",
    ),
  );
  assert.throws(
    () => applyHarnessEvent(initial, tampered as AnyHarnessEvent),
    /HASH_MISMATCH/,
  );
});

test("Tool receipts require a requested tool and remain Provider-neutral", () => {
  const baseEvents: AnyHarnessEvent[] = [
    createdEvent(),
    event(2, "state.changed", {
      from: "created",
      to: "context-planning",
    }),
    event(3, "state.changed", {
      from: "context-planning",
      to: "planning",
    }),
    event(4, "state.changed", { from: "planning", to: "executing" }),
    event(5, "tool.requested", {
      request: {
        id: "tool-1",
        toolId: "witch.test",
        capability: "process",
        argumentsHash: hashHarnessPayload({ task: "unit" }),
        scope: ["tests/retry.test.ts"],
        reason: "Run the required verification",
      },
    }),
    event(6, "tool.started", {
      requestId: "tool-1",
      startedAt: "2026-09-01T00:00:06.000Z",
    }),
    event(7, "tool.completed", {
      requestId: "tool-1",
      status: "completed",
      completedAt: "2026-09-01T00:00:07.000Z",
      exitCode: 0,
      outputHash: "b".repeat(64),
      boundedOutput: "passed",
    }),
  ];
  const projection = replayHarnessEvents(baseEvents);
  assert.equal(projection.tools.length, 1);
  assert.equal(projection.usage.toolRequests, 1);
  assert.equal(projection.usage.processes, 0);
  assert.deepEqual(projection.tools[0], {
    request: {
      id: "tool-1",
      toolId: "witch.test",
      capability: "process",
      argumentsHash: hashHarnessPayload({ task: "unit" }),
      scope: ["tests/retry.test.ts"],
      reason: "Run the required verification",
    },
    status: "completed",
    startedAt: "2026-09-01T00:00:06.000Z",
    completedAt: "2026-09-01T00:00:07.000Z",
    exitCode: 0,
    outputHash: "b".repeat(64),
  });
  assert.equal(projection.usage.toolRequests, 1);
  assert.equal(projection.usage.processes, 0);

  const unknownTool = event(8, "tool.completed", {
    requestId: "missing",
    status: "failed",
    completedAt: "2026-09-01T00:00:08.000Z",
  });
  assert.throws(
    () => applyHarnessEvent(projection, unknownTool),
    /active tool/,
  );
});

test("Engineering Run budget accounting rejects over-budget events", () => {
  const created = createHarnessEvent({
    id: "budget-created",
    runId,
    sequence: 1,
    timestamp: createdAt,
    type: "run.created",
    payload: {
      ...createdEvent().payload,
      budget: {
        ...defaultRunBudget("change"),
        wallTimeMs: 500,
      },
    },
  });
  const projection = applyHarnessEvent(null, created);
  assert.throws(
    () =>
      applyHarnessEvent(
        projection,
        createHarnessEvent({
          id: "budget-overrun",
          runId,
          sequence: 2,
          timestamp: "2026-09-01T00:00:01.000Z",
          type: "state.changed",
          payload: { from: "created", to: "context-planning" },
        }),
      ),
    /budget exceeded: wall time 1000\/500/,
  );
});

test("legacy Agent reviews project into immutable Engineering Run events", () => {
  const legacy: AgentRun = {
    id: runId,
    providerId: "claude",
    providerLabel: "Claude Code",
    nativeSession: {
      providerId: "claude",
      sessionId: "legacy-session",
      turnId: "legacy-turn",
    },
    workspaceRoot: path.resolve("tests/fixtures/legacy-agent"),
    workspaceName: "legacy-agent",
    prompt: "Change the greeting",
    mode: "change",
    contexts: [
      {
        nodeId: "semantic:component:api",
        label: "API",
        paths: ["src/api.ts"],
        revision: "legacy-source-revision",
      },
    ],
    status: "review",
    createdAt,
    completedAt: "2026-09-01T00:01:00.000Z",
    response: "Implemented the change",
    activity: ["Editing: src/api.ts"],
    changes: [
      {
        path: "tests/api.test.ts",
        before: null,
        after: "test content",
        beforeHash: null,
        afterHash: "c".repeat(64),
      },
      {
        path: "src/api.ts",
        before: "old",
        after: "new",
        beforeHash: "d".repeat(64),
        afterHash: "e".repeat(64),
      },
    ],
    isolation: "workspace-copy",
    stagingRoot: path.resolve("tests/fixtures/legacy-agent-stage"),
  };
  const before = structuredClone(legacy);
  const projected = projectLegacyAgentRun(legacy);

  assert.deepEqual(legacy, before, "legacy history must remain immutable");
  assert.equal(projected.run.state, "review-ready");
  assert.deepEqual(projected.run.legacy, {
    contract: "witch.agent-run/v0",
    runId,
    originalStatus: "review",
  });
  assert.deepEqual(projected.run.nativeSession, legacy.nativeSession);
  assert.equal(projected.run.sourceRevision, "legacy-source-revision");
  assert.deepEqual(projected.run.contexts, [
    {
      subjectId: "semantic:component:api",
      reason: "user-selected",
      evidenceIds: [],
      priority: 1_000,
    },
  ]);
  assert.deepEqual(projected.run.changedPaths, [
    "src/api.ts",
    "tests/api.test.ts",
  ]);
  assert.equal(projected.run.reviewId, `legacy-review:${runId}`);
  assert.equal(projected.run.verification.length, 0);
  assert.equal(
    projected.events.every((item) => validateHarnessEvent(item).valid),
    true,
  );
  assert.deepEqual(replayHarnessEvents(projected.events), projected.run);
});
