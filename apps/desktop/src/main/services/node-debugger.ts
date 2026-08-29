import { EventEmitter } from "node:events";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { normalizedRelative, resolveWorkspacePath } from "./workspace-files";
import { BreakpointStore } from "./breakpoint-store";
import { windowsSystemExecutable } from "./cli-discovery";
import type {
  Breakpoint,
  DebugAction,
  DebugState,
  DebugVariable,
  LaunchConfiguration,
} from "../../shared/execution";

type ResolvedLaunch = LaunchConfiguration & { cwd: string };
type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};
type Session = {
  root: string;
  child: ChildProcessWithoutNullStreams;
  socket: WebSocket | null;
  nextId: number;
  pending: Map<number, Pending>;
  scripts: Map<string, string>;
  breakpointIds: Map<string, string[]>;
  objects: Set<string>;
  ended: boolean;
  firstPause: boolean;
  launch: ResolvedLaunch;
};

export class NodeDebugService extends EventEmitter {
  private session: Session | null = null;
  private starting = false;
  private stopping: Promise<void> | null = null;
  private generation = 0;
  private state: DebugState = {
    root: null,
    status: "idle",
    frames: [],
    output: "",
    breakpoints: [],
  };
  private breakpointsByRoot = new Map<string, Breakpoint[]>();
  private breakpointQueue: Promise<void> = Promise.resolve();
  private breakpointMutations: Promise<unknown> = Promise.resolve();
  private breakpointLoads = new Map<string, Promise<Breakpoint[]>>();
  private breakpointStore?: BreakpointStore;
  constructor(
    private options: {
      runtime: string;
      runAsNode?: boolean;
      breakpointDirectory?: string;
    },
  ) {
    super();
    if (options.breakpointDirectory)
      this.breakpointStore = new BreakpointStore(options.breakpointDirectory);
  }
  isRunning() {
    return this.starting || Boolean(this.session) || Boolean(this.stopping);
  }
  async flush() {
    await this.breakpointMutations;
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
  private output(chunk: string) {
    this.state.output = (this.state.output + chunk).slice(-100_000);
    this.publish();
  }
  breakpoints(root: string) {
    return (this.breakpointsByRoot.get(root) || []).map((item) => ({
      ...item,
    }));
  }
  async loadBreakpoints(root: string): Promise<Breakpoint[]> {
    if (this.breakpointsByRoot.has(root)) return this.breakpoints(root);
    let loading = this.breakpointLoads.get(root);
    if (!loading) {
      loading = (async () => {
        const points = (await this.breakpointStore?.load(root)) || [];
        this.breakpointsByRoot.set(root, points);
        return this.breakpoints(root);
      })();
      this.breakpointLoads.set(root, loading);
    }
    try {
      return await loading;
    } finally {
      if (this.breakpointLoads.get(root) === loading)
        this.breakpointLoads.delete(root);
    }
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
    if (!/\.[cm]?js$/i.test(file))
      throw new Error("Breakpoints currently support JavaScript files only");
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
          this.state.breakpoints = next;
          this.publish();
        }
        if (
          this.session?.root === root &&
          this.session.socket?.readyState === WebSocket.OPEN
        ) {
          const session = this.session;
          this.breakpointQueue = this.breakpointQueue
            .catch(() => undefined)
            .then(() => this.applyFileBreakpoints(session, file));
          await this.breakpointQueue;
        }
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
    source = normalizedRelative(source);
    if (destination !== undefined)
      destination = normalizedRelative(destination);
    const key = (value: string) =>
      process.platform === "win32" ? value.toLowerCase() : value;
    const prefix = key(source);
    const update = this.breakpointMutations
      .catch(() => undefined)
      .then(async () => {
        await this.loadBreakpoints(root);
        if (this.isRunning())
          throw new Error("Stop the debugger before moving or deleting files");
        const current = this.breakpoints(root);
        const relocatedPoints = current.flatMap((point) => {
          const file = key(point.path);
          if (file !== prefix && !file.startsWith(prefix + "/")) return [point];
          if (destination === undefined) return [];
          const relocated = destination + point.path.slice(source.length);
          return /\.[cm]?js$/i.test(relocated)
            ? [{ path: relocated, line: point.line, verified: false }]
            : [];
        });
        const next = [
          ...new Map<string, Breakpoint>(
            relocatedPoints.map((point) => [
              `${key(point.path)}:${point.line}`,
              point,
            ]),
          ).values(),
        ];
        if (JSON.stringify(current) === JSON.stringify(next)) return current;
        await this.breakpointStore?.save(root, next);
        this.breakpointsByRoot.set(root, next);
        if (this.state.root === root) {
          this.state.breakpoints = next;
          this.publish();
        }
        return this.breakpoints(root);
      });
    this.breakpointMutations = update;
    return update;
  }
  private request(
    session: Session,
    method: string,
    params: unknown = {},
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      if (session.ended || session.socket?.readyState !== WebSocket.OPEN) {
        reject(new Error("Debugger is not connected"));
        return;
      }
      const id = ++session.nextId;
      const timer = setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 10_000);
      session.pending.set(id, { resolve, reject, timer });
      session.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  private relative(session: Session, url: string) {
    try {
      return url.startsWith("file:")
        ? normalizedRelative(path.relative(session.root, fileURLToPath(url)))
        : undefined;
    } catch {
      return undefined;
    }
  }
  private message(session: Session, message: any) {
    if (this.session !== session || session.ended) return;
    if (typeof message.id === "number") {
      const pending = session.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      session.pending.delete(message.id);
      message.error
        ? pending.reject(new Error(message.error.message))
        : pending.resolve(message.result);
      return;
    }
    const params = message.params || {};
    if (message.method === "Debugger.scriptParsed")
      session.scripts.set(params.scriptId, params.url);
    if (message.method === "Debugger.breakpointResolved") {
      for (const [file, ids] of session.breakpointIds) {
        const index = ids.indexOf(params.breakpointId);
        if (index < 0) continue;
        const item = this.breakpointsByRoot
          .get(session.root)
          ?.filter((point) => point.path === file)[index];
        if (item) {
          item.verified = true;
          item.actualLine = params.location.lineNumber + 1;
          this.state.breakpoints = this.breakpoints(session.root);
          this.publish();
        }
      }
    }
    if (message.method === "Debugger.paused") {
      if (
        session.firstPause &&
        !session.launch.stopOnEntry &&
        params.reason === "Break on start"
      ) {
        session.firstPause = false;
        void this.request(session, "Debugger.resume").catch((error) =>
          this.fail(session, error),
        );
        return;
      }
      session.firstPause = false;
      session.objects.clear();
      this.state.status = "paused";
      this.state.reason = params.reason;
      this.state.frames = (params.callFrames || [])
        .slice(0, 100)
        .map((frame: any) => ({
          id: frame.callFrameId,
          name: frame.functionName || "(anonymous)",
          path: this.relative(
            session,
            frame.url || session.scripts.get(frame.location.scriptId) || "",
          ),
          line: frame.location.lineNumber + 1,
          column: frame.location.columnNumber + 1,
          scopes: (frame.scopeChain || [])
            .filter((scope: any) => scope.object?.objectId)
            .map((scope: any) => {
              session.objects.add(scope.object.objectId);
              return {
                name: scope.name || scope.type,
                type: scope.type,
                objectId: scope.object.objectId,
              };
            }),
        }));
      this.publish();
    }
    if (message.method === "Debugger.resumed") {
      this.state.status = "running";
      this.state.frames = [];
      session.objects.clear();
      this.publish();
    }
  }
  private async applyFileBreakpoints(session: Session, file: string) {
    for (const id of session.breakpointIds.get(file) || [])
      await this.request(session, "Debugger.removeBreakpoint", {
        breakpointId: id,
      });
    const points =
      this.breakpointsByRoot
        .get(session.root)
        ?.filter((item) => item.path === file) || [];
    const ids: string[] = [];
    for (const point of points) {
      const target = await resolveWorkspacePath(session.root, file);
      const result = await this.request(
        session,
        "Debugger.setBreakpointByUrl",
        { lineNumber: point.line - 1, url: pathToFileURL(target).href },
      );
      ids.push(result.breakpointId);
      point.verified = Boolean(result.locations?.length);
      point.actualLine = result.locations?.[0]
        ? result.locations[0].lineNumber + 1
        : undefined;
    }
    session.breakpointIds.set(file, ids);
    this.state.breakpoints = this.breakpoints(session.root);
    this.publish();
  }
  async start(root: string, launch: ResolvedLaunch) {
    if (this.isRunning())
      throw new Error("Stop the current debug session first");
    this.starting = true;
    const generation = ++this.generation;
    try {
      await this.loadBreakpoints(root);
      const target = await resolveWorkspacePath(
        root,
        path.relative(root, launch.program),
      );
      if (!(await fs.stat(target)).isFile())
        throw new Error("Debug program is not a file");
      if (generation !== this.generation)
        throw new Error("Debug start canceled");
      this.state = {
        root,
        status: "starting",
        name: launch.name,
        frames: [],
        output: "",
        breakpoints: this.breakpoints(root),
      };
      this.publish();
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        ...launch.env,
        ...(this.options.runAsNode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
      };
      delete env.NODE_OPTIONS;
      delete env.NODE_INSPECT_RESUME_ON_START;
      const child = spawn(
        this.options.runtime,
        ["--inspect-brk=127.0.0.1:0", target, ...launch.args],
        {
          cwd: launch.cwd,
          env,
          stdio: "pipe",
          windowsHide: true,
          detached: process.platform !== "win32",
        },
      );
      const session: Session = {
        root,
        child,
        socket: null,
        nextId: 0,
        pending: new Map(),
        scripts: new Map(),
        breakpointIds: new Map(),
        objects: new Set(),
        ended: false,
        firstPause: true,
        launch,
      };
      this.session = session;
      child.stdout.on("data", (chunk) => {
        if (this.session === session) this.output(chunk.toString("utf8"));
      });
      child.once("error", (error) => this.fail(session, error));
      child.once("exit", (code, signal) => {
        if (this.session !== session) return;
        this.state.status = code === 0 || signal ? "stopped" : "failed";
        this.state.frames = [];
        this.state.reason = `Process exited (${code ?? signal})`;
        this.end(session);
        this.publish();
      });
      try {
        const endpoint = await new Promise<string>((resolve, reject) => {
          let buffer = "";
          const timer = setTimeout(
            () =>
              reject(
                new Error("Node inspector did not start within 15 seconds"),
              ),
            15_000,
          );
          const failed = (error: Error) => {
            clearTimeout(timer);
            reject(error);
          };
          child.once("error", failed);
          child.once("exit", () => {
            clearTimeout(timer);
            reject(new Error("Debug process exited before connecting"));
          });
          child.stderr.on("data", (chunk) => {
            const text = chunk.toString("utf8");
            if (this.session === session) this.output(text);
            buffer = (buffer + text).slice(-4096);
            const match = buffer.match(
              /ws:\/\/127\.0\.0\.1:\d+\/[a-zA-Z0-9-]+/,
            );
            if (match) {
              clearTimeout(timer);
              child.off("error", failed);
              resolve(match[0]);
            }
            if (buffer.includes("Waiting for the debugger to disconnect"))
              session.socket?.close();
          });
        });
        if (this.session !== session) throw new Error("Debug session canceled");
        const socket = new WebSocket(endpoint);
        session.socket = socket;
        socket.addEventListener("message", (event) => {
          try {
            this.message(session, JSON.parse(String(event.data)));
          } catch (error) {
            this.fail(session, error as Error);
          }
        });
        socket.addEventListener("error", () => {
          if (this.session === session)
            this.fail(session, new Error("Inspector connection failed"));
        });
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Inspector connection timed out")),
            10_000,
          );
          socket.addEventListener(
            "open",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          socket.addEventListener(
            "error",
            () => {
              clearTimeout(timer);
              reject(new Error("Inspector connection failed"));
            },
            { once: true },
          );
        });
        await this.request(session, "Runtime.enable");
        await this.request(session, "Debugger.enable");
        await this.request(session, "Debugger.setPauseOnExceptions", {
          state: "uncaught",
        });
        for (const file of new Set(
          this.breakpoints(root).map((item) => item.path),
        ))
          await this.applyFileBreakpoints(session, file);
        this.state.status = "running";
        this.publish();
        await this.request(session, "Runtime.runIfWaitingForDebugger");
        return this.status();
      } catch (error) {
        this.fail(session, error as Error);
        throw error;
      }
    } finally {
      this.starting = false;
    }
  }
  private end(session: Session) {
    session.ended = true;
    session.socket?.close();
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Debug session ended"));
    }
    session.pending.clear();
    if (this.session === session) this.session = null;
  }
  private fail(session: Session, error: Error) {
    if (this.session !== session) return;
    this.state.status = "failed";
    this.state.error = error.message;
    this.state.frames = [];
    this.publish();
    void this.stop().then(
      () => {
        if (!this.session && this.state.root === session.root) {
          this.state.status = "failed";
          this.state.error = error.message;
          this.publish();
        }
      },
      () => undefined, // stop records a cleanup failure and keeps the session retryable.
    );
  }
  private signalProcess(session: Session) {
    if (!session.child.pid || session.child.exitCode !== null) return;
    if (process.platform === "win32") {
      const killer = spawn(
        windowsSystemExecutable("taskkill.exe"),
        ["/PID", String(session.child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", () => session.child.kill());
      killer.once("exit", (code) => {
        if (code !== 0 && session.child.exitCode === null) session.child.kill();
      });
      return;
    } else {
      try {
        // A debug launch owns a POSIX process group, including its ordinary
        // descendants. Explicit Stop must not leave spawned workers running.
        process.kill(-session.child.pid, "SIGKILL");
        return;
      } catch {
        // The group may already have exited; retain a direct-process fallback.
      }
    }
    session.child.kill();
  }
  async action(action: DebugAction) {
    const session = this.session;
    if (!session) throw new Error("No debug session is running");
    if (action === "stop") {
      await this.stop();
      return this.status();
    }
    if (
      !["continue", "pause", "stepOver", "stepInto", "stepOut"].includes(action)
    )
      throw new Error("Unknown debug action");
    if (action !== "pause" && this.state.status !== "paused")
      throw new Error("Pause the program before stepping");
    await this.request(
      session,
      `Debugger.${action === "continue" ? "resume" : action}`,
    );
    return this.status();
  }
  async variables(objectId: string): Promise<DebugVariable[]> {
    const session = this.session;
    if (
      !session ||
      this.state.status !== "paused" ||
      !session.objects.has(objectId)
    )
      throw new Error("Select a scope from the paused call stack");
    const result = await this.request(session, "Runtime.getProperties", {
      objectId,
      ownProperties: true,
      generatePreview: true,
    });
    return (result.result || []).slice(0, 250).map((item: any) => {
      if (item.value?.objectId) session.objects.add(item.value.objectId);
      return {
        name: item.name,
        value: item.get
          ? "[Getter — not invoked]"
          : String(
              item.value?.value ??
                item.value?.description ??
                item.value?.unserializableValue ??
                "undefined",
            ).slice(0, 500),
        type: item.value?.type || "accessor",
        objectId: item.value?.objectId,
      };
    });
  }
  async stop() {
    this.generation++;
    if (this.stopping) return this.stopping;
    const session = this.session;
    if (!session) return;
    const operation = this.stopSession(session);
    this.stopping = operation;
    try {
      await operation;
    } finally {
      if (this.stopping === operation) this.stopping = null;
    }
  }
  private async stopSession(session: Session) {
    this.end(session);
    try {
      await new Promise<void>((resolve, reject) => {
        if (
          !session.child.pid ||
          session.child.exitCode !== null ||
          session.child.signalCode !== null
        ) {
          resolve();
          return;
        }
        const done = () => {
          clearTimeout(timer);
          resolve();
        };
        const timer = setTimeout(() => {
          session.child.off("exit", done);
          reject(
            new Error(
              "Debug process did not exit within 5 seconds. Retry Stop before switching projects.",
            ),
          );
        }, 5000);
        session.child.once("exit", done);
        try {
          this.signalProcess(session);
        } catch (error) {
          clearTimeout(timer);
          session.child.off("exit", done);
          reject(error);
        }
      });
      this.state.status = "stopped";
      this.state.frames = [];
    } catch (error) {
      this.session = session;
      this.state.status = "failed";
      this.state.error = String(error);
      throw error;
    } finally {
      this.publish();
    }
  }
}
