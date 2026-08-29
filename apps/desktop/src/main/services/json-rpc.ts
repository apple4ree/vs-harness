import { EventEmitter } from "node:events";
import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process";
import { prepareCliCommand, windowsSystemExecutable } from "./cli-discovery";

export type RpcMessage = {
  jsonrpc?: "2.0";
  id?: string | number;
  method?: string;
  params?: any;
  result?: any;
  error?: { code?: number; message: string; data?: unknown };
};
export class RpcDecoder {
  private buffer: Buffer = Buffer.alloc(0);
  constructor(private format: "headers" | "lines") {}
  push(chunk: Buffer): RpcMessage[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (this.buffer.length > 32 * 1024 * 1024)
      throw new Error("RPC frame exceeded 32 MB");
    const messages: RpcMessage[] = [];
    while (this.buffer.length) {
      let body: Buffer;
      if (this.format === "lines") {
        const end = this.buffer.indexOf("\n");
        if (end < 0) break;
        body = this.buffer.subarray(0, end);
        this.buffer = this.buffer.subarray(end + 1);
      } else {
        const end = this.buffer.indexOf("\r\n\r\n");
        if (end < 0) break;
        const length = Number(
          this.buffer
            .subarray(0, end)
            .toString("ascii")
            .match(/content-length:\s*(\d+)/i)?.[1],
        );
        if (
          !Number.isSafeInteger(length) ||
          length < 0 ||
          length > 32 * 1024 * 1024
        )
          throw new Error("Invalid RPC Content-Length");
        if (this.buffer.length < end + 4 + length) break;
        body = this.buffer.subarray(end + 4, end + 4 + length);
        this.buffer = this.buffer.subarray(end + 4 + length);
      }
      if (body.toString("utf8").trim())
        messages.push(JSON.parse(body.toString("utf8")));
    }
    return messages;
  }
}

export class JsonRpcProcess extends EventEmitter {
  readonly child: ChildProcessWithoutNullStreams;
  private decoder: RpcDecoder;
  private nextId = 0;
  private closed = false;
  private processClosed = false;
  private disposal: Promise<void> | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  constructor(
    command: string,
    args: string[],
    private format: "headers" | "lines",
    options: SpawnOptionsWithoutStdio,
  ) {
    super();
    this.decoder = new RpcDecoder(format);
    const invocation = prepareCliCommand(command, args, options);
    this.child = spawn(invocation.command, invocation.args, {
      ...invocation.options,
      stdio: "pipe",
      windowsHide: true,
      // POSIX child tools get an owned process group, so closing a language server
      // or agent also signals its normal descendants. Keep Windows consoles hidden.
      detached: process.platform !== "win32",
    });
    this.child.stdout.on("data", (chunk: Buffer) => {
      try {
        for (const message of this.decoder.push(chunk)) this.receive(message);
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
        this.dispose();
      }
    });
    this.child.stderr.on("data", (chunk: Buffer) =>
      this.emit("log", chunk.toString("utf8")),
    );
    this.child.on("error", (error) => this.fail(error));
    this.child.stdin.on("error", (error) => this.fail(error));
    this.child.once("exit", (code, signal) =>
      this.fail(new Error(`Process exited (${code ?? signal ?? "unknown"})`)),
    );
    this.child.once("close", () => {
      this.processClosed = true;
    });
  }
  private receive(message: RpcMessage) {
    if (message.method) {
      this.emit(message.id === undefined ? "notification" : "request", message);
      return;
    }
    if (typeof message.id !== "number") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }
  isConnected() {
    return !this.closed && !this.processClosed && this.child.stdin.writable;
  }
  send(message: RpcMessage) {
    if (this.closed || !this.child.stdin.writable)
      throw new Error("RPC connection is closed");
    const body = JSON.stringify({ jsonrpc: "2.0", ...message });
    this.child.stdin.write(
      this.format === "lines"
        ? `${body}\n`
        : `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
    );
  }
  request<T = any>(
    method: string,
    params?: unknown,
    timeoutMs = 20_000,
  ): Promise<T> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  notify(method: string, params?: unknown) {
    this.send({ method, params });
  }
  reply(id: string | number, result: unknown) {
    this.send({ id, result });
  }
  reject(id: string | number, message: string) {
    this.send({ id, error: { code: -32601, message } });
  }
  private fail(error: Error) {
    if (this.closed) return;
    this.closed = true;
    this.pending.forEach((pending) => {
      clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pending.clear();
    this.emit("closed", error);
  }
  dispose() {
    void this.disposeAndWait().catch((error) =>
      this.emit("log", `Process cleanup: ${error}`),
    );
  }
  disposeAndWait(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.disposal = (async () => {
      this.fail(new Error("Connection stopped"));
      if (this.processClosed) return;
      let finished: () => void = () => undefined;
      const closed = new Promise<void>((resolve) => {
        finished = resolve;
        this.child.once("close", finished);
      });
      let force: NodeJS.Timeout | undefined;
      let timeout: NodeJS.Timeout | undefined;
      let killed: Promise<void> = Promise.resolve();
      const signalGroup = (signal: NodeJS.Signals) => {
        if (!this.child.pid || this.processClosed) return;
        try {
          process.kill(-this.child.pid, signal);
        } catch {
          this.child.kill(signal);
        }
      };
      if (
        process.platform === "win32" &&
        this.child.pid &&
        this.child.exitCode === null
      ) {
        killed = new Promise<void>((resolve) => {
          const killer = spawn(
            windowsSystemExecutable("taskkill.exe"),
            ["/PID", String(this.child.pid), "/T", "/F"],
            { windowsHide: true, stdio: "ignore" },
          );
          killer.once("error", () => {
            this.child.kill();
            resolve();
          });
          killer.once("close", () => resolve());
        });
      } else if (process.platform !== "win32") {
        signalGroup("SIGTERM");
        force = setTimeout(() => signalGroup("SIGKILL"), 1000);
      } else this.child.kill();
      try {
        await Promise.race([
          Promise.all([closed, killed]),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () =>
                reject(
                  new Error("Owned tool process did not stop within 5 seconds"),
                ),
              5000,
            );
          }),
        ]);
      } finally {
        if (force) clearTimeout(force);
        if (timeout) clearTimeout(timeout);
        this.child.off("close", finished);
      }
    })();
    return this.disposal;
  }
}
