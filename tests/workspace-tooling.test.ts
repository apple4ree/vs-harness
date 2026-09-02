import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectedExecutionTasks,
  discoverWorkspaceTooling,
  WorkspaceToolingService,
} from "../apps/desktop/src/main/services/workspace-tooling";
import type { WorkspaceToolingSnapshot } from "../apps/desktop/src/shared/tooling";

async function fakePython(root: string) {
  const executable =
    process.platform === "win32"
      ? path.join(root, ".venv", "Scripts", "python.exe")
      : path.join(root, ".venv", "bin", "python");
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.writeFile(executable, "fixture\n");
  if (process.platform !== "win32") await fs.chmod(executable, 0o700);
  await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname='demo'\n");
  await fs.mkdir(path.join(root, "tests"));
  return executable;
}

test("workspace tooling finds .venv without executing it and persists an explicit selection", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-tooling-root-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "witch-tooling-data-"));
  const executable = await fakePython(root);
  const canonicalExecutable = await fs.realpath(executable);
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(data, { recursive: true, force: true }),
  ]));
  const discovered = await discoverWorkspaceTooling(root);
  const workspace = discovered.python.candidates.find(
    (item) => item.kind === "workspace-venv",
  )!;
  assert.equal(workspace.path, canonicalExecutable);
  assert.equal(discovered.python.activeId, workspace.id);
  assert.equal(discovered.python.selection, "automatic");
  const service = new WorkspaceToolingService(data);
  const selected = await service.selectPython(root, workspace.id);
  assert.equal(selected.python.selection, "explicit");
  assert.equal(selected.python.selectedId, workspace.id);
  const stored = JSON.parse(
    await fs.readFile(path.join(data, "workspace-toolchains.json"), "utf8"),
  );
  assert.equal(stored.selections[0].pythonPath, canonicalExecutable);
  const automatic = await service.selectPython(root, null);
  assert.equal(automatic.python.selection, "automatic");
});

test("invalid toolchain storage is retained and blocks mutation", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "witch-tooling-root-"));
  const data = await fs.mkdtemp(path.join(os.tmpdir(), "witch-tooling-data-"));
  await fakePython(root);
  const target = path.join(data, "workspace-toolchains.json");
  await fs.writeFile(target, "{not valid json");
  t.after(() => Promise.all([
    fs.rm(root, { recursive: true, force: true }),
    fs.rm(data, { recursive: true, force: true }),
  ]));
  const service = new WorkspaceToolingService(data);
  await assert.rejects(() => service.get(root), /original file was retained/);
  assert.equal(await fs.readFile(target, "utf8"), "{not valid json");
});

test("detected Python and Rust tasks use absolute discovered executables", () => {
  const snapshot: WorkspaceToolingSnapshot = {
    root: path.resolve("fixture"),
    python: {
      candidates: [
        {
          id: "python:fixture",
          label: ".venv · Python",
          path: path.resolve("fixture", "python"),
          kind: "workspace-venv",
          source: ".venv/bin/python",
        },
      ],
      activeId: "python:fixture",
      selection: "automatic",
      message: "fixture",
    },
    managers: {
      uv: path.resolve("tools", "uv"),
      cargo: path.resolve("tools", "cargo"),
      ruff: path.resolve("tools", "ruff"),
    },
    markers: {
      pyproject: true,
      uvLock: true,
      poetryLock: false,
      cargoManifest: true,
      pythonTests: true,
    },
    warnings: [],
  };
  const tasks = detectedExecutionTasks(snapshot);
  assert(tasks.some((item) => item.id === "detected:python:active"));
  assert(tasks.some((item) => item.id === "detected:python:pytest"));
  assert(tasks.some((item) => item.id === "detected:uv:sync"));
  assert(tasks.some((item) => item.id === "detected:ruff:format-check"));
  assert(tasks.some((item) => item.id === "detected:cargo:test"));
  assert(tasks.some((item) => item.id === "detected:cargo:fmt"));
  assert(tasks.every((item) => path.isAbsolute(item.command)));
});
