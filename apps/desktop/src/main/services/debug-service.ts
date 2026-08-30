import { EventEmitter } from "node:events";
import { NodeDebugService } from "./node-debugger";
import { PythonDebugService } from "./python-debugger";
import type {
  Breakpoint,
  DebugAction,
  DebugState,
  LaunchConfiguration,
} from "../../shared/execution";

type ResolvedLaunch = LaunchConfiguration & { cwd: string };

export class DebugService extends EventEmitter {
  private active: "node" | "python" | null = null;
  private lastState: DebugState = {
    root: null,
    status: "idle",
    frames: [],
    output: "",
    breakpoints: [],
  };
  constructor(
    private node: NodeDebugService,
    private python: PythonDebugService,
  ) {
    super();
    node.on("state", (state) => this.forward("node", state));
    python.on("state", (state) => this.forward("python", state));
  }
  private forward(adapter: "node" | "python", state: DebugState) {
    if (this.active && this.active !== adapter) return;
    this.lastState = state;
    this.emit("state", state);
  }
  private service() {
    return this.active === "python" ? this.python : this.node;
  }
  isRunning() {
    return this.node.isRunning() || this.python.isRunning();
  }
  status() {
    return this.active ? this.service().status() : this.lastState;
  }
  async loadBreakpoints(root: string) {
    const [node, python] = await Promise.all([
      this.node.loadBreakpoints(root),
      this.python.loadBreakpoints(root),
    ]);
    return [...node, ...python];
  }
  setBreakpoints(root: string, file: string, lines: number[]) {
    return /\.pyi?$/i.test(file)
      ? this.python.setBreakpoints(root, file, lines)
      : this.node.setBreakpoints(root, file, lines);
  }
  async relocateBreakpoints(
    root: string,
    source: string,
    destination?: string,
  ) {
    const [node, python] = await Promise.all([
      this.node.relocateBreakpoints(root, source, destination),
      this.python.relocateBreakpoints(root, source, destination),
    ]);
    return [...node, ...python];
  }
  async start(
    root: string,
    launch: ResolvedLaunch,
    pythonInterpreter?: string,
  ) {
    if (this.isRunning())
      throw new Error("Stop the current debug session first");
    this.active = launch.type;
    if (launch.type === "python") {
      if (!pythonInterpreter)
        throw new Error(
          "No Python environment is available for this workspace",
        );
      return this.python.start(root, {
        ...launch,
        type: "python",
        interpreter: pythonInterpreter,
      });
    }
    return this.node.start(root, launch);
  }
  action(action: DebugAction) {
    return this.service().action(action);
  }
  variables(objectId: string) {
    return this.service().variables(objectId);
  }
  async stop() {
    await Promise.all([this.node.stop(), this.python.stop()]);
  }
  async flush() {
    await Promise.all([this.node.flush(), this.python.flush()]);
  }
}
