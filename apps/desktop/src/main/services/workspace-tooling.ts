import { createHash, randomUUID } from "node:crypto";
import { accessSync, constants, promises as fs, statSync } from "node:fs";
import path from "node:path";
import { findCliExecutable } from "./cli-discovery";
import type {
  PythonEnvironment,
  PythonEnvironmentKind,
  WorkspaceToolingSnapshot,
} from "../../shared/tooling";

const STORE_VERSION = 1;
type SelectionStore = {
  version: 1;
  selections: { root: string; pythonPath: string }[];
};

function isExecutable(file: string) {
  try {
    if (!path.isAbsolute(file) || !statSync(file).isFile()) return false;
    accessSync(
      file,
      process.platform === "win32" ? constants.F_OK : constants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

function environmentId(file: string) {
  return `python:${createHash("sha256").update(file).digest("hex").slice(0, 20)}`;
}

function pythonIn(directory: string, platform: NodeJS.Platform) {
  return platform === "win32"
    ? path.join(directory, "Scripts", "python.exe")
    : path.join(directory, "bin", "python");
}

function candidate(
  file: string,
  label: string,
  kind: PythonEnvironmentKind,
  source: string,
): PythonEnvironment | null {
  if (!isExecutable(file)) return null;
  return { id: environmentId(file), label, path: file, kind, source };
}

async function exists(file: string, directory = false) {
  const item = await fs.stat(file).catch(() => null);
  return directory ? Boolean(item?.isDirectory()) : Boolean(item?.isFile());
}

export async function discoverWorkspaceTooling(
  root: string,
  selectedPath?: string,
  platform: NodeJS.Platform = process.platform,
): Promise<WorkspaceToolingSnapshot> {
  const canonicalRoot = await fs.realpath(root);
  const candidates: PythonEnvironment[] = [];
  for (const folder of [".venv", "venv", "env"]) {
    const executable = pythonIn(path.join(canonicalRoot, folder), platform);
    const item = candidate(
      executable,
      `${folder} · Python`,
      "workspace-venv",
      `${folder}/${platform === "win32" ? "Scripts/python.exe" : "bin/python"}`,
    );
    if (item) candidates.push(item);
  }
  const condaPrefix = process.env.CONDA_PREFIX;
  if (condaPrefix && path.isAbsolute(condaPrefix)) {
    const item = candidate(
      pythonIn(condaPrefix, platform),
      `${path.basename(condaPrefix)} · Conda`,
      "conda",
      "CONDA_PREFIX",
    );
    if (item) candidates.push(item);
  }
  for (const name of platform === "win32"
    ? ["python", "python3"]
    : ["python3", "python"]) {
    const executable = findCliExecutable(name);
    if (!executable) continue;
    const item = candidate(
      executable,
      `${name} · System`,
      "system",
      "PATH",
    );
    if (item) candidates.push(item);
  }
  const unique = [
    ...new Map(
      candidates.map((item) => [
        platform === "win32" ? item.path.toLowerCase() : item.path,
        item,
      ]),
    ).values(),
  ];
  const selected = selectedPath
    ? unique.find(
        (item) =>
          (platform === "win32" ? item.path.toLowerCase() : item.path) ===
          (platform === "win32" ? selectedPath.toLowerCase() : selectedPath),
      )
    : undefined;
  const active = selected || unique[0];
  const localRuff = active
    ? path.join(
        path.dirname(active.path),
        platform === "win32" ? "ruff.exe" : "ruff",
      )
    : undefined;
  const uv = findCliExecutable("uv");
  const poetry = findCliExecutable("poetry");
  const cargo = findCliExecutable("cargo");
  const ruff =
    (localRuff && isExecutable(localRuff) ? localRuff : null) ||
    findCliExecutable("ruff");
  const markers = {
    pyproject: await exists(path.join(canonicalRoot, "pyproject.toml")),
    uvLock: await exists(path.join(canonicalRoot, "uv.lock")),
    poetryLock: await exists(path.join(canonicalRoot, "poetry.lock")),
    cargoManifest: await exists(path.join(canonicalRoot, "Cargo.toml")),
    pythonTests:
      (await exists(path.join(canonicalRoot, "tests"), true)) ||
      (await exists(path.join(canonicalRoot, "pytest.ini"))) ||
      (await exists(path.join(canonicalRoot, "tox.ini"))),
  };
  const warnings: string[] = [];
  if (selectedPath && !selected)
    warnings.push(
      "The saved Python environment is no longer available; automatic detection is in use.",
    );
  return {
    root: canonicalRoot,
    python: {
      candidates: unique,
      ...(selected ? { selectedId: selected.id } : {}),
      ...(active ? { activeId: active.id } : {}),
      selection: selected
        ? "explicit"
        : active
          ? "automatic"
          : "unavailable",
      message: active
        ? `${selected ? "Selected" : "Auto-detected"}: ${active.label}. Interpreters are not executed during discovery.`
        : "No Python interpreter was found. Create .venv or install Python, then refresh the project.",
    },
    managers: {
      ...(uv ? { uv } : {}),
      ...(poetry ? { poetry } : {}),
      ...(cargo ? { cargo } : {}),
      ...(ruff ? { ruff } : {}),
    },
    markers,
    warnings,
  };
}

export function detectedExecutionTasks(snapshot: WorkspaceToolingSnapshot) {
  const tasks: {
    id: string;
    label: string;
    source: string;
    type: "process";
    command: string;
    args: string[];
    requiresActiveFile?: "python";
  }[] = [];
  const python = snapshot.python.candidates.find(
    (item) => item.id === snapshot.python.activeId,
  );
  if (python) {
    tasks.push({
      id: "detected:python:active",
      label: "Python: Run active file",
      source: "Witch toolchain",
      type: "process",
      command: python.path,
      args: ["${file}"],
      requiresActiveFile: "python",
    });
    if (snapshot.markers.pythonTests || snapshot.markers.pyproject)
      tasks.push(
        {
          id: "detected:python:pytest",
          label: "Python: pytest",
          source: "Witch toolchain",
          type: "process",
          command: python.path,
          args: ["-m", "pytest"],
        },
        {
          id: "detected:python:unittest",
          label: "Python: unittest discover",
          source: "Witch toolchain",
          type: "process",
          command: python.path,
          args: ["-m", "unittest", "discover"],
        },
      );
  }
  if (snapshot.managers.uv && snapshot.markers.pyproject)
    tasks.push({
      id: "detected:uv:sync",
      label: "Python: uv sync",
      source: "Witch toolchain",
      type: "process",
      command: snapshot.managers.uv,
      args: ["sync"],
    });
  if (snapshot.managers.ruff && snapshot.markers.pyproject)
    tasks.push(
      {
        id: "detected:ruff:check",
        label: "Python: ruff check",
        source: "Witch toolchain",
        type: "process",
        command: snapshot.managers.ruff,
        args: ["check", "."],
      },
      {
        id: "detected:ruff:format-check",
        label: "Python: ruff format --check",
        source: "Witch toolchain",
        type: "process",
        command: snapshot.managers.ruff,
        args: ["format", "--check", "."],
      },
    );
  if (snapshot.managers.poetry && snapshot.markers.poetryLock)
    tasks.push({
      id: "detected:poetry:install",
      label: "Python: poetry install",
      source: "Witch toolchain",
      type: "process",
      command: snapshot.managers.poetry,
      args: ["install"],
    });
  if (snapshot.managers.cargo && snapshot.markers.cargoManifest)
    for (const [id, label, args] of [
      ["check", "Rust: cargo check", ["check"]],
      ["test", "Rust: cargo test", ["test"]],
      ["fmt", "Rust: cargo fmt --check", ["fmt", "--check"]],
      ["run", "Rust: cargo run", ["run"]],
    ] as const)
      tasks.push({
        id: `detected:cargo:${id}`,
        label,
        source: "Witch toolchain",
        type: "process",
        command: snapshot.managers.cargo,
        args: [...args],
      });
  return tasks;
}

export class WorkspaceToolingService {
  private writes: Promise<void> = Promise.resolve();
  constructor(private directory: string) {}
  private get file() {
    return path.join(this.directory, "workspace-toolchains.json");
  }
  async flush() {
    await this.writes;
  }
  private async load(): Promise<SelectionStore> {
    await this.writes.catch(() => undefined);
    try {
      const bytes = await fs.readFile(this.file);
      if (bytes.length > 1_000_000)
        throw new Error("Toolchain selection file exceeds 1 MB");
      const value = JSON.parse(bytes.toString("utf8"));
      if (
        !value ||
        value.version !== STORE_VERSION ||
        !Array.isArray(value.selections) ||
        value.selections.length > 1000 ||
        value.selections.some(
          (item: any) =>
            !item ||
            typeof item.root !== "string" ||
            !path.isAbsolute(item.root) ||
            typeof item.pythonPath !== "string" ||
            !path.isAbsolute(item.pythonPath),
        )
      )
        throw new Error("Invalid toolchain selection format");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { version: STORE_VERSION, selections: [] };
      throw new Error(
        `Toolchain selections could not be loaded; the original file was retained. ${error}`,
      );
    }
  }
  private async write(value: SelectionStore) {
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.directory, { recursive: true });
        const temporary = path.join(
          this.directory,
          `workspace-toolchains.${randomUUID()}.tmp`,
        );
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          try {
            await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
            await handle.sync();
          } finally {
            await handle.close();
          }
          await fs.rename(temporary, this.file);
          if (process.platform !== "win32")
            await fs.chmod(this.file, 0o600).catch(() => undefined);
        } finally {
          await fs.unlink(temporary).catch(() => undefined);
        }
      });
    await this.writes;
  }
  async get(root: string) {
    const canonicalRoot = await fs.realpath(root);
    const store = await this.load();
    const selection = store.selections.find(
      (item) => item.root === canonicalRoot,
    );
    return discoverWorkspaceTooling(canonicalRoot, selection?.pythonPath);
  }
  async selectPython(root: string, id: string | null) {
    const canonicalRoot = await fs.realpath(root);
    const store = await this.load();
    const current = await discoverWorkspaceTooling(canonicalRoot);
    const selected = id
      ? current.python.candidates.find((item) => item.id === id)
      : undefined;
    if (id && !selected)
      throw new Error("The selected Python environment is no longer available");
    store.selections = store.selections.filter(
      (item) => item.root !== canonicalRoot,
    );
    if (selected)
      store.selections.push({ root: canonicalRoot, pythonPath: selected.path });
    await this.write(store);
    return this.get(canonicalRoot);
  }
}
