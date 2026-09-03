# Witch Desktop

[English](README.md) · [한국어](README.ko.md)


Witch is a local-first desktop ADE for exploring code as **structure, meaning, workflows, behavior, and observed execution**, then carrying that evidence into AI Agent work.

The current release is a development preview that can open real projects for editing, search, execution, and debugging. It is not a full VS Code-compatible product. Git UI and remote file workspaces are not implemented yet.

![Witch Runtime Trace Compare](docs/screenshots/product/runtime-trace-compare.png)

### What you can do

#### 1. Open a repository and read its structure

1. Select a local project with **Open repository**.
2. Witch indexes it statically without executing project code.
3. Switch among Modules, Files, Meaning, and Focus in **Constellation**.
4. Select a node or relation to inspect its file, line, source evidence, provenance, and validation state.

**Reveal in Constellation** keeps the active file and its direct import/imported-by neighborhood. Historical readings can be compared as **Before · Delta · After**. Witch reports exact structural differences and does not silently reinterpret them as runtime impact.

The analysis contracts remain separate:

| Reading | Purpose |
| --- | --- |
| `witch.architecture/v1` | File, module, import, and export structure |
| `witch.semantic/v1` | System, Component, Workflow, WorkflowStep, File, and Symbol meaning |
| `witch.behavior/v1` | Direct argument, return, state-access, and side-effect candidates |
| `witch.framework/v1` | Explicit route, task, graph, and spawn registrations |
| `witch.runtime-trace/v1` | Structural events observed during one approved Task run |

Every reading retains a source revision, endpoints, evidence, provenance, and a validation receipt. `Verified`, `Inferred`, `Authored`, and `Observed` are never collapsed into one indistinguishable fact.

#### 2. Explore large workflows summary-first

**Meaning → Workflows** opens with a workflow catalog. After selecting one workflow, switch between a graph and a top-to-bottom sequence, then collapse or expand branch-only paths.

![Workflow sequence](docs/screenshots/product/workflow-sequence.png)

Deep analysis currently targets TypeScript/JavaScript, Python, and Rust:

- TypeScript/JavaScript: TypeChecker-backed direct identifier calls and type relations
- Python: functions, classes, async code, decorators, imports, and conservative internal calls
- Rust: structs, enums, traits, implementations, functions, modules, imports, and conservative internal calls
- Pyright and an installed `rust-analyzer`: diagnostics, navigation, Outline, and call-hierarchy corroboration

Workflow relations use call sites and explicit syntax to produce `precedes`, `branches-to`, and `retries`. Static candidates remain provisional and are not presented as proven runtime order.

#### 3. Inspect framework registrations and behavior

**Meaning → Frameworks** currently uses source-only adapters for:

- Python: FastAPI, LangGraph, Celery
- TypeScript/JavaScript: Express, NestJS, Next.js
- Rust: Axum, Tokio

Dynamic paths, unresolved endpoints, and lambda or property handlers are preserved as exclusion diagnostics instead of being promoted silently.

**Meaning → Behavior** shows direct parameter binding, returns, module-state access, and framework relations. Witch does not claim complete object-field, message, database-lineage, or dynamic-dispatch recovery.

#### 4. Compare static analysis with an approved run

Runtime Trace is off by default.

1. Define a Task in `.witch/tasks.json` or a supported `.vscode/tasks.json`.
2. Open **Meaning → Behavior → Optional Runtime Trace**.
3. Review the exact command and working directory, then approve **Run & trace**.
4. Compare **Static / Observed / Compare** readings.

A project test harness may emit one-line structural markers:

```text
WITCH_TRACE_V1 {"phase":"enter","path":"src/worker.ts","symbol":"run"}
WITCH_TRACE_V1 {"phase":"exit","path":"src/worker.ts","symbol":"run","outcome":"ok"}
```

Witch stores symbol identity, parent call, order, duration, and outcome only. It does not store arguments, return values, environment values, or ordinary terminal output. Markers containing forbidden value fields are discarded entirely. Stale traces are retained but not overlaid on a different source or Semantic revision.

Automatic instrumentation, Debug-launch tracing, and cross-process causal tracing are not implemented yet.

#### 5. Continue from a graph into AI Agent work

Use **Add to Agent context** on a Meaning card, or drag the card into the conversation panel. The main process resolves the selection again from the current validated graph instead of trusting renderer-provided labels or paths.

- **Ask**: answer without modifying the project
- **Change · isolated copy**: propose edits in a separate workspace copy

Change runs follow this flow:

```text
Context → Plan → Isolated execution → Verification → Bounded repair
        → Checkpoint → Diff review → Selected apply → Re-analysis
```

An Agent's completion message is not accepted as evidence. Witch uses actual changed files, an immutable baseline, syntax and architecture verification receipts, checkpoints, and diffs. Repair is limited to two attempts and stops when the same failure fingerprint repeats.

![Agent change review](docs/screenshots/product/agent-review.png)

You can apply only selected files. Apply is rejected if the original changed externally. Unapplied reviews can be archived, restored, or continued as a child run from the current baseline.

#### 6. Use regular ADE capabilities

![Source editor and terminals](docs/screenshots/product/source-terminals.png)

- Create, rename, move, and trash files and folders
- Monaco multi-tab editing, Save/Save All, and UTF-8/BOM/CRLF preservation
- Workspace search, quick open, and Outline
- Completion, hover, signature help, diagnostics, definition, references, and review-only rename/code actions
- Node.js and Python/debugpy debugging
- Up to eight PTY sessions, terminal tabs, and Project Tasks
- Project-scoped Python selection and uv/Poetry/Ruff/Cargo Task discovery
- Settings, remappable shortcuts, three Witch themes, and data-only snippet extensions
- File watching, external-change refresh, and unsaved-conflict diff
- Interactive remote terminals through the system OpenSSH client

SSH currently provides remote terminals only. Explorer, Editor, Search, LSP, Tasks, Debugger, analysis, and Agent work still use the opened local workspace.

### AI Provider connections

Open **AI providers** to inspect local CLI installation and sign-in state, or API-key configuration.

| Provider | Current use |
| --- | --- |
| Signed-in Codex CLI | Ask, isolated Change, Semantic Composer |
| Signed-in Claude Code CLI | Ask, isolated Change, Semantic Composer |
| OpenAI API key | Semantic Composer |
| Anthropic API key | Semantic Composer |
| Rules only | Deterministic Semantic Composer without an AI call |

Stored API keys are encrypted with Electron `safeStorage` and cannot be read back by the renderer. Local analysis, editing, and search do not call an AI. Running an Agent or AI Composer can send the selected bounded source context to that Provider.

The current Codex and Claude adapters do not expose native resume/fork capabilities. Controls remain hidden unless the selected Provider explicitly advertises support.

### Getting started

Node.js 22 or newer and npm are required.

```sh
npm ci
npm run dev
```

For a dependency-free first tour, open the [playground project](examples/playground/README.md).

Build the production bundle with:

```sh
npm run build
```

Windows and macOS packaging definitions are separate:

```sh
npm run package:win
# Universal DMG + ZIP on a macOS 13+ host
npm run package:mac
```

The macOS preview uses ad-hoc signing. It is not a Developer ID-signed and notarized public distribution.

### Common shortcuts

`Mod` means Ctrl on Windows and Cmd on macOS. App shortcuts can be changed in Settings.

- `Mod+P`: quick open
- `Mod+Shift+F`: workspace search
- `Mod+S` / `Mod+Shift+S`: save / save all
- `Mod+Shift+P`: command palette
- `F2` / `F12` / `Shift+F12`: rename / definition / references
- `Mod+.`: code actions
- `Mod+K`, `Mod+I`: hover
- `Mod+Shift+Space`: signature help
- `F9` / `F5` / `Shift+F5`: breakpoint / debug / stop

### Project configuration

Within the supported subset, Witch reads `.witch/tasks.json`, `.witch/launch.json`, `.vscode/tasks.json`, and `.vscode/launch.json`. Opening a project never runs Tasks, builds, tests, migrations, or shell initialization scripts automatically.

Rust LSP uses a system `rust-analyzer` or the absolute `WITCH_RUST_ANALYZER_PATH`. Rust build scripts and procedural macros are not enabled automatically. Python debugging requires `debugpy` to be installed in the selected environment; Witch does not install it.

### Evaluation and verification

Witch publishes how it measures quality without copying third-party benchmark source into this repository. See the [evaluation guide](docs/evaluation/README.md), [reproduction instructions](docs/evaluation/reproducibility.md), and [limitations](docs/evaluation/limitations.md).

Key results at the 2026-09-02 source checkpoint:

| Verification axis | Result | Interpretation boundary |
| --- | ---: | --- |
| Unit/integration tests | 140 passed | Real filesystem, LSP, debugger, PTY, and local Provider doubles |
| Electron E2E | 25 passed | Real UI and IPC with disposable workspaces and profiles |
| SWARM-CG Python | Scoped F1 87.64% | Development micro; oracle edge coverage 17.99% |
| PyAnalyzer macro C | Scoped F1 58.20% | Holdout macro; oracle edge coverage 31.68% |
| Witch Rust v1 | F1 93.75% | Development micro; no separate Rust macro holdout yet |
| DyPyBench five-project pilot | Dynamic agreement F1 62.73% | Agreement with calls observed by upstream tests, not a complete static oracle |

Micro, macro, development, and holdout measurements are never pooled. Detailed numbers are frozen in the [call-graph result](docs/evaluation/results/callgraph-2026-09-02.md); product verification is recorded in the [product-quality result](docs/evaluation/results/product-quality-2026-09-02.md).

Default checks do not call an external AI or execute target repository code:

```sh
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Additional offline and analysis commands:

```sh
npm run eval:offline
npm run benchmark:repository
npm run benchmark:behavior
npm run benchmark:frameworks
npm run benchmark:callgraph:rust
```

### Important safety boundaries

- Terminal, Task, Debugger, and SSH processes run with the user's permissions; they are not Agent sandboxes.
- An Agent workspace copy separates original files for review but is not a VM or container security boundary.
- Git worktree management and Git stage/commit/branch UI are not implemented.
- CUA currently supports optional bounded observation only; Agent clicking and typing are disabled.
- TypeScript source maps, Rust debugging, a VSIX extension host, and remote file workspaces are not implemented.
- Known `.env`, credential, and private-key paths are excluded from Agent copies, but Witch cannot guarantee detection of every secret embedded in source files.
- Analysis readings, Agent journals, checkpoints, reviews, and Runtime Traces remain in app data until removed by the user.

See [implementation status](docs/implementation-status.md), the [Engineering Core specification](docs/engineering-core-spec-v0.md), and [Runtime Trace and evaluation](docs/evaluation-runtime-trace.md) for detailed boundaries. The bilingual maintenance contract is defined in the [documentation language policy](docs/documentation-policy.md).

### Project status

Witch is a development preview. It can be built and tested from source, but it does not claim VS Code compatibility or production distribution stability. Review the documented limits first for large monorepos, dynamic-dispatch-heavy systems, unsupported frameworks, and remote workspaces.
