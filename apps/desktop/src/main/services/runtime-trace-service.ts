import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ArchitectureGraph } from "../../shared/architecture";
import type {
  RuntimeTraceDiagnostic,
  RuntimeTraceSession,
  RuntimeTraceStatus,
  RuntimeTraceWireEvent,
} from "../../shared/runtime-trace";
import {
  finalizeRuntimeTraceSession,
  validateRuntimeTraceSession,
} from "../../shared/runtime-trace-ir";
import { contentHash } from "./workspace-files";

export const RUNTIME_TRACE_ANALYZER_VERSION = "runtime-structural-v1";
export const RUNTIME_TRACE_POLICY_VERSION = "no-values-explicit-task-v1";
const PREFIX = "WITCH_TRACE_V1 ";
const MAX_EVENTS = 10_000;
const MAX_BUFFER = 64_000;
const MAX_FILE = 5_000_000;
const MAX_SESSIONS = 100;
const wireKeys = new Set(["phase", "path", "symbol", "line", "outcome"]);

type StackEntry = {
  semanticNodeId: string;
  enteredAt: number;
  eventIndex: number;
};

type ActiveTrace = {
  session: RuntimeTraceSession;
  graph: ArchitectureGraph;
  startedAtMs: number;
  buffer: string;
  stack: StackEntry[];
  write: Promise<void>;
};

export class RuntimeTraceService extends EventEmitter {
  private active = new Map<string, ActiveTrace>();
  constructor(
    private readonly directory: string,
    private readonly onWarning?: (message: string) => void,
  ) {
    super();
  }

  private workspaceDirectory(root: string) {
    return path.join(this.directory, contentHash(path.resolve(root)));
  }

  private sessionPath(root: string, id: string) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error("Invalid trace id");
    return path.join(this.workspaceDirectory(root), `${id}.json`);
  }

  private revision(session: Omit<RuntimeTraceSession, "validation">) {
    return contentHash(
      JSON.stringify({
        id: session.id,
        sourceRevision: session.sourceRevision,
        semanticRevision: session.semanticRevision,
        taskId: session.taskId,
        commandReceipt: session.commandReceipt,
        status: session.status,
        completedAt: session.completedAt,
        events: session.events,
        warnings: session.warnings,
      }),
    );
  }

  private canonical(active: ActiveTrace) {
    const { validation: _validation, ...draft } = active.session;
    draft.revision = this.revision(draft);
    active.session = finalizeRuntimeTraceSession(draft, active.graph.semantic!);
    return active.session;
  }

  private enqueuePersist(active: ActiveTrace) {
    const snapshot = structuredClone(this.canonical(active));
    const target = this.sessionPath(snapshot.workspaceRoot, snapshot.id);
    active.write = active.write
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = path.join(
          path.dirname(target),
          `.${path.basename(target)}.${randomUUID()}.tmp`,
        );
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(
            `${JSON.stringify(snapshot, null, 2)}\n`,
            "utf8",
          );
          await handle.sync();
          await handle.close();
          await fs.rename(temporary, target);
        } finally {
          await handle.close().catch(() => undefined);
          await fs.unlink(temporary).catch(() => undefined);
        }
      })
      .catch((error) => {
        this.onWarning?.(`Runtime trace could not be persisted: ${error}`);
      });
    this.emit("updated", structuredClone(active.session));
  }

  async start(input: {
    graph: ArchitectureGraph;
    taskId: string;
    taskLabel: string;
    commandReceipt: string;
  }) {
    if (!input.graph.semantic)
      throw new Error("Runtime trace requires a validated semantic graph");
    if (!input.graph.validation.valid || !input.graph.semantic.validation.valid)
      throw new Error(
        "Runtime trace requires a valid current architecture reading",
      );
    if (
      [...this.active.values()].some(
        (item) => item.session.status === "running",
      )
    )
      throw new Error("Stop the active runtime trace first");
    const id = randomUUID();
    const startedAt = new Date().toISOString();
    const draft = {
      schemaVersion: 1 as const,
      contract: "witch.runtime-trace/v1" as const,
      analyzerVersion: RUNTIME_TRACE_ANALYZER_VERSION,
      policyVersion: RUNTIME_TRACE_POLICY_VERSION,
      id,
      workspaceRoot: input.graph.workspaceRoot,
      sourceRevision: input.graph.revision,
      semanticRevision: input.graph.semantic.revision,
      taskId: input.taskId,
      taskLabel: input.taskLabel.slice(0, 200),
      startedAt,
      commandReceipt: input.commandReceipt,
      status: "running" as const,
      revision: "pending",
      events: [],
      warnings: [],
    };
    draft.revision = this.revision(draft);
    const session = finalizeRuntimeTraceSession(draft, input.graph.semantic);
    const active: ActiveTrace = {
      session,
      graph: input.graph,
      startedAtMs: Date.now(),
      buffer: "",
      stack: [],
      write: Promise.resolve(),
    };
    this.active.set(id, active);
    this.enqueuePersist(active);
    await active.write;
    return structuredClone(active.session);
  }

  private warn(active: ActiveTrace, code: string, message: string) {
    if (active.session.warnings.length >= 100) return;
    const warning: RuntimeTraceDiagnostic = {
      code,
      severity: "warning",
      subject: `event:${active.session.events.length + 1}`,
      message,
    };
    if (
      !active.session.warnings.some(
        (item) =>
          item.code === warning.code && item.subject === warning.subject,
      )
    )
      active.session.warnings.push(warning);
  }

  private resolveSymbol(active: ActiveTrace, wire: RuntimeTraceWireEvent) {
    const normalized = wire.path.replaceAll("\\", "/");
    if (
      !normalized ||
      path.isAbsolute(wire.path) ||
      normalized.split("/").some((part) => part === "..")
    )
      return null;
    const candidates = active.graph.semantic!.nodes.filter(
      (node) =>
        node.kind === "symbol" &&
        node.path?.replaceAll("\\", "/") === normalized &&
        (node.label === wire.symbol ||
          node.label.endsWith(`.${wire.symbol}`) ||
          node.label.endsWith(`::${wire.symbol}`)) &&
        (wire.line === undefined ||
          node.evidence.some(
            (item) =>
              item.line === wire.line ||
              (item.endLine !== undefined &&
                item.line <= wire.line! &&
                item.endLine >= wire.line!),
          )),
    );
    return candidates.length === 1 ? candidates[0].id : null;
  }

  private acceptWire(active: ActiveTrace, value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      this.warn(
        active,
        "TRACE_WIRE_INVALID",
        "Trace marker was not a structural object",
      );
      return;
    }
    const record = value as Record<string, unknown>;
    if (Object.keys(record).some((key) => !wireKeys.has(key))) {
      this.warn(
        active,
        "TRACE_WIRE_VALUE_FIELD_DROPPED",
        "Trace marker contained non-structural fields; the entire marker was dropped",
      );
      return;
    }
    if (
      !["enter", "exit", "error"].includes(String(record.phase)) ||
      typeof record.path !== "string" ||
      typeof record.symbol !== "string" ||
      record.path.length > 500 ||
      record.symbol.length > 200 ||
      (record.line !== undefined &&
        (!Number.isSafeInteger(record.line) || Number(record.line) < 1)) ||
      (record.outcome !== undefined &&
        !["ok", "error"].includes(String(record.outcome)))
    ) {
      this.warn(
        active,
        "TRACE_WIRE_INVALID",
        "Trace marker failed structural validation",
      );
      return;
    }
    if (active.session.events.length >= MAX_EVENTS) {
      this.warn(
        active,
        "TRACE_EVENT_LIMIT_REACHED",
        `Trace reached the ${MAX_EVENTS} structural event limit`,
      );
      return;
    }
    const wire: RuntimeTraceWireEvent = {
      phase: record.phase as RuntimeTraceWireEvent["phase"],
      path: record.path,
      symbol: record.symbol,
      ...(record.line !== undefined ? { line: Number(record.line) } : {}),
      ...(record.outcome !== undefined
        ? { outcome: record.outcome as "ok" | "error" }
        : {}),
    };
    const semanticNodeId = this.resolveSymbol(active, wire);
    if (!semanticNodeId) {
      this.warn(
        active,
        "TRACE_SYMBOL_UNRESOLVED",
        "Trace marker did not resolve to one unique current semantic symbol",
      );
      return;
    }
    const now = Date.now();
    const sequence = active.session.events.length + 1;
    const parent = active.stack.at(-1)?.semanticNodeId;
    if (wire.phase === "enter") {
      active.session.events.push({
        id: `trace:${active.session.id}:event:${sequence}`,
        sequence,
        phase: "enter",
        semanticNodeId,
        ...(parent ? { parentSemanticNodeId: parent } : {}),
        offsetMs: Math.max(0, now - active.startedAtMs),
        outcome: "unknown",
      });
      active.stack.push({
        semanticNodeId,
        enteredAt: now,
        eventIndex: active.session.events.length - 1,
      });
      return;
    }
    let stackIndex = -1;
    for (let index = active.stack.length - 1; index >= 0; index--)
      if (active.stack[index].semanticNodeId === semanticNodeId) {
        stackIndex = index;
        break;
      }
    if (stackIndex < 0) {
      this.warn(
        active,
        "TRACE_STACK_MISMATCH",
        "Trace exit/error marker had no matching active symbol entry",
      );
      return;
    }
    const entry = active.stack[stackIndex];
    const durationMs = Math.max(0, now - entry.enteredAt);
    const outcome =
      wire.phase === "error" || wire.outcome === "error" ? "error" : "ok";
    active.session.events[entry.eventIndex].durationMs = durationMs;
    active.session.events[entry.eventIndex].outcome = outcome;
    active.session.events.push({
      id: `trace:${active.session.id}:event:${sequence}`,
      sequence,
      phase: wire.phase,
      semanticNodeId,
      ...(stackIndex > 0
        ? { parentSemanticNodeId: active.stack[stackIndex - 1].semanticNodeId }
        : {}),
      offsetMs: Math.max(0, now - active.startedAtMs),
      durationMs,
      outcome,
    });
    active.stack.splice(stackIndex);
  }

  ingest(id: string, data: string) {
    const active = this.active.get(id);
    if (!active || active.session.status !== "running" || !data) return;
    active.buffer = (active.buffer + data).slice(-MAX_BUFFER);
    const lines = active.buffer.split(/\r?\n/);
    active.buffer = lines.pop() || "";
    let changed = false;
    for (const line of lines) {
      const marker = line.indexOf(PREFIX);
      if (marker < 0) continue;
      const payload = line.slice(marker + PREFIX.length).trim();
      if (!payload || payload.length > 2_000) {
        this.warn(
          active,
          "TRACE_WIRE_SIZE_INVALID",
          "Trace marker was empty or oversized",
        );
        changed = true;
        continue;
      }
      try {
        this.acceptWire(active, JSON.parse(payload));
      } catch {
        this.warn(
          active,
          "TRACE_WIRE_JSON_INVALID",
          "Trace marker was not valid JSON",
        );
      }
      changed = true;
    }
    if (changed) this.enqueuePersist(active);
  }

  async finish(id: string, status: Exclude<RuntimeTraceStatus, "running">) {
    const active = this.active.get(id);
    if (!active) return null;
    if (active.buffer.includes(PREFIX)) this.ingest(id, "\n");
    active.session.status = status;
    active.session.completedAt = new Date().toISOString();
    if (active.stack.length)
      this.warn(
        active,
        "TRACE_STACK_INCOMPLETE",
        `${active.stack.length} entered symbol(s) did not emit an exit marker`,
      );
    active.stack = [];
    this.enqueuePersist(active);
    await active.write;
    this.active.delete(id);
    return structuredClone(active.session);
  }

  get(id: string) {
    const active = this.active.get(id);
    return active ? structuredClone(active.session) : null;
  }

  runningIds(root?: string) {
    return [...this.active.values()]
      .filter((item) => !root || item.session.workspaceRoot === root)
      .map((item) => item.session.id);
  }

  async interruptAll(root?: string) {
    return Promise.all(
      this.runningIds(root).map((id) => this.finish(id, "interrupted")),
    );
  }

  async list(root: string, graph?: ArchitectureGraph) {
    const directory = this.workspaceDirectory(root);
    const entries = await fs
      .readdir(directory, { withFileTypes: true })
      .catch(() => []);
    const sessions: RuntimeTraceSession[] = [];
    for (const entry of entries
      .filter(
        (item) => item.isFile() && /^[a-f0-9-]{36}\.json$/i.test(item.name),
      )
      .slice(0, MAX_SESSIONS)) {
      const target = path.join(directory, entry.name);
      try {
        const stat = await fs.stat(target);
        if (stat.size > MAX_FILE) throw new Error("trace file exceeds 5 MB");
        const parsed = JSON.parse(
          await fs.readFile(target, "utf8"),
        ) as RuntimeTraceSession;
        const validation = validateRuntimeTraceSession(parsed, graph?.semantic);
        if (!validation.valid)
          throw new Error(
            validation.diagnostics
              .filter((item) => item.severity === "error")
              .slice(0, 3)
              .map((item) => item.code)
              .join(", "),
          );
        sessions.push({ ...parsed, validation });
      } catch (error) {
        this.onWarning?.(
          `Runtime trace ${entry.name} was preserved but not loaded: ${error}`,
        );
      }
    }
    for (const active of this.active.values())
      if (
        active.session.workspaceRoot === root &&
        !sessions.some((item) => item.id === active.session.id)
      )
        sessions.push(structuredClone(active.session));
    return sessions
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, MAX_SESSIONS);
  }

  async flush() {
    await Promise.all([...this.active.values()].map((item) => item.write));
  }
}
