# Witch Python Debugger v0

Witch routes Python launch configurations through a bounded Debug Adapter Protocol client while retaining the existing Node inspector debugger.

## Requirements and launch

- The active Workspace Toolchains Python interpreter must be an absolute, freshly discovered path.
- `debugpy` must already be installed in that environment. Witch does not import it while opening a project and does not install packages automatically.
- `.witch/launch.json` and supported `.vscode/launch.json` entries use `type: "python"` or `type: "debugpy"`, `request: "launch"`, and a workspace-contained `.py` program.
- Active-file F5 chooses Python for `.py` and Node for `.js`, `.cjs`, or `.mjs`.

The confirmation dialog shows the canonical program, interpreter, arguments and working directory before any adapter or project code starts. Python then runs `-m debugpy.adapter` with shell execution disabled.

## DAP boundary

The client accepts Content-Length framed messages up to 16 MB and bounds stack frames, scopes, variables, output and displayed text. Source paths outside the active workspace are not exposed as navigable files. Variable getters are handled by debugpy; Witch only requests values after the user has paused at a frame.

Supported operations are launch, source breakpoints, uncaught exceptions, continue, pause, step over, step in, step out, call stacks, scopes, variables, disconnect and process-tree cleanup. Python breakpoint metadata is stored separately from existing Node breakpoint files so the prior format remains readable.

Attach, remote debugging, subprocess debugging, conditional/log breakpoints, expression evaluation and arbitrary third-party DAP adapters are not supported in v0.

## Verification

The default test suite uses a deterministic synthetic DAP adapter to verify framing, breakpoint verification, frame navigation, nested variable references and shutdown without requiring a machine-wide Python package. `npm run smoke:python-debug` is an explicit integration smoke test and requires `WITCH_PYTHON_DEBUG_INTERPRETER` to point at an environment containing debugpy.
