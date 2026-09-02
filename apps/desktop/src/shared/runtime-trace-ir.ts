import type { BehaviorRelation } from "./behavior";
import type { SemanticGraph } from "./semantic";
import type {
  RuntimeObservedRelation,
  RuntimeTraceComparison,
  RuntimeTraceDiagnostic,
  RuntimeTraceSession,
  RuntimeTraceValidationReceipt,
} from "./runtime-trace";

export type RuntimeTraceSessionDraft = Omit<RuntimeTraceSession, "validation">;
const MAX_EVENTS = 10_000;

const sessionKeys = new Set([
  "schemaVersion",
  "contract",
  "analyzerVersion",
  "policyVersion",
  "id",
  "workspaceRoot",
  "sourceRevision",
  "semanticRevision",
  "taskId",
  "taskLabel",
  "startedAt",
  "completedAt",
  "commandReceipt",
  "status",
  "revision",
  "events",
  "warnings",
  "validation",
]);
const eventKeys = new Set([
  "id",
  "sequence",
  "phase",
  "semanticNodeId",
  "parentSemanticNodeId",
  "offsetMs",
  "durationMs",
  "outcome",
]);

function push(
  diagnostics: RuntimeTraceDiagnostic[],
  code: string,
  severity: RuntimeTraceDiagnostic["severity"],
  subject: string,
  message: string,
) {
  diagnostics.push({ code, severity, subject, message });
}

export function validateRuntimeTraceSession(
  session: RuntimeTraceSessionDraft | RuntimeTraceSession,
  semantic?: SemanticGraph,
): RuntimeTraceValidationReceipt {
  const diagnostics = [...session.warnings];
  const semanticIds = new Set(semantic?.nodes.map((node) => node.id) || []);
  const sameRevision = semantic?.revision === session.semanticRevision;
  if (
    session.schemaVersion !== 1 ||
    session.contract !== "witch.runtime-trace/v1"
  )
    push(
      diagnostics,
      "TRACE_SCHEMA_UNSUPPORTED",
      "error",
      "document",
      "Runtime trace must use witch.runtime-trace/v1",
    );
  for (const key of Object.keys(session))
    if (!sessionKeys.has(key))
      push(
        diagnostics,
        "TRACE_PAYLOAD_FIELD_FORBIDDEN",
        "error",
        "document",
        `Runtime trace field ${key} is not allowlisted; actual values are never stored`,
      );
  if (
    !session.id ||
    !session.workspaceRoot ||
    !session.sourceRevision ||
    !session.semanticRevision ||
    !session.taskId ||
    !session.revision
  )
    push(
      diagnostics,
      "TRACE_IDENTITY_MISSING",
      "error",
      "document",
      "Trace, workspace, source, semantic, task, and revision identities are required",
    );
  if (!/^[a-f0-9]{64}$/i.test(session.commandReceipt))
    push(
      diagnostics,
      "TRACE_COMMAND_RECEIPT_INVALID",
      "error",
      "document",
      "Command receipt must be a SHA-256 digest, not raw command or environment data",
    );
  if (semantic && !sameRevision)
    push(
      diagnostics,
      "TRACE_SEMANTIC_REVISION_STALE",
      "warning",
      "document",
      "Trace belongs to an older semantic revision and cannot be overlaid on the current graph",
    );
  if (session.events.length > MAX_EVENTS)
    push(
      diagnostics,
      "TRACE_EVENT_LIMIT_EXCEEDED",
      "error",
      "document",
      `Trace exceeds the ${MAX_EVENTS} structural event limit`,
    );
  if (session.status === "running" && session.completedAt)
    push(
      diagnostics,
      "TRACE_RUNNING_COMPLETION_INVALID",
      "error",
      "document",
      "A running trace cannot have a completion timestamp",
    );
  if (session.status !== "running" && !session.completedAt)
    push(
      diagnostics,
      "TRACE_COMPLETION_MISSING",
      "error",
      "document",
      "A terminal trace status requires a completion timestamp",
    );
  let expected = 1;
  for (const event of session.events) {
    for (const key of Object.keys(event))
      if (!eventKeys.has(key))
        push(
          diagnostics,
          "TRACE_EVENT_VALUE_FIELD_FORBIDDEN",
          "error",
          event.id || `event:${expected}`,
          `Event field ${key} is not structural trace metadata`,
        );
    if (!event.id || event.sequence !== expected++)
      push(
        diagnostics,
        "TRACE_EVENT_SEQUENCE_INVALID",
        "error",
        event.id || "event",
        "Trace events require contiguous one-based sequence numbers",
      );
    if (!semanticIds.has(event.semanticNodeId))
      push(
        diagnostics,
        "TRACE_EVENT_ENDPOINT_MISSING",
        sameRevision ? "error" : "warning",
        event.id,
        "Observed event does not reference a symbol in the selected semantic graph",
      );
    if (
      event.parentSemanticNodeId &&
      !semanticIds.has(event.parentSemanticNodeId)
    )
      push(
        diagnostics,
        "TRACE_EVENT_PARENT_MISSING",
        sameRevision ? "error" : "warning",
        event.id,
        "Observed parent does not reference a symbol in the selected semantic graph",
      );
    if (!Number.isSafeInteger(event.offsetMs) || event.offsetMs < 0)
      push(
        diagnostics,
        "TRACE_EVENT_OFFSET_INVALID",
        "error",
        event.id,
        "Observed offset must be a non-negative integer",
      );
    if (
      event.durationMs !== undefined &&
      (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0)
    )
      push(
        diagnostics,
        "TRACE_EVENT_DURATION_INVALID",
        "error",
        event.id,
        "Observed duration must be a non-negative integer",
      );
  }
  diagnostics.sort(
    (left, right) =>
      left.severity.localeCompare(right.severity) ||
      left.code.localeCompare(right.code) ||
      left.subject.localeCompare(right.subject),
  );
  return {
    contract: "witch.runtime-trace/v1",
    valid: !diagnostics.some((item) => item.severity === "error"),
    revision: session.revision,
    eventCount: session.events.length,
    observedRelationCount: observedRuntimeRelations(session).length,
    actualValueCount: 0,
    diagnostics,
  };
}

export function finalizeRuntimeTraceSession(
  draft: RuntimeTraceSessionDraft,
  semantic: SemanticGraph,
): RuntimeTraceSession {
  const session: RuntimeTraceSessionDraft = {
    ...draft,
    events: [...draft.events].sort(
      (left, right) => left.sequence - right.sequence,
    ),
    warnings: [...draft.warnings].sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.subject.localeCompare(right.subject),
    ),
  };
  const validation = validateRuntimeTraceSession(session, semantic);
  if (!validation.valid) {
    const details = validation.diagnostics
      .filter((item) => item.severity === "error")
      .slice(0, 8)
      .map((item) => `${item.code} (${item.subject}): ${item.message}`)
      .join("; ");
    throw new Error(`Runtime trace validation failed: ${details}`);
  }
  return { ...session, validation };
}

export function observedRuntimeRelations(
  session: Pick<RuntimeTraceSession, "id" | "events">,
): RuntimeObservedRelation[] {
  const grouped = new Map<
    string,
    { from: string; to: string; count: number; duration: number }
  >();
  for (const event of session.events)
    if (event.phase === "enter" && event.parentSemanticNodeId) {
      const key = `${event.parentSemanticNodeId}\u0000${event.semanticNodeId}`;
      const current = grouped.get(key) || {
        from: event.parentSemanticNodeId,
        to: event.semanticNodeId,
        count: 0,
        duration: 0,
      };
      current.count++;
      current.duration += event.durationMs || 0;
      grouped.set(key, current);
    }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
    )
    .map((item, index) => ({
      id: `runtime:${session.id}:relation:${index + 1}`,
      from: item.from,
      to: item.to,
      kind: "calls",
      trust: "observed",
      confidence: 1,
      status: "accepted",
      evidence: [],
      provenance: {
        analyzer: "witch-runtime-trace",
        version: "1.0.0",
        policy: "structural-events-no-values-v1",
        traceSessionId: session.id,
      },
      observationCount: item.count,
      totalDurationMs: item.duration,
    }));
}

const endpointKey = (relation: Pick<BehaviorRelation, "from" | "to">) =>
  `${relation.from}\u0000${relation.to}`;

export function compareRuntimeTrace(
  staticRelations: readonly BehaviorRelation[],
  observedRelations: readonly RuntimeObservedRelation[],
): RuntimeTraceComparison {
  const comparableStatic = staticRelations.filter(
    (relation) => relation.kind !== "returns",
  );
  const staticKeys = new Map<string, string[]>();
  const observedKeys = new Map<string, string[]>();
  for (const relation of comparableStatic)
    staticKeys.set(endpointKey(relation), [
      ...(staticKeys.get(endpointKey(relation)) || []),
      relation.id,
    ]);
  for (const relation of observedRelations)
    observedKeys.set(endpointKey(relation), [
      ...(observedKeys.get(endpointKey(relation)) || []),
      relation.id,
    ]);
  const matchedKeys = [...staticKeys.keys()].filter((key) =>
    observedKeys.has(key),
  );
  return {
    staticRelationCount: comparableStatic.length,
    observedRelationCount: observedRelations.length,
    matchedCount: matchedKeys.length,
    staticOnlyCount: [...staticKeys.keys()].filter(
      (key) => !observedKeys.has(key),
    ).length,
    observedOnlyCount: [...observedKeys.keys()].filter(
      (key) => !staticKeys.has(key),
    ).length,
    matchedStaticIds: matchedKeys
      .flatMap((key) => staticKeys.get(key) || [])
      .sort(),
    matchedObservedIds: matchedKeys
      .flatMap((key) => observedKeys.get(key) || [])
      .sort(),
  };
}
