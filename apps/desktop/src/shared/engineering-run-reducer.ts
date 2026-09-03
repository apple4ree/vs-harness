import { createHash } from "node:crypto";
import path from "node:path";
import type { AgentRun } from "./agent";
import {
  isAgentExperienceRecord,
  type AgentExperienceRecord,
  type GraphImpactReviewReceipt,
} from "./agent-graph-tools";
import {
  defaultRunBudget,
  emptyRunBudgetUsage,
  type AnyHarnessEvent,
  type ContextSelectionReason,
  type EngineeringPlan,
  type EngineeringRunProjection,
  type HarnessEvent,
  type HarnessEventDiagnostic,
  type HarnessEventPayloads,
  type HarnessEventType,
  type HarnessEventValidation,
  type HarnessRunState,
  type LegacyAgentRunProjection,
  type PlanEvaluation,
  type RepairAttemptReceipt,
  type RunBudget,
  type ToolCapability,
  type VerificationIntent,
  type VerificationReceipt,
} from "./engineering-run";

const MAX_EVENT_PAYLOAD_BYTES = 256 * 1024;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const states = new Set<HarnessRunState>([
  "created",
  "context-planning",
  "planning",
  "awaiting-approval",
  "executing",
  "verifying",
  "repairing",
  "review-ready",
  "completed",
  "applied",
  "archived",
  "failed",
  "interrupted",
  "attention-required",
]);
const terminalStates = new Set<HarnessRunState>([
  "completed",
  "applied",
  "archived",
  "failed",
  "interrupted",
]);
const contextReasons = new Set<ContextSelectionReason>([
  "user-selected",
  "direct-relation",
  "workflow-step",
  "behavior-flow",
  "verification-target",
  "open-question",
]);
const toolCapabilities = new Set<ToolCapability>([
  "read",
  "write-isolated",
  "process",
  "network",
  "apply",
]);
const verificationKinds = new Set<VerificationIntent["kind"]>([
  "syntax",
  "typecheck",
  "lint",
  "unit-test",
  "build",
  "architecture",
  "semantic",
  "custom-task",
]);
const allowedTransitions: Record<
  HarnessRunState,
  ReadonlySet<HarnessRunState>
> = {
  created: new Set([
    "context-planning",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  "context-planning": new Set([
    "planning",
    "executing",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  planning: new Set([
    "awaiting-approval",
    "executing",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  "awaiting-approval": new Set([
    "executing",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  executing: new Set([
    "verifying",
    "review-ready",
    "completed",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  verifying: new Set([
    "repairing",
    "review-ready",
    "completed",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  repairing: new Set([
    "executing",
    "verifying",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  "review-ready": new Set([
    "applied",
    "archived",
    "failed",
    "interrupted",
    "attention-required",
  ]),
  "attention-required": new Set([
    "awaiting-approval",
    "executing",
    "verifying",
    "repairing",
    "review-ready",
    "failed",
    "interrupted",
  ]),
  completed: new Set(),
  applied: new Set(),
  archived: new Set(),
  failed: new Set(),
  interrupted: new Set(),
};

function normalizeJson(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON numbers must be finite");
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) => normalizeJson(item, seen));
  if (typeof value !== "object")
    throw new Error(`Unsupported JSON value ${typeof value}`);
  if (seen.has(value)) throw new Error("Cyclic JSON payload");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null)
    throw new Error("Harness payloads must use plain JSON objects");
  seen.add(value);
  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) throw new Error("Undefined JSON payload value");
    normalized[key] = normalizeJson(item, seen);
  }
  seen.delete(value);
  return normalized;
}

export function canonicalHarnessJson(value: unknown) {
  return JSON.stringify(normalizeJson(value));
}

export function hashHarnessPayload(payload: unknown) {
  const canonical = canonicalHarnessJson(payload);
  if (Buffer.byteLength(canonical, "utf8") > MAX_EVENT_PAYLOAD_BYTES)
    throw new Error(
      `Harness event payload exceeds ${MAX_EVENT_PAYLOAD_BYTES} bytes`,
    );
  return createHash("sha256").update(canonical).digest("hex");
}

function eventIdentityHash(event: AnyHarnessEvent) {
  return hashHarnessPayload({
    id: event.id,
    runId: event.runId,
    sequence: event.sequence,
    timestamp: event.timestamp,
    type: event.type,
    payloadHash: event.payloadHash,
  });
}

function nextDigest(previous: string, eventHash: string) {
  return createHash("sha256").update(`${previous}:${eventHash}`).digest("hex");
}

export function createHarnessEvent<T extends HarnessEventType>(
  input: Omit<HarnessEvent<T>, "payloadHash">,
): HarnessEvent<T> {
  return { ...input, payloadHash: hashHarnessPayload(input.payload) };
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maximum = 100_000): value is string {
  return (
    typeof value === "string" && value.length > 0 && value.length <= maximum
  );
}

function optionalText(value: unknown, maximum = 100_000) {
  return value === undefined || text(value, maximum);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function strings(value: unknown, maximum = 500): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= maximum &&
    value.every((item) => text(item, 10_000))
  );
}

function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER) {
  return (
    Number.isSafeInteger(value) &&
    Number(value) >= 0 &&
    Number(value) <= maximum
  );
}

function validBudget(value: unknown): value is RunBudget {
  if (!record(value)) return false;
  return (
    integer(value.wallTimeMs, 24 * 60 * 60_000) &&
    integer(value.providerTurns, 10_000) &&
    (value.tokenEstimate === undefined ||
      integer(value.tokenEstimate, 1_000_000_000)) &&
    integer(value.maxChangedFiles, 20_000) &&
    integer(value.maxChangedBytes, 1_000_000_000) &&
    integer(value.maxProcesses, 100) &&
    integer(value.maxRepairAttempts, 100) &&
    integer(value.maxToolRequests, 100_000)
  );
}

function validVerificationIntent(value: unknown): value is VerificationIntent {
  if (!record(value)) return false;
  return (
    text(value.id, 200) &&
    typeof value.kind === "string" &&
    verificationKinds.has(value.kind as VerificationIntent["kind"]) &&
    optionalText(value.commandId, 500) &&
    strings(value.scope) &&
    typeof value.required === "boolean"
  );
}

function validPlan(value: unknown): value is EngineeringPlan {
  if (!record(value)) return false;
  return (
    text(value.objective) &&
    strings(value.assumptions) &&
    strings(value.affectedComponents) &&
    strings(value.expectedFiles) &&
    Array.isArray(value.steps) &&
    value.steps.length <= 200 &&
    value.steps.every(
      (step) =>
        record(step) &&
        text(step.id, 200) &&
        text(step.description) &&
        text(step.expectedOutcome),
    ) &&
    Array.isArray(value.verification) &&
    value.verification.length <= 200 &&
    value.verification.every(validVerificationIntent) &&
    strings(value.risks)
  );
}

function validVerificationReceipt(
  value: unknown,
): value is VerificationReceipt {
  if (!record(value)) return false;
  return (
    text(value.intentId, 200) &&
    ["passed", "failed", "skipped", "blocked"].includes(String(value.status)) &&
    timestamp(value.startedAt) &&
    timestamp(value.completedAt) &&
    (value.exitCode === undefined || Number.isSafeInteger(value.exitCode)) &&
    (value.outputHash === undefined ||
      HASH_PATTERN.test(String(value.outputHash))) &&
    optionalText(value.boundedOutput) &&
    optionalText(value.changedRevision, 500)
  );
}

function validPlanEvaluation(value: unknown): value is PlanEvaluation {
  if (!record(value)) return false;
  return (
    strings(value.expectedFiles) &&
    strings(value.actualFiles) &&
    strings(value.unexpectedFiles) &&
    strings(value.missingFiles) &&
    timestamp(value.evaluatedAt)
  );
}

function validRepairReceipt(value: unknown): value is RepairAttemptReceipt {
  if (!record(value)) return false;
  return (
    integer(value.attempt, 100) &&
    Number(value.attempt) > 0 &&
    HASH_PATTERN.test(String(value.fingerprint)) &&
    strings(value.failedIntentIds) &&
    ["started", "passed", "failed", "interrupted"].includes(
      String(value.status),
    ) &&
    timestamp(value.startedAt) &&
    (value.completedAt === undefined || timestamp(value.completedAt)) &&
    optionalText(value.checkpointId, 200)
  );
}

function validImpactReceipt(value: unknown): value is GraphImpactReviewReceipt {
  if (!record(value) || !record(value.risk)) return false;
  const nodes = value.affectedNodes;
  return (
    value.contract === "witch.graph-impact-review/v1" &&
    value.sourceContract === "witch.graph-impact/v1" &&
    text(value.sourceRevision, 1_000) &&
    optionalText(value.semanticRevision, 1_000) &&
    optionalText(value.behaviorRevision, 1_000) &&
    optionalText(value.knowledgeRevision, 1_000) &&
    integer(value.maxDepth, 8) &&
    Number(value.maxDepth) >= 1 &&
    strings(value.changedPaths) &&
    strings(value.changedNodeIds) &&
    integer(value.affectedCount, 1_000_000) &&
    Array.isArray(nodes) &&
    nodes.length <= 120 &&
    nodes.every(
      (node) =>
        record(node) &&
        text(node.id, 10_000) &&
        text(node.label, 10_000) &&
        text(node.kind, 1_000) &&
        optionalText(node.path, 32_000) &&
        integer(node.depth, 8) &&
        strings(node.relationPath, 8),
    ) &&
    integer(value.omittedAffected, 1_000_000) &&
    strings(value.componentIds) &&
    strings(value.workflowIds) &&
    strings(value.suggestedTestPaths) &&
    integer(value.risk.score, 100) &&
    ["low", "medium", "high", "critical"].includes(String(value.risk.level)) &&
    strings(value.risk.reasons, 12) &&
    strings(value.unresolvedInputs) &&
    typeof value.truncated === "boolean"
  );
}

function validExperienceReceipt(
  value: unknown,
): value is AgentExperienceRecord {
  return isAgentExperienceRecord(value);
}

function payloadValid(type: HarnessEventType, payload: unknown) {
  if (!record(payload)) return false;
  switch (type) {
    case "run.created": {
      const native = payload.nativeSession;
      const legacy = payload.legacy;
      return (
        payload.contract === "witch.engineering-run/v1" &&
        payload.schemaVersion === 1 &&
        text(payload.runId, 200) &&
        optionalText(payload.parentRunId, 200) &&
        text(payload.workspaceRoot, 32_000) &&
        path.isAbsolute(payload.workspaceRoot) &&
        text(payload.workspaceName, 1_000) &&
        text(payload.sourceRevision, 1_000) &&
        ["codex", "claude"].includes(String(payload.providerId)) &&
        text(payload.providerLabel, 1_000) &&
        ["ask", "change"].includes(String(payload.mode)) &&
        text(payload.goal) &&
        timestamp(payload.createdAt) &&
        validBudget(payload.budget) &&
        (native === undefined ||
          (record(native) &&
            native.providerId === payload.providerId &&
            text(native.sessionId, 10_000) &&
            optionalText(native.turnId, 10_000))) &&
        (legacy === undefined ||
          (record(legacy) &&
            legacy.contract === "witch.agent-run/v0" &&
            text(legacy.runId, 200) &&
            [
              "preparing",
              "running",
              "review",
              "completed",
              "interrupted",
              "failed",
              "applied",
              "archived",
            ].includes(String(legacy.originalStatus))))
      );
    }
    case "context.selected":
      return (
        text(payload.subjectId, 10_000) &&
        typeof payload.reason === "string" &&
        contextReasons.has(payload.reason as ContextSelectionReason) &&
        strings(payload.evidenceIds) &&
        integer(payload.priority, 1_000_000)
      );
    case "plan.created":
      return validPlan(payload.plan);
    case "plan.evaluated":
      return validPlanEvaluation(payload.evaluation);
    case "state.changed":
      return (
        typeof payload.from === "string" &&
        states.has(payload.from as HarnessRunState) &&
        typeof payload.to === "string" &&
        states.has(payload.to as HarnessRunState) &&
        optionalText(payload.reason)
      );
    case "approval.requested":
      return (
        text(payload.requestId, 200) &&
        typeof payload.capability === "string" &&
        toolCapabilities.has(payload.capability as ToolCapability) &&
        text(payload.reason)
      );
    case "approval.resolved":
      return (
        text(payload.requestId, 200) &&
        ["allow", "deny", "ask"].includes(String(payload.decision)) &&
        text(payload.policyId, 500) &&
        text(payload.reason) &&
        (payload.budgetDelta === undefined || record(payload.budgetDelta))
      );
    case "provider.session": {
      const session = payload.session;
      return (
        record(session) &&
        ["codex", "claude"].includes(String(session.providerId)) &&
        text(session.sessionId, 10_000) &&
        optionalText(session.turnId, 10_000)
      );
    }
    case "provider.message":
      return (
        typeof payload.text === "string" &&
        typeof payload.completed === "boolean"
      );
    case "tool.requested": {
      const request = payload.request;
      return (
        record(request) &&
        text(request.id, 200) &&
        text(request.toolId, 1_000) &&
        typeof request.capability === "string" &&
        toolCapabilities.has(request.capability as ToolCapability) &&
        HASH_PATTERN.test(String(request.argumentsHash)) &&
        strings(request.scope) &&
        text(request.reason)
      );
    }
    case "tool.started":
      return text(payload.requestId, 200) && timestamp(payload.startedAt);
    case "tool.completed":
      return (
        text(payload.requestId, 200) &&
        ["completed", "failed", "denied", "interrupted"].includes(
          String(payload.status),
        ) &&
        timestamp(payload.completedAt) &&
        (payload.exitCode === undefined ||
          Number.isSafeInteger(payload.exitCode)) &&
        (payload.outputHash === undefined ||
          HASH_PATTERN.test(String(payload.outputHash))) &&
        optionalText(payload.boundedOutput)
      );
    case "file.changed":
      return strings(payload.paths) && optionalText(payload.checkpointId, 200);
    case "checkpoint.created":
      return (
        text(payload.checkpointId, 200) &&
        optionalText(payload.parentId, 200) &&
        text(payload.label, 1_000) &&
        HASH_PATTERN.test(String(payload.manifestHash)) &&
        strings(payload.changedPaths) &&
        integer(payload.totalBytes, 1_000_000_000)
      );
    case "verification.completed":
      return validVerificationReceipt(payload.receipt);
    case "repair.started":
    case "repair.completed":
      return validRepairReceipt(payload.receipt);
    case "repair.stopped":
      return (
        HASH_PATTERN.test(String(payload.fingerprint)) &&
        integer(payload.attempts, 100) &&
        [
          "same-fingerprint",
          "budget-exhausted",
          "provider-interrupted",
        ].includes(String(payload.reason)) &&
        timestamp(payload.stoppedAt)
      );
    case "impact.analyzed":
      return validImpactReceipt(payload.receipt);
    case "experience.recorded":
      return validExperienceReceipt(payload.receipt);
    case "analysis.updated": {
      const receipt = payload.receipt;
      return (
        record(receipt) &&
        ["completed", "failed", "skipped"].includes(String(receipt.status)) &&
        text(receipt.beforeRevision, 1_000) &&
        optionalText(receipt.afterRevision, 1_000) &&
        strings(receipt.invalidatedPaths) &&
        (receipt.changedNodes === undefined ||
          integer(receipt.changedNodes, 1_000_000)) &&
        (receipt.changedRelations === undefined ||
          integer(receipt.changedRelations, 2_000_000)) &&
        timestamp(receipt.completedAt) &&
        optionalText(receipt.error)
      );
    }
    case "review.created":
      return (
        text(payload.reviewId, 200) &&
        strings(payload.changeSetIds) &&
        strings(payload.changedPaths)
      );
    case "run.completed":
      return (
        typeof payload.response === "string" && timestamp(payload.completedAt)
      );
    case "run.failed":
      return text(payload.error) && timestamp(payload.completedAt);
  }
}

function diagnostic(
  diagnostics: HarnessEventDiagnostic[],
  code: string,
  message: string,
) {
  diagnostics.push({ code, message });
}

export function validateHarnessEvent(value: unknown): HarnessEventValidation {
  const diagnostics: HarnessEventDiagnostic[] = [];
  if (!record(value)) {
    diagnostic(diagnostics, "HARNESS_EVENT_INVALID", "Event must be an object");
    return { valid: false, diagnostics };
  }
  if (!text(value.id, 200))
    diagnostic(diagnostics, "HARNESS_EVENT_ID_INVALID", "Event id is required");
  if (!text(value.runId, 200))
    diagnostic(diagnostics, "HARNESS_RUN_ID_INVALID", "Run id is required");
  if (!Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1)
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_SEQUENCE_INVALID",
      "Event sequence must be a positive safe integer",
    );
  if (!timestamp(value.timestamp))
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_TIMESTAMP_INVALID",
      "Event timestamp must be parseable",
    );
  const type = value.type;
  const validType =
    typeof type === "string" &&
    [
      "run.created",
      "context.selected",
      "plan.created",
      "plan.evaluated",
      "state.changed",
      "approval.requested",
      "approval.resolved",
      "provider.session",
      "provider.message",
      "tool.requested",
      "tool.started",
      "tool.completed",
      "file.changed",
      "checkpoint.created",
      "verification.completed",
      "repair.started",
      "repair.completed",
      "repair.stopped",
      "impact.analyzed",
      "experience.recorded",
      "analysis.updated",
      "review.created",
      "run.completed",
      "run.failed",
    ].includes(type);
  if (!validType)
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_TYPE_UNSUPPORTED",
      "Event type is not supported",
    );
  else if (!payloadValid(type as HarnessEventType, value.payload))
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_PAYLOAD_INVALID",
      `Payload does not match ${type}`,
    );
  let expectedHash = "";
  try {
    expectedHash = hashHarnessPayload(value.payload);
  } catch (error) {
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_PAYLOAD_UNSAFE",
      error instanceof Error ? error.message : String(error),
    );
  }
  if (!HASH_PATTERN.test(String(value.payloadHash)))
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_HASH_INVALID",
      "Payload hash must be a SHA-256 hex digest",
    );
  else if (expectedHash && value.payloadHash !== expectedHash)
    diagnostic(
      diagnostics,
      "HARNESS_EVENT_HASH_MISMATCH",
      "Payload does not match its recorded hash",
    );
  if (
    validType &&
    type === "run.created" &&
    record(value.payload) &&
    value.payload.runId !== value.runId
  )
    diagnostic(
      diagnostics,
      "HARNESS_CREATED_RUN_MISMATCH",
      "Created payload must identify the event run",
    );
  diagnostics.sort(
    (left, right) =>
      left.code.localeCompare(right.code) ||
      left.message.localeCompare(right.message),
  );
  return { valid: diagnostics.length === 0, diagnostics };
}

function assertValidHarnessEvent(
  value: unknown,
): asserts value is AnyHarnessEvent {
  const validation = validateHarnessEvent(value);
  if (!validation.valid)
    throw new Error(
      `Invalid Harness event: ${validation.diagnostics
        .map((item) => `${item.code}: ${item.message}`)
        .join("; ")}`,
    );
}

export function canTransitionHarnessRun(
  from: HarnessRunState,
  to: HarnessRunState,
) {
  return Boolean(allowedTransitions[from]?.has(to));
}

function createdProjection(
  event: HarnessEvent<"run.created">,
): EngineeringRunProjection {
  if (event.sequence !== 1)
    throw new Error("The first Harness event must use sequence 1");
  const payload = event.payload;
  const identity = eventIdentityHash(event);
  return {
    contract: payload.contract,
    schemaVersion: payload.schemaVersion,
    runId: payload.runId,
    ...(payload.parentRunId ? { parentRunId: payload.parentRunId } : {}),
    workspaceRoot: payload.workspaceRoot,
    workspaceName: payload.workspaceName,
    sourceRevision: payload.sourceRevision,
    providerId: payload.providerId,
    providerLabel: payload.providerLabel,
    ...(payload.nativeSession ? { nativeSession: payload.nativeSession } : {}),
    mode: payload.mode,
    goal: payload.goal,
    state: "created",
    createdAt: payload.createdAt,
    updatedAt: event.timestamp,
    budget: { ...payload.budget },
    usage: emptyRunBudgetUsage(),
    contexts: [],
    planEvaluations: [],
    approvals: [],
    tools: [],
    verification: [],
    repairs: [],
    impactAnalyses: [],
    experiences: [],
    analysisUpdates: [],
    changedPaths: [],
    checkpointIds: [],
    response: "",
    lastSequence: 1,
    eventCount: 1,
    eventDigest: nextDigest("", identity),
    appliedEvents: { [event.id]: identity },
    ...(payload.legacy ? { legacy: payload.legacy } : {}),
  };
}

function unique(values: readonly string[]) {
  return [...new Set(values)].sort();
}

export function applyHarnessEvent(
  current: EngineeringRunProjection | null,
  candidate: AnyHarnessEvent,
): EngineeringRunProjection {
  assertValidHarnessEvent(candidate);
  if (!current) {
    if (candidate.type !== "run.created")
      throw new Error("The first Harness event must be run.created");
    return createdProjection(candidate);
  }
  if (candidate.runId !== current.runId)
    throw new Error("Harness event belongs to a different run");
  const identity = eventIdentityHash(candidate);
  const existing = current.appliedEvents[candidate.id];
  if (existing) {
    if (existing !== identity)
      throw new Error("Harness event id was reused with different contents");
    return current;
  }
  if (candidate.sequence !== current.lastSequence + 1)
    throw new Error(
      `Harness event sequence gap: expected ${current.lastSequence + 1}, received ${candidate.sequence}`,
    );
  if (candidate.type === "run.created")
    throw new Error("A Harness run can be created only once");

  const next: EngineeringRunProjection = {
    ...current,
    updatedAt: candidate.timestamp,
    budget: { ...current.budget },
    usage: { ...current.usage },
    contexts: [...current.contexts],
    planEvaluations: current.planEvaluations.map((item) => ({
      ...item,
      expectedFiles: [...item.expectedFiles],
      actualFiles: [...item.actualFiles],
      unexpectedFiles: [...item.unexpectedFiles],
      missingFiles: [...item.missingFiles],
    })),
    approvals: [...current.approvals],
    tools: current.tools.map((tool) => ({
      ...tool,
      request: { ...tool.request },
    })),
    verification: [...current.verification],
    repairs: current.repairs.map((receipt) => ({
      ...receipt,
      failedIntentIds: [...receipt.failedIntentIds],
    })),
    impactAnalyses: current.impactAnalyses.map((receipt) =>
      structuredClone(receipt),
    ),
    experiences: current.experiences.map((receipt) => structuredClone(receipt)),
    analysisUpdates: [...current.analysisUpdates],
    changedPaths: [...current.changedPaths],
    checkpointIds: [...current.checkpointIds],
    lastSequence: candidate.sequence,
    eventCount: current.eventCount + 1,
    eventDigest: nextDigest(current.eventDigest, identity),
    appliedEvents: { ...current.appliedEvents, [candidate.id]: identity },
  };
  next.usage.wallTimeMs = Math.max(
    current.usage.wallTimeMs,
    Math.max(
      0,
      Date.parse(candidate.timestamp) - Date.parse(current.createdAt),
    ),
  );

  switch (candidate.type) {
    case "context.selected":
      next.contexts.push({
        ...candidate.payload,
        evidenceIds: [...candidate.payload.evidenceIds],
      });
      break;
    case "plan.created":
      next.plan = structuredClone(candidate.payload.plan);
      break;
    case "plan.evaluated":
      next.planEvaluations.push(structuredClone(candidate.payload.evaluation));
      break;
    case "state.changed": {
      const { from, to, reason } = candidate.payload;
      if (from !== current.state)
        throw new Error(
          `Harness state mismatch: event expected ${from}, current state is ${current.state}`,
        );
      if (!canTransitionHarnessRun(from, to))
        throw new Error(`Invalid engineering run transition: ${from} → ${to}`);
      next.state = to;
      if (to === "executing") next.usage.providerTurns++;
      if (terminalStates.has(to)) next.completedAt = candidate.timestamp;
      if ((to === "failed" || to === "interrupted") && reason)
        next.error = reason;
      break;
    }
    case "approval.requested":
      break;
    case "approval.resolved":
      next.approvals.push({ ...candidate.payload });
      break;
    case "provider.session":
      if (candidate.payload.session.providerId !== current.providerId)
        throw new Error("Native session belongs to another Agent Provider");
      next.nativeSession = { ...candidate.payload.session };
      break;
    case "provider.message":
      next.response = candidate.payload.completed
        ? candidate.payload.text
        : `${next.response}${candidate.payload.text}`;
      break;
    case "tool.requested":
      if (
        next.tools.some(
          (tool) => tool.request.id === candidate.payload.request.id,
        )
      )
        throw new Error("Tool request id must be unique within a run");
      next.tools.push({
        request: structuredClone(candidate.payload.request),
        status: "requested",
      });
      next.usage.toolRequests++;
      break;
    case "tool.started": {
      const tool = next.tools.find(
        (item) => item.request.id === candidate.payload.requestId,
      );
      if (!tool || tool.status !== "requested")
        throw new Error("Tool start must reference a requested tool");
      tool.status = "running";
      tool.startedAt = candidate.payload.startedAt;
      next.usage.processes++;
      break;
    }
    case "tool.completed": {
      const tool = next.tools.find(
        (item) => item.request.id === candidate.payload.requestId,
      );
      if (!tool || !["requested", "running"].includes(tool.status))
        throw new Error("Tool completion must reference an active tool");
      tool.status = candidate.payload.status;
      tool.completedAt = candidate.payload.completedAt;
      tool.exitCode = candidate.payload.exitCode;
      tool.outputHash = candidate.payload.outputHash;
      if (tool.startedAt)
        next.usage.processes = Math.max(0, next.usage.processes - 1);
      break;
    }
    case "file.changed":
      next.changedPaths = unique([
        ...next.changedPaths,
        ...candidate.payload.paths,
      ]);
      next.usage.changedFiles = next.changedPaths.length;
      break;
    case "checkpoint.created":
      next.checkpointIds = unique([
        ...next.checkpointIds,
        candidate.payload.checkpointId,
      ]);
      next.changedPaths = unique([
        ...next.changedPaths,
        ...candidate.payload.changedPaths,
      ]);
      next.usage.changedFiles = next.changedPaths.length;
      next.usage.changedBytes = Math.max(
        next.usage.changedBytes,
        candidate.payload.totalBytes,
      );
      break;
    case "verification.completed":
      next.verification.push(structuredClone(candidate.payload.receipt));
      break;
    case "repair.started":
      if (current.state !== "repairing")
        throw new Error("Repair start requires repairing state");
      if (
        next.repairs.some(
          (receipt) => receipt.attempt === candidate.payload.receipt.attempt,
        )
      )
        throw new Error("Repair attempt number must be unique within a run");
      next.repairs.push(structuredClone(candidate.payload.receipt));
      next.usage.repairAttempts++;
      break;
    case "repair.completed": {
      const receipt = candidate.payload.receipt;
      const repair = next.repairs.find(
        (item) =>
          item.attempt === receipt.attempt &&
          item.fingerprint === receipt.fingerprint,
      );
      if (!repair || repair.status !== "started")
        throw new Error("Repair completion must reference a started attempt");
      Object.assign(repair, structuredClone(receipt));
      break;
    }
    case "repair.stopped":
      next.repairStopReason = candidate.payload.reason;
      break;
    case "impact.analyzed":
      next.impactAnalyses.push(structuredClone(candidate.payload.receipt));
      break;
    case "experience.recorded":
      if (
        next.experiences.some(
          (experience) => experience.id === candidate.payload.receipt.id,
        )
      )
        throw new Error("Experience id must be unique within a run");
      if (candidate.payload.receipt.runId !== current.runId)
        throw new Error("Experience receipt belongs to another run");
      next.experiences.push(structuredClone(candidate.payload.receipt));
      break;
    case "analysis.updated":
      next.analysisUpdates.push(structuredClone(candidate.payload.receipt));
      break;
    case "review.created":
      if (current.state !== "review-ready")
        throw new Error("Review receipt requires review-ready state");
      next.reviewId = candidate.payload.reviewId;
      next.changedPaths = unique([
        ...next.changedPaths,
        ...candidate.payload.changedPaths,
      ]);
      next.usage.changedFiles = next.changedPaths.length;
      break;
    case "run.completed":
      if (current.state !== "completed")
        throw new Error("Completion receipt requires completed state");
      next.response = candidate.payload.response;
      next.completedAt = candidate.payload.completedAt;
      break;
    case "run.failed":
      if (current.state !== "failed")
        throw new Error("Failure receipt requires failed state");
      next.error = candidate.payload.error;
      next.completedAt = candidate.payload.completedAt;
      break;
  }
  const exceeded = [
    ["wall time", next.usage.wallTimeMs, next.budget.wallTimeMs],
    ["Provider turns", next.usage.providerTurns, next.budget.providerTurns],
    ["changed files", next.usage.changedFiles, next.budget.maxChangedFiles],
    ["changed bytes", next.usage.changedBytes, next.budget.maxChangedBytes],
    ["concurrent processes", next.usage.processes, next.budget.maxProcesses],
    [
      "repair attempts",
      next.usage.repairAttempts,
      next.budget.maxRepairAttempts,
    ],
    ["tool requests", next.usage.toolRequests, next.budget.maxToolRequests],
  ].find(([, used, limit]) => Number(used) > Number(limit));
  if (exceeded)
    throw new Error(
      `Engineering Run budget exceeded: ${exceeded[0]} ${exceeded[1]}/${exceeded[2]}`,
    );
  return next;
}

export function replayHarnessEvents(
  events: readonly AnyHarnessEvent[],
): EngineeringRunProjection {
  if (!events.length)
    throw new Error("Harness replay requires at least one event");
  return events.reduce<EngineeringRunProjection | null>(
    (projection, event) => applyHarnessEvent(projection, event),
    null,
  )!;
}

function legacyTargetState(status: AgentRun["status"]): HarnessRunState {
  switch (status) {
    case "preparing":
      return "planning";
    case "running":
      return "executing";
    case "review":
      return "review-ready";
    case "completed":
      return "completed";
    case "interrupted":
      return "interrupted";
    case "failed":
      return "failed";
    case "applied":
      return "applied";
    case "archived":
      return "archived";
  }
}

export function projectLegacyAgentRun(run: AgentRun): LegacyAgentRunProjection {
  const events: AnyHarnessEvent[] = [];
  let sequence = 0;
  let state: HarnessRunState = "created";
  const timestampFor = (terminal = false) =>
    terminal
      ? run.completedAt || run.archivedAt || run.createdAt
      : run.createdAt;
  const emit = <T extends HarnessEventType>(
    type: T,
    payload: HarnessEventPayloads[T],
    timestamp = run.createdAt,
  ) => {
    sequence++;
    events.push(
      createHarnessEvent({
        id: `legacy:${run.id}:${sequence}`,
        runId: run.id,
        sequence,
        timestamp,
        type,
        payload,
      }) as AnyHarnessEvent,
    );
  };
  const transition = (
    to: HarnessRunState,
    reason?: string,
    terminal = false,
  ) => {
    emit(
      "state.changed",
      { from: state, to, ...(reason ? { reason } : {}) },
      timestampFor(terminal),
    );
    state = to;
  };

  emit("run.created", {
    contract: "witch.engineering-run/v1",
    schemaVersion: 1,
    runId: run.id,
    workspaceRoot: run.workspaceRoot,
    workspaceName: run.workspaceName,
    sourceRevision: run.contexts[0]?.revision || `legacy:${run.id}`,
    providerId: run.providerId,
    providerLabel: run.providerLabel,
    mode: run.mode,
    goal: run.prompt,
    createdAt: run.createdAt,
    budget: defaultRunBudget(run.mode),
    ...(run.nativeSession ? { nativeSession: run.nativeSession } : {}),
    legacy: {
      contract: "witch.agent-run/v0",
      runId: run.id,
      originalStatus: run.status,
    },
  });
  transition("context-planning");
  for (const context of run.contexts)
    emit("context.selected", {
      subjectId: context.nodeId,
      reason: "user-selected",
      evidenceIds: [],
      priority: 1_000,
    });
  for (const experience of run.experiences || [])
    if (experience.runId === run.id)
      emit(
        "experience.recorded",
        { receipt: structuredClone(experience) },
        run.createdAt,
      );

  const target = legacyTargetState(run.status);
  if (target === "planning") transition("planning");
  else {
    if (run.mode === "change") transition("planning");
    transition("executing");
    if (run.response)
      emit("provider.message", { text: run.response, completed: true });
    if (run.changes.length)
      emit("file.changed", {
        paths: unique(run.changes.map((change) => change.path)),
      });
    if (["review-ready", "applied", "archived"].includes(target)) {
      transition("review-ready");
      emit("review.created", {
        reviewId: `legacy-review:${run.id}`,
        changeSetIds: run.changes.map(
          (change, index) => `legacy-change:${index}:${change.path}`,
        ),
        changedPaths: unique(run.changes.map((change) => change.path)),
      });
      if (target === "applied" || target === "archived")
        transition(target, undefined, true);
    } else if (target === "completed") {
      transition("completed", undefined, true);
      emit(
        "run.completed",
        { response: run.response, completedAt: timestampFor(true) },
        timestampFor(true),
      );
    } else if (target === "failed") {
      transition("failed", run.error || "Legacy Agent run failed", true);
      emit(
        "run.failed",
        {
          error: run.error || "Legacy Agent run failed",
          completedAt: timestampFor(true),
        },
        timestampFor(true),
      );
    } else if (target === "interrupted")
      transition(
        "interrupted",
        run.error || "Legacy Agent run was interrupted",
        true,
      );
  }
  return { events, run: replayHarnessEvents(events) };
}
