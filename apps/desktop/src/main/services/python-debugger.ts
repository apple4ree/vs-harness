import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { windowsSystemExecutable } from "./cli-discovery";
import { BreakpointStore } from "./breakpoint-store";
import { normalizedRelative, resolveWorkspacePath } from "./workspace-files";
import type {
  Breakpoint,
  DebugAction,
  DebugFrame,
  DebugState,
  DebugVariable,
  LaunchConfiguration,
} from "../../shared/execution";

type ResolvedPythonLaunch = LaunchConfiguration & {
  type: "python";
  cwd: string;
  interpreter: string;
};
type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type EventWaiter = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Session = {
  root: string;
  child: ChildProcessWithoutNullStreams;
  launch: ResolvedPythonLaunch;
  nextSequence: number;
  pending: Map<number, Pending>;
  waiters: Map<string, EventWaiter[]>;
  buffer: Buffer;
  expected: number | null;
  objects: Map<string, number>;
  threadId: number | null;
  ended: boolean;
};

const MAX_MESSAGE = 16 * 1024 * 1024;

export class PythonDebugService extends EventEmitter {
  private session: Session | null = null;
  private starting = false;
  private stopping: Promise<void> | null = null;
  private generation = 0;
  private state: DebugState = {
    root: null,
    adapter: "python",
    status: "idle",
    frames: [],
    output: "",
    breakpoints: [],
  };
  private breakpointsByRoot = new Map<string, Breakpoint[]>();
  private breakpointStore?: BreakpointStore;
  private breakpointMutations: Promise<unknown> = Promise.resolve();
  private adapterArguments: string[];
  constructor(
    options: { breakpointDirectory?: string; adapterArguments?: string[] } = {},
  ) {
    super();
    this.adapterArguments = options.adapterArguments || ["-m", "debugpy.adapter"];
    if (options.breakpointDirectory)
      this.breakpointStore = new BreakpointStore(
        options.breakpointDirectory,
        /\.pyi?$/i,
      );
  }
  isRunning() {
    return this.starting || Boolean(this.session) || Boolean(this.stopping);
  }
  status() {
    return {
      ...this.state,
      frames: [...this.state.frames],
      breakpoints: [...this.state.breakpoints],
    };
  }
  private publish() {
    this.emit("state", this.status());
  }
  private appendOutput(value: string) {
    this.state.output = (this.state.output + value).slice(-100_000);
    this.publish();
  }
  private async canonicalRoot(root: string) {
    return fs.realpath(root);
  }
  breakpoints(root: string) {
    return (this.breakpointsByRoot.get(path.resolve(root)) || []).map(
      (item) => ({ ...item }),
    );
  }
  async loadBreakpoints(root: string) {
    root = await this.canonicalRoot(root);
    if (!this.breakpointsByRoot.has(root))
      this.breakpointsByRoot.set(
        root,
        (await this.breakpointStore?.load(root)) || [],
      );
    return this.breakpoints(root);
  }
  async setBreakpoints(root: string, file: string, lines: number[]) {
    if (
      !Array.isArray(lines) ||
      lines.length > 500 ||
      lines.some(
        (line) => !Number.isSafeInteger(line) || line < 1 || line > 1_000_000,
      )
    )
      throw new Error("Invalid breakpoints");
    if (!/\.pyi?$/i.test(file))
      throw new Error("Python breakpoints require a .py or .pyi file");
    root = await this.canonicalRoot(root);
    file = normalizedRelative(file);
    await resolveWorkspacePath(root, file);
    const update = this.breakpointMutations
      .catch(() => undefined)
      .then(async () => {
        await this.loadBreakpoints(root);
        const next = [
          ...this.breakpoints(root).filter((item) => item.path !== file),
          ...[...new Set(lines)].map((line) => ({
            path: file,
            line,
            verified: false,
          })),
        ];
        await this.breakpointStore?.save(root, next);
        this.breakpointsByRoot.set(root, next);
        if (this.state.root === root) {
          this.state.breakpoints = this.breakpoints(root);
          this.publish();
        }
        if (this.session?.root === root)
          await this.applyFileBreakpoints(this.session, file);
        return this.breakpoints(root);
      });
    this.breakpointMutations = update;
    return update;
  }
  async relocateBreakpoints(
    root: string,
    source: string,
    destination?: string,
  ) {
    if (this.isRunning())
      throw new Error("Stop the debugger before moving or deleting files");
    root = await this.canonicalRoot(root);
    source = normalizedRelative(source);
    if (destination !== undefined)
      destination = normalizedRelative(destination);
    const key = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    await this.loadBreakpoints(root);
    const prefix = key(source);
    const next = this.breakpoints(root).flatMap((point) => {
      const file = key(point.path);
      if (file !== prefix && !file.startsWith(prefix + "/")) return [point];
      if (destination === undefined) return [];
      const relocated = destination + point.path.slice(source.length);
      return /\.pyi?$/i.test(relocated)
        ? [{ path: relocated, line: point.line, verified: false }]
        : [];
    });
    await this.breakpointStore?.save(root, next);
    this.breakpointsByRoot.set(root, next);
    return this.breakpoints(root);
  }
  async flush() {
    await this.breakpointMutations;
  }
  private send(session: Session, message: object) {
    const body = Buffer.from(JSON.stringify(message), "utf8");
    session.child.stdin.write(
      Buffer.concat([
        Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii"),
        body,
      ]),
    );
  }
  private request(
    session: Session,
    command: string,
    args: unknown = {},
    timeout = 15_000,
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (session.ended) return reject(new Error("Debug session ended"));
      const seq = ++session.nextSequence;
      const timer = setTimeout(() => {
        session.pending.delete(seq);
        reject(new Error(`${command} timed out`));
      }, timeout);
      session.pending.set(seq, { resolve, reject, timer });
      this.send(session, {
        seq,
        type: "request",
        command,
        arguments: args,
      });
    });
  }
  private waitForEvent(session: Session, event: string, timeout = 15_000) {
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        const current = session.waiters.get(event) || [];
        session.waiters.set(
          event,
          current.filter((item) => item.resolve !== resolve),
        );
        reject(new Error(`${event} event timed out`));
      }, timeout);
      const current = session.waiters.get(event) || [];
      current.push({ resolve, reject, timer });
      session.waiters.set(event, current);
    });
  }
  private receive(session: Session, chunk: Buffer) {
    if (this.session !== session || session.ended) return;
    session.buffer = Buffer.concat([session.buffer, chunk]);
    while (true) {
      if (session.expected === null) {
        const boundary = session.buffer.indexOf("\r\n\r\n");
        if (boundary < 0) {
          if (session.buffer.length > 8192)
            this.fail(session, new Error("Invalid debug adapter headers"));
          return;
        }
        const header = session.buffer.subarray(0, boundary).toString("ascii");
        session.buffer = session.buffer.subarray(boundary + 4);
        const length = header.match(/(?:^|\r\n)Content-Length:\s*(\d+)/i);
        const expected = Number(length?.[1]);
        if (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_MESSAGE) {
          this.fail(session, new Error("Invalid debug adapter message length"));
          return;
        }
        session.expected = expected;
      }
      if (session.buffer.length < session.expected) return;
      const body = session.buffer.subarray(0, session.expected);
      session.buffer = session.buffer.subarray(session.expected);
      session.expected = null;
      let message: any;
      try {
        message = JSON.parse(body.toString("utf8"));
      } catch {
        this.fail(session, new Error("Debug adapter sent invalid JSON"));
        return;
      }
      this.message(session, message);
    }
  }
  private message(session: Session, message: any) {
    if (message?.type === "response" && Number.isInteger(message.request_seq)) {
      const pending = session.pending.get(message.request_seq);
      if (!pending) return;
      clearTimeout(pending.timer);
      session.pending.delete(message.request_seq);
      if (message.success === false)
        pending.reject(
          new Error(
            String(message.message || message.body?.error?.format || "Debug adapter request failed").slice(
              0,
              2000,
            ),
          ),
        );
      else pending.resolve(message.body || {});
      return;
    }
    if (message?.type !== "event" || typeof message.event !== "string")
      return;
    const waiters = session.waiters.get(message.event) || [];
    session.waiters.delete(message.event);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve(message.body || {});
    }
    if (message.event === "output" && typeof message.body?.output === "string")
      this.appendOutput(message.body.output);
    if (message.event === "stopped")
      void this.pause(session, message.body).catch((error) =>
        this.fail(session, error as Error),
      );
    if (message.event === "continued") {
      this.state.status = "running";
      this.state.frames = [];
      session.objects.clear();
      this.publish();
    }
    if (message.event === "terminated" || message.event === "exited") {
      this.state.status = "stopped";
      this.state.frames = [];
      this.state.reason =
        message.event === "exited"
          ? `Process exited (${message.body?.exitCode ?? "unknown"})`
          : "Program terminated";
      this.publish();
      void this.stop().catch(() => undefined);
    }
  }
  private relative(root: string, sourcePath: unknown) {
    if (typeof sourcePath !== "string" || !path.isAbsolute(sourcePath))
      return undefined;
    const relative = path.relative(root, sourcePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined;
    try {
      return normalizedRelative(relative);
    } catch {
      return undefined;
    }
  }
  private async pause(session: Session, body: any) {
    const threadId = Number(body?.threadId);
    if (!Number.isSafeInteger(threadId) || threadId <= 0)
      throw new Error("Debug adapter stopped without a valid thread");
    session.threadId = threadId;
    session.objects.clear();
    const stack = await this.request(session, "stackTrace", {
      threadId,
      startFrame: 0,
      levels: 100,
    });
    const frames: DebugFrame[] = [];
    for (const frame of (stack.stackFrames || []).slice(0, 100)) {
      if (!Number.isSafeInteger(frame.id)) continue;
      const scopes = await this.request(session, "scopes", {
        frameId: frame.id,
      });
      frames.push({
        id: String(frame.id),
        name: String(frame.name || "(python)").slice(0, 500),
        path: this.relative(session.root, frame.source?.path),
        line: Number.isSafeInteger(frame.line) ? frame.line : 1,
        column: Number.isSafeInteger(frame.column) ? frame.column : 1,
        scopes: (scopes.scopes || [])
          .filter((scope: any) => Number.isSafeInteger(scope.variablesReference))
          .slice(0, 50)
          .map((scope: any) => {
            const id = `${this.generation}:${scope.variablesReference}`;
            session.objects.set(id, scope.variablesReference);
            return {
              name: String(scope.name || "Scope").slice(0, 200),
              type: scope.expensive ? "closure" : "local",
              objectId: id,
            };
          }),
      });
    }
    this.state.status = "paused";
    this.state.reason = String(body?.reason || "breakpoint").slice(0, 500);
    this.state.frames = frames;
    this.publish();
  }
  private async applyFileBreakpoints(session: Session, file: string) {
    const absolute = await resolveWorkspacePath(session.root, file);
    const points = this.breakpoints(session.root).filter(
      (item) => item.path === file,
    );
    const result = await this.request(session, "setBreakpoints", {
      source: { path: absolute },
      breakpoints: points.map((point) => ({ line: point.line })),
      sourceModified: false,
    });
    const received = Array.isArray(result.breakpoints)
      ? result.breakpoints
      : [];
    const stored = this.breakpointsByRoot.get(session.root) || [];
    for (const [index, point] of points.entries()) {
      const target = stored.find(
        (item) => item.path === point.path && item.line === point.line,
      );
      if (!target) continue;
      target.verified = received[index]?.verified === true;
      target.actualLine = Number.isSafeInteger(received[index]?.line)
        ? received[index].line
        : undefined;
    }
    this.state.breakpoints = this.breakpoints(session.root);
    this.publish();
  }
  async start(root: string, launch: ResolvedPythonLaunch) {
    if (this.isRunning())
      throw new Error("Stop the current debug session first");
    if (!path.isAbsolute(launch.interpreter))
      throw new Error("Python debugger requires an absolute interpreter path");
    this.starting = true;
    const generation = ++this.generation;
    try {
      root = await this.canonicalRoot(root);
      await this.loadBreakpoints(root);
      const program = await resolveWorkspacePath(
        root,
        path.relative(root, launch.program),
      );
      if (!/\.py$/i.test(program))
        throw new Error("Python debugging requires a .py program");
      this.state = {
        root,
        adapter: "python",
        status: "starting",
        name: launch.name,
        frames: [],
        output: "",
        breakpoints: this.breakpoints(root),
      };
      this.publish();
      const child = spawn(launch.interpreter, this.adapterArguments, {
        cwd: launch.cwd,
        env: { ...process.env, ...launch.env, PYTHONUNBUFFERED: "1" },
        stdio: "pipe",
        windowsHide: true,
        detached: process.platform !== "win32",
      });
      const session: Session = {
        root,
        child,
        launch,
        nextSequence: 0,
        pending: new Map(),
        waiters: new Map(),
        buffer: Buffer.alloc(0),
        expected: null,
        objects: new Map(),
        threadId: null,
        ended: false,
      };
      this.session = session;
      child.stdout.on("data", (chunk) => this.receive(session, chunk));
      child.stderr.on("data", (chunk) => {
        if (this.session === session) this.appendOutput(chunk.toString("utf8"));
      });
      child.once("error", (error) => this.fail(session, error));
      child.once("exit", (code, signal) => {
        if (this.session !== session || session.ended) return;
        const missing = this.state.output.includes("No module named debugpy");
        this.state.status = code === 0 || signal ? "stopped" : "failed";
        this.state.error = missing
          ? "debugpy is not installed in the selected environment. Run: python -m pip install debugpy"
          : code === 0 || signal
            ? undefined
            : `Python debug adapter exited with code ${code}`;
        this.state.frames = [];
        this.end(session);
        this.publish();
      });
      try {
        await this.request(session, "initialize", {
          clientID: "witch",
          clientName: "Witch",
          adapterID: "python",
          pathFormat: "path",
          linesStartAt1: true,
          columnsStartAt1: true,
          supportsVariableType: true,
          supportsVariablePaging: false,
          supportsRunInTerminalRequest: false,
        });
        if (generation !== this.generation || this.session !== session)
          throw new Error("Debug start canceled");
        const initialized = this.waitForEvent(session, "initialized");
        const launched = this.request(
          session,
          "launch",
          {
            name: launch.name,
            type: "python",
            request: "launch",
            program,
            cwd: launch.cwd,
            args: launch.args,
            env: launch.env || {},
            python: [launch.interpreter],
            justMyCode: true,
            subProcess: false,
            redirectOutput: true,
            console: "internalConsole",
            stopOnEntry: launch.stopOnEntry,
          },
          30_000,
        );
        await initialized;
        for (const file of new Set(
          this.breakpoints(root).map((item) => item.path),
        ))
          await this.applyFileBreakpoints(session, file);
        await this.request(session, "setExceptionBreakpoints", {
          filters: ["uncaught"],
        });
        await this.request(session, "configurationDone");
        await launched;
        this.state.status = "running";
        this.publish();
        return this.status();
      } catch (error) {
        const failure =
          this.session !== session && this.state.error
            ? new Error(this.state.error)
            : (error as Error);
        this.fail(session, failure);
        throw failure;
      }
    } finally {
      this.starting = false;
    }
  }
  async action(action: DebugAction) {
    const session = this.session;
    if (!session) throw new Error("No debug session is running");
    if (action === "stop") {
      await this.stop();
      return this.status();
    }
    if (
      !["continue", "pause", "stepOver", "stepInto", "stepOut"].includes(
        action,
      )
    )
      throw new Error("Unknown debug action");
    if (action !== "pause" && this.state.status !== "paused")
      throw new Error("Pause the program before stepping");
    let threadId = session.threadId;
    if (!threadId) {
      const threads = await this.request(session, "threads");
      threadId = threads.threads?.[0]?.id;
    }
    if (!Number.isSafeInteger(threadId))
      throw new Error("The Python debug thread is not available");
    const command =
      action === "stepOver"
        ? "next"
        : action === "stepInto"
          ? "stepIn"
          : action === "stepOut"
            ? "stepOut"
            : action;
    await this.request(session, command, { threadId });
    return this.status();
  }
  async variables(objectId: string): Promise<DebugVariable[]> {
    const session = this.session;
    const reference = session?.objects.get(objectId);
    if (!session || this.state.status !== "paused" || !reference)
      throw new Error("Select a scope from the paused call stack");
    const result = await this.request(session, "variables", {
      variablesReference: reference,
    });
    return (result.variables || []).slice(0, 250).map((item: any) => {
      const nested = Number(item.variablesReference);
      const id = Number.isSafeInteger(nested) && nested > 0
        ? `${this.generation}:${nested}`
        : undefined;
      if (id) session.objects.set(id, nested);
      return {
        name: String(item.name || "").slice(0, 500),
        value: String(item.value ?? "").slice(0, 1000),
        type: String(item.type || "python").slice(0, 200),
        ...(id ? { objectId: id } : {}),
      };
    });
  }
  private end(session: Session) {
    session.ended = true;
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Debug session ended"));
    }
    session.pending.clear();
    for (const waiters of session.waiters.values())
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error("Debug session ended"));
      }
    session.waiters.clear();
    if (this.session === session) this.session = null;
  }
  private fail(session: Session, error: Error) {
    if (this.session !== session) return;
    this.state.status = "failed";
    this.state.error = error.message;
    this.state.frames = [];
    this.publish();
    void this.stop().finally(() => {
      if (!this.session && this.state.root === session.root) {
        this.state.status = "failed";
        this.state.error = error.message;
        this.publish();
      }
    });
  }
  private kill(session: Session) {
    if (!session.child.pid || session.child.exitCode !== null) return;
    if (process.platform === "win32") {
      const killer = spawn(
        windowsSystemExecutable("taskkill.exe"),
        ["/PID", String(session.child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", () => session.child.kill());
      return;
    }
    try {
      process.kill(-session.child.pid, "SIGKILL");
    } catch {
      session.child.kill();
    }
  }
  async stop() {
    this.generation++;
    if (this.stopping) return this.stopping;
    const session = this.session;
    if (!session) return;
    const operation = (async () => {
      await this.request(session, "disconnect", {
        restart: false,
        terminateDebuggee: true,
      }, 2000).catch(() => undefined);
      this.end(session);
      if (session.child.exitCode === null) this.kill(session);
      await new Promise<void>((resolve) => {
        if (session.child.exitCode !== null) return resolve();
        const timer = setTimeout(resolve, 5000);
        session.child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      this.state.status = "stopped";
      this.state.frames = [];
      this.publish();
    })();
    this.stopping = operation;
    try {
      await operation;
    } finally {
      if (this.stopping === operation) this.stopping = null;
    }
  }
}
