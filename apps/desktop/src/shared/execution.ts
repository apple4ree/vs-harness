export type ProjectTask = {
  id: string;
  label: string;
  source: string;
  type: "process" | "shell";
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
};
export type LaunchConfiguration = {
  id: string;
  name: string;
  source: string;
  program: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  stopOnEntry: boolean;
};
export type ExecutionCatalog = {
  tasks: ProjectTask[];
  launches: LaunchConfiguration[];
  warnings: string[];
};
export type Breakpoint = {
  path: string;
  line: number;
  verified?: boolean;
  actualLine?: number;
};
export type DebugScope = { name: string; type: string; objectId: string };
export type DebugFrame = {
  id: string;
  name: string;
  path?: string;
  line: number;
  column: number;
  scopes: DebugScope[];
};
export type DebugVariable = {
  name: string;
  value: string;
  type: string;
  objectId?: string;
};
export type DebugState = {
  root: string | null;
  status: "idle" | "starting" | "running" | "paused" | "stopped" | "failed";
  name?: string;
  reason?: string;
  error?: string;
  frames: DebugFrame[];
  output: string;
  breakpoints: Breakpoint[];
};
export type DebugAction =
  "continue" | "pause" | "stepOver" | "stepInto" | "stepOut" | "stop";
export type TerminalSummary = {
  id: string;
  cwd: string;
  shell: string;
  remoteProfileId?: string;
};
export type TerminalSnapshot = TerminalSummary & {
  buffer: string;
  sequence: number;
};
export type TerminalData = { id: string; data: string; sequence: number };
