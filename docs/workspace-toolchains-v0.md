# Witch Workspace Toolchains v0

Workspace Toolchains is the project-scoped boundary between source intelligence and explicit local execution. It discovers candidates without executing them, stores user choices outside the repository, and supplies the same active Python environment to Pyright and generated Tasks.

## Python environments

Witch checks, in order:

1. `.venv`, `venv`, and `env` inside the workspace;
2. an absolute active `CONDA_PREFIX`;
3. absolute Python executables found through the desktop process search path.

Discovery performs file and executable-permission checks only. It does not run `python --version`, activate a shell, import project modules, or execute package-manager hooks. The automatic first candidate is not persisted. An explicit dropdown choice is stored in the Witch user-data directory and is accepted only while it still matches a freshly discovered candidate.

Invalid or oversized selection storage fails closed and remains on disk. Witch does not replace it with an empty file. A missing saved interpreter falls back to automatic detection with a visible warning.

## Generated Tasks

The Task picker adds commands only when their absolute executable and project marker are both present:

- active Python file, `pytest`, and `unittest discover` through the active interpreter;
- `uv sync` for a Python project;
- `poetry install` when `poetry.lock` is present;
- Ruff check and format check;
- Cargo check, test, format check, and run when `Cargo.toml` is present.

An active-file Python Task is hidden for non-Python editors and is revalidated in the main process. Configured `.witch`/`.vscode` Tasks take precedence when a label matches a generated Task.

Tool discovery is not permission to execute. Every generated Task passes through Witch's existing command preview and confirmation dialog and then runs locally with the user's permissions. Cargo build scripts, Python imports and package-manager hooks therefore run only after this explicit confirmation, never from project open or toolchain discovery.
