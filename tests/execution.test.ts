import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  executionCatalog,
  resolveLaunch,
  resolveTask,
  quoteShellArgument,
} from "../apps/desktop/src/main/services/execution-config";
import { NodeDebugService } from "../apps/desktop/src/main/services/node-debugger";
import type { DebugState } from "../apps/desktop/src/shared/execution";

function until(
  service: NodeDebugService,
  predicate: (state: DebugState) => boolean,
) {
  return new Promise<DebugState>((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off("state", listener);
      reject(new Error("Debugger test timed out"));
    }, 12_000);
    const listener = (state: DebugState) => {
      if (predicate(state)) {
        clearTimeout(timer);
        service.off("state", listener);
        resolve(state);
      }
    };
    service.on("state", listener);
  });
}
test("VS Code style execution configs validate paths, variables and unsupported options", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-execution-"));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 3 }));
  await fs.mkdir(path.join(root, ".vscode"));
  await fs.writeFile(path.join(root, "app.cjs"), 'console.log("hello")');
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { test: "node app.cjs" } }),
  );
  await fs.writeFile(
    path.join(root, ".vscode/tasks.json"),
    '{// comments are supported\n"version":"2.0.0","tasks":[{"label":"Run","type":"process","command":"node","args":["${file}","a;b"]}]}',
  );
  await fs.writeFile(
    path.join(root, ".vscode/launch.json"),
    JSON.stringify({
      configurations: [
        {
          type: "node",
          request: "launch",
          name: "App",
          program: "${workspaceFolder}/app.cjs",
          stopOnEntry: true,
        },
        { type: "node", request: "attach", name: "Unsupported", port: 9229 },
      ],
    }),
  );
  const catalog = await executionCatalog(root);
  assert.equal(catalog.tasks.length, 2);
  assert.equal(catalog.launches.length, 1);
  assert.equal(catalog.warnings.length, 1);
  const launch = await resolveLaunch(root, catalog.launches[0]);
  assert.equal(launch.program, await fs.realpath(path.join(root, "app.cjs")));
  const task = await resolveTask(root, catalog.tasks[0], "app.cjs");
  assert.match(task.shellCommand, /'a;b'/);
  assert.equal(quoteShellArgument("don't", "win32"), "'don''t'");
  assert.equal(quoteShellArgument("don't", "darwin"), "'don'\\''t'");
  await assert.rejects(
    resolveLaunch(root, { ...catalog.launches[0], program: "../outside.js" }),
    /workspace/,
  );
  await assert.rejects(resolveTask(root, catalog.tasks[0]), /variable/);
});
test(
  "real Node debugger stops at a breakpoint, reads locals, steps, and exits",
  { timeout: 25_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-debug-"));
    const service = new NodeDebugService({ runtime: process.execPath });
    t.after(async () => {
      await service.stop();
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    });
    const program = path.join(root, "app.cjs");
    await fs.writeFile(
      program,
      "function compute() {\n  const left = 2;\n  const right = 3;\n  const answer = left + right;\n  console.log(answer);\n}\ncompute();\n",
    );
    await service.setBreakpoints(root, "app.cjs", [4]);
    const stoppedAtBreakpoint = until(
      service,
      (state) => state.status === "paused",
    );
    await service.start(root, {
      id: "test",
      name: "Test Node",
      source: "test",
      program,
      cwd: root,
      args: [],
      stopOnEntry: false,
    });
    const paused = await stoppedAtBreakpoint;
    assert.equal(paused.frames[0].name, "compute");
    assert.equal(paused.frames[0].line, 4);
    assert.equal(paused.frames[0].path, "app.cjs");
    const local = paused.frames[0].scopes.find(
      (scope) => scope.type === "local",
    )!;
    assert(local);
    let values = await service.variables(local.objectId);
    assert.equal(values.find((value) => value.name === "left")?.value, "2");
    assert.equal(values.find((value) => value.name === "right")?.value, "3");
    const stepped = until(
      service,
      (state) => state.status === "paused" && state.frames[0]?.line === 5,
    );
    await service.action("stepOver");
    const next = await stepped;
    values = await service.variables(
      next.frames[0].scopes.find((scope) => scope.type === "local")!.objectId,
    );
    assert.equal(values.find((value) => value.name === "answer")?.value, "5");
    const exited = until(service, (state) => state.status === "stopped");
    await service.action("continue");
    await exited;
    assert.equal(service.isRunning(), false);
    assert.match(service.status().output, /\n5\r?\n/);
    await assert.rejects(service.variables(local.objectId), /paused/);
  },
);

test("a missing debug runtime reports failure without leaving a busy session", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-debug-missing-"));
  const service = new NodeDebugService({
    runtime: path.join(root, "not-installed"),
  });
  t.after(async () => {
    await service.stop();
    await fs.rm(root, { recursive: true, force: true });
  });
  const program = path.join(root, "app.cjs");
  await fs.writeFile(program, "console.log('fixture');\n");
  await assert.rejects(
    service.start(root, {
      id: "missing",
      name: "Missing runtime",
      source: "test",
      program,
      cwd: root,
      args: [],
      stopOnEntry: false,
    }),
    /ENOENT/,
  );
  await service.stop();
  assert.equal(service.isRunning(), false);
  assert.equal(service.status().status, "failed");
});

test(
  "stopping a debug launch also stops its ordinary child workers",
  { timeout: 25_000 },
  async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-debug-tree-"));
    const service = new NodeDebugService({ runtime: process.execPath });
    let workerPid: number | undefined;
    t.after(async () => {
      await service.stop();
      // This PID came only from our synthetic child, not from process enumeration.
      if (workerPid) {
        try {
          process.kill(workerPid);
        } catch {
          /* already stopped */
        }
      }
      await fs.rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      });
    });
    const program = path.join(root, "parent.cjs");
    await fs.writeFile(
      program,
      `const { spawn } = require("node:child_process");
const worker = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", windowsHide: true });
console.log("WITCH_WORKER_PID=" + worker.pid);
setInterval(() => {}, 1000);
`,
    );
    const spawned = until(service, (state) =>
      state.output.includes("WITCH_WORKER_PID="),
    );
    await service.start(root, {
      id: "tree",
      name: "Worker tree",
      source: "test",
      program,
      cwd: root,
      args: [],
      stopOnEntry: false,
    });
    const running = await spawned;
    workerPid = Number(running.output.match(/WITCH_WORKER_PID=(\d+)/)?.[1]);
    assert(Number.isSafeInteger(workerPid) && workerPid > 0);
    await service.stop();
    let stopped = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        process.kill(workerPid, 0);
      } catch {
        stopped = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    assert.equal(stopped, true, "Debug child worker remained alive after Stop");
    workerPid = undefined;
    assert.equal(service.isRunning(), false);
  },
);
