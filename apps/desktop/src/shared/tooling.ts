export type PythonEnvironmentKind =
  | "workspace-venv"
  | "conda"
  | "system";

export type PythonEnvironment = {
  id: string;
  label: string;
  path: string;
  kind: PythonEnvironmentKind;
  source: string;
};

export type WorkspaceToolingSnapshot = {
  root: string;
  python: {
    candidates: PythonEnvironment[];
    selectedId?: string;
    activeId?: string;
    selection: "automatic" | "explicit" | "unavailable";
    message: string;
  };
  managers: {
    uv?: string;
    poetry?: string;
    cargo?: string;
    ruff?: string;
  };
  markers: {
    pyproject: boolean;
    uvLock: boolean;
    poetryLock: boolean;
    cargoManifest: boolean;
    pythonTests: boolean;
  };
  warnings: string[];
};
