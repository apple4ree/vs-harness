import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PythonDebugService } from "../apps/desktop/src/main/services/python-debugger";
import type { DebugState } from "../apps/desktop/src/shared/execution";

function until(
  service: PythonDebugService,
  predicate: (state: DebugState) => boolean,
) {
  return new Promise<DebugState>((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off("state", listener);
      reject(new Error("Python debugger fixture timed out"));
    }, 15_000);
    const listener = (state: DebugState) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      service.off("state", listener);
      resolve(state);
    };
    service.on("state", listener);
  });
}

test("Python DAP debugger verifies breakpoints, exposes frames and variables, and stops its adapter", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-python-debug-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "witch-python-breakpoints-"));
  const adapter = path.resolve("tests/fixtures/fake-debug-adapter.mjs");
  const service = new PythonDebugService({
    breakpointDirectory: data,
    adapterArguments: [adapter],
  });
  t.after(async () => {
    await service.stop();
    await Promise.all([
      fs.rm(root, { recursive: true, force: true, maxRetries: 4 }),
      fs.rm(data, { recursive: true, force: true, maxRetries: 4 }),
    ]);
  });
  const program = path.join(root, "forecast.py");
  await fs.writeFile(program, "symbol = 'WITCH'\nprint(symbol)\n");
  await service.setBreakpoints(root, "forecast.py", [2]);
  const pausedEvent = until(service, (state) => state.status === "paused");
  await service.start(root, {
    id: "python-fixture",
    name: "Python fixture",
    source: "test",
    type: "python",
    program,
    cwd: root,
    args: [],
    stopOnEntry: false,
    interpreter: process.execPath,
  });
  const paused = await pausedEvent;
  assert.equal(paused.adapter, "python");
  assert.equal(paused.frames[0].name, "forecast");
  assert.equal(paused.frames[0].path, "forecast.py");
  assert.equal(paused.frames[0].line, 2);
  assert.equal(paused.breakpoints[0].verified, true);
  const variables = await service.variables(paused.frames[0].scopes[0].objectId);
  assert.equal(variables.find((item) => item.name === "symbol")?.value, "'WITCH'");
  assert(variables.find((item) => item.name === "prices")?.objectId);
  const stopped = until(
    service,
    (state) => state.status === "stopped" && state.output.includes("PYTHON_DEBUG_DONE"),
  );
  await service.action("continue");
  await stopped;
  await service.stop();
  assert.equal(service.isRunning(), false);
  const restored = new PythonDebugService({ breakpointDirectory: data });
  assert.deepEqual(await restored.loadBreakpoints(root), [
    { path: "forecast.py", line: 2, verified: false },
  ]);
});

test("Python debugger rejects a non-absolute interpreter before spawning", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-python-debug-"));
  const service = new PythonDebugService();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const program = path.join(root, "main.py");
  await fs.writeFile(program, "print('witch')\n");
  await assert.rejects(
    service.start(root, {
      id: "invalid",
      name: "Invalid",
      source: "test",
      type: "python",
      program,
      cwd: root,
      args: [],
      stopOnEntry: false,
      interpreter: "python",
    }),
    /absolute interpreter/,
  );
  assert.equal(service.isRunning(), false);
});
