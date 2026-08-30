import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PythonDebugService } from "../apps/desktop/src/main/services/python-debugger";
import type { DebugState } from "../apps/desktop/src/shared/execution";

const interpreter = process.env.WITCH_PYTHON_DEBUG_INTERPRETER;
if (!interpreter || !path.isAbsolute(interpreter))
  throw new Error(
    "Set WITCH_PYTHON_DEBUG_INTERPRETER to an absolute Python executable with debugpy installed",
  );
const debugInterpreter = interpreter;

function until(
  service: PythonDebugService,
  predicate: (state: DebugState) => boolean,
) {
  return new Promise<DebugState>((resolve, reject) => {
    const timer = setTimeout(() => {
      service.off("state", listener);
      reject(new Error("Python debug smoke test timed out"));
    }, 30_000);
    const listener = (state: DebugState) => {
      if (!predicate(state)) return;
      clearTimeout(timer);
      service.off("state", listener);
      resolve(state);
    };
    service.on("state", listener);
  });
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-live-debugpy-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "witch-live-debugpy-data-"));
  const service = new PythonDebugService({ breakpointDirectory: data });
  try {
  const program = path.join(root, "forecast.py");
  await fs.writeFile(
    program,
    "def forecast():\n    symbol = 'WITCH'\n    price = 42\n    print(symbol, price)\n\nforecast()\n",
  );
  await service.setBreakpoints(root, "forecast.py", [4]);
  const paused = until(service, (state) => state.status === "paused");
  await service.start(root, {
    id: "live-debugpy",
    name: "Live debugpy smoke",
    source: "smoke",
    type: "python",
    program,
    cwd: root,
    args: [],
    stopOnEntry: false,
    interpreter: debugInterpreter,
  });
  const state = await paused;
  const local = state.frames[0]?.scopes.find(
    (scope) => scope.type === "local",
  );
  if (state.frames[0]?.path !== "forecast.py" || !local)
    throw new Error(`Unexpected paused state: ${JSON.stringify(state)}`);
  const variables = await service.variables(local.objectId);
  if (!variables.some((item) => item.name === "symbol"))
    throw new Error(`Missing local variables: ${JSON.stringify(variables)}`);
  const stopped = until(service, (next) => next.status === "stopped");
  await service.action("continue");
  await stopped;
  process.stdout.write(
    JSON.stringify({
      result: "passed",
      frame: state.frames[0],
      variables: variables.map((item) => item.name),
    }) + "\n",
  );
  } finally {
    await service.stop();
    await Promise.all([
      fs.rm(root, { recursive: true, force: true, maxRetries: 5 }),
      fs.rm(data, { recursive: true, force: true, maxRetries: 5 }),
    ]);
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
  process.exitCode = 1;
});
