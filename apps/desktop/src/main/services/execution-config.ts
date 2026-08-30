import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  readWorkspaceText,
  resolveWorkspacePath,
  normalizedRelative,
} from "./workspace-files";
import type {
  ExecutionCatalog,
  LaunchConfiguration,
  ProjectTask,
} from "../../shared/execution";

function strings(value: unknown, name: string): string[] {
  if (value === undefined) return [];
  if (
    !Array.isArray(value) ||
    value.length > 100 ||
    value.some(
      (item) =>
        typeof item !== "string" || item.length > 10000 || item.includes("\0"),
    )
  )
    throw new Error(`${name} must be a string array`);
  return value;
}
function text(value: unknown, name: string) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 10000 ||
    value.includes("\0")
  )
    throw new Error(`${name} must be nonempty text`);
  return value;
}
function environment(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("env must be an object");
  const entries = Object.entries(value);
  if (
    entries.length > 100 ||
    entries.some(
      ([key, value]) =>
        !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key) ||
        typeof value !== "string" ||
        value.includes("\0"),
    )
  )
    throw new Error(
      "Environment variables must be string values with valid names",
    );
  return Object.fromEntries(entries);
}
async function config(root: string, file: string) {
  try {
    const result = ts.parseConfigFileTextToJson(
      file,
      await readWorkspaceText(root, file),
    );
    if (result.error)
      throw new Error(
        ts.flattenDiagnosticMessageText(result.error.messageText, "\n"),
      );
    return result.config;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function platformItem(value: any) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Configuration entries must be objects");
  return {
    ...value,
    ...(value[
      process.platform === "win32"
        ? "windows"
        : process.platform === "darwin"
          ? "osx"
          : "linux"
    ] || {}),
  };
}
export async function executionCatalog(
  root: string,
  detectedTasks: ProjectTask[] = [],
): Promise<ExecutionCatalog> {
  const result: ExecutionCatalog = { tasks: [], launches: [], warnings: [] };
  for (const source of [".witch/tasks.json", ".vscode/tasks.json"]) {
    try {
      const value = await config(root, source);
      if (!value) continue;
      if (!Array.isArray(value.tasks))
        throw new Error("Expected a tasks array");
      for (const [index, item] of value.tasks.entries()) {
        try {
          const task = platformItem(item);
          if (!["process", "shell"].includes(task.type || "process"))
            throw new Error(`Task type ${task.type} is not supported`);
          if (task.dependsOn || task.runOptions?.runOn === "folderOpen")
            throw new Error(
              "Task dependencies and automatic folder-open execution are not supported",
            );
          result.tasks.push({
            id: `${source}:${index}`,
            label: text(task.label, "label"),
            source,
            type: task.type || "process",
            command: text(task.command, "command"),
            args: strings(task.args, "args"),
            cwd: task.options?.cwd,
            env: environment(task.options?.env),
          });
        } catch (error) {
          result.warnings.push(`${source} #${index + 1}: ${String(error)}`);
        }
      }
    } catch (error) {
      result.warnings.push(`${source}: ${String(error)}`);
    }
  }
  try {
    const pkg = await config(root, "package.json");
    for (const name of Object.keys(pkg?.scripts || {}).slice(0, 100))
      result.tasks.push({
        id: `npm:${name}`,
        label: `npm: ${name}`,
        source: "package.json",
        type: "process",
        command: "npm",
        args: ["run", name],
      });
  } catch (error) {
    result.warnings.push(`package.json: ${String(error)}`);
  }
  const configuredLabels = new Set(result.tasks.map((task) => task.label));
  for (const task of detectedTasks)
    if (!configuredLabels.has(task.label)) result.tasks.push(task);
  for (const source of [".witch/launch.json", ".vscode/launch.json"]) {
    try {
      const value = await config(root, source);
      if (!value) continue;
      if (!Array.isArray(value.configurations))
        throw new Error("Expected a configurations array");
      for (const [index, item] of value.configurations.entries()) {
        try {
          const launch = platformItem(item);
          if (
            !["node", "pwa-node", "python", "debugpy"].includes(
              launch.type,
            ) ||
            launch.request !== "launch"
          )
            throw new Error(
              "Only Node.js and Python launch configurations are supported",
            );
          const debugType = ["python", "debugpy"].includes(launch.type)
            ? "python"
            : "node";
          for (const key of [
            "runtimeExecutable",
            "runtimeArgs",
            "preLaunchTask",
            "postDebugTask",
            "envFile",
            "outFiles",
          ])
            if (launch[key])
              throw new Error(
                `${key} is not supported by the built-in Node debugger`,
              );
          const env = environment(launch.env);
          if (
            Object.keys(env || {}).some((key) =>
              [
                "NODE_OPTIONS",
                "ELECTRON_RUN_AS_NODE",
                "NODE_INSPECT_RESUME_ON_START",
              ].includes(key.toUpperCase()),
            )
          )
            throw new Error(
              "Debugger runtime environment overrides are not supported",
            );
          result.launches.push({
            id: `${source}:${index}`,
            name: text(launch.name, "name"),
            source,
            type: debugType,
            program: text(launch.program, "program"),
            args: strings(launch.args, "args"),
            cwd: launch.cwd,
            env,
            stopOnEntry: launch.stopOnEntry === true,
          });
        } catch (error) {
          result.warnings.push(`${source} #${index + 1}: ${String(error)}`);
        }
      }
    } catch (error) {
      result.warnings.push(`${source}: ${String(error)}`);
    }
  }
  return result;
}
export function substitute(
  value: string,
  root: string,
  activeFile?: string,
): string {
  if (typeof value !== "string")
    throw new Error("Configuration path must be text");
  const expanded = value
    .replaceAll("${workspaceFolder}", root)
    .replaceAll(
      "${file}",
      activeFile ? path.join(root, normalizedRelative(activeFile)) : "${file}",
    );
  if (/\$\{[^}]+\}/.test(expanded))
    throw new Error(`Unsupported or unavailable variable in: ${value}`);
  return expanded;
}
export async function executionPath(
  root: string,
  value: string,
  directory: boolean,
  activeFile?: string,
) {
  const expanded = substitute(value, root, activeFile);
  const relative = path.isAbsolute(expanded)
    ? path.relative(root, expanded)
    : expanded;
  const target =
    directory && (relative === "." || relative === "")
      ? root
      : await resolveWorkspacePath(root, relative);
  const stat = await fs.stat(target);
  if (directory ? !stat.isDirectory() : !stat.isFile())
    throw new Error(`Expected a ${directory ? "directory" : "file"}: ${value}`);
  return target;
}
export async function resolveLaunch(
  root: string,
  launch: LaunchConfiguration,
  activeFile?: string,
) {
  const program = await executionPath(root, launch.program, false, activeFile);
  if (launch.type === "python") {
    if (!/\.py$/i.test(program))
      throw new Error("The Python debugger runs .py files");
  } else if (!/\.[cm]?js$/i.test(program))
    throw new Error(
      "The built-in Node debugger runs JavaScript (.js, .cjs, .mjs). Compile TypeScript first; source-map debugging is not yet supported.",
    );
  return {
    ...launch,
    program,
    cwd: await executionPath(root, launch.cwd || ".", true, activeFile),
    args: launch.args.map((arg) => substitute(arg, root, activeFile)),
  };
}
export function quoteShellArgument(
  value: string,
  platform: NodeJS.Platform = process.platform,
) {
  return platform === "win32"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
}
export async function resolveTask(
  root: string,
  task: ProjectTask,
  activeFile?: string,
) {
  if (
    task.requiresActiveFile === "python" &&
    (!activeFile || !/\.pyi?$/i.test(activeFile))
  )
    throw new Error("This task requires an active Python file");
  if (
    task.requiresActiveFile === "javascript" &&
    (!activeFile || !/\.[cm]?js$/i.test(activeFile))
  )
    throw new Error("This task requires an active JavaScript file");
  const command = substitute(task.command, root, activeFile);
  const args = task.args.map((arg) => substitute(arg, root, activeFile));
  const shellCommand =
    task.type === "shell"
      ? [command, ...args.map((arg) => quoteShellArgument(arg))].join(" ")
      : `${process.platform === "win32" ? "& " : ""}${[command, ...args].map((arg) => quoteShellArgument(arg)).join(" ")}`;
  return {
    ...task,
    command,
    args,
    shellCommand,
    cwd: await executionPath(root, task.cwd || ".", true, activeFile),
  };
}
