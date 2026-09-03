# Witch Workspace Intelligence v0

[English](workspace-intelligence-v0.md) · [한국어](workspace-intelligence-v0.ko.md)

## Purpose

Workspace Intelligence is the shared source-understanding boundary for the editor, architecture analyzer and Agent context builder. It routes a document to one language provider while preserving one typed IPC contract for diagnostics, completion, hover, signatures, definitions, references, symbols and review-only refactors.

## Providers

| Language                | Provider                                          | Availability         | Current operations                                                                                                             |
| ----------------------- | ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| TypeScript / JavaScript | bundled `typescript-language-server` + TypeScript | always bundled       | diagnostics, completion, hover, signature, definition, references, document symbols, rename and bounded text-only code actions |
| Python                  | bundled Pyright                                   | always bundled       | diagnostics, completion, hover, signature, definition, references, document symbols, rename and bounded text-edit actions      |
| Rust                    | user-installed `rust-analyzer`                    | optional system tool | the same generic LSP operations supported by the detected server                                                               |

The router recognizes `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.pyi` and `.rs`. Unsupported documents never start a language process.

## Lifecycle

1. Opening or changing a supported source document selects exactly one provider.
2. The provider starts on demand for the active workspace and receives bounded in-memory document contents.
3. Diagnostics are tagged with their provider and rendered in Monaco and the Problems list.
4. `textDocument/documentSymbol` produces a bounded, flattened Outline with source ranges.
5. Workspace changes stop all owned providers and discard document versions, completions and refactor handles.
6. Normal application shutdown waits for every owned language process to terminate.

Each completion and code-action handle is prefixed with its provider id. A handle cannot be resolved by another provider or after its document version expires.

## Tool discovery

Pyright and the TypeScript server are application dependencies and are unpacked from ASAR so the packaged Electron runtime can execute them as Node processes.

Witch does not download or execute a repository-local `rust-analyzer`. Rust discovery accepts:

- the absolute `WITCH_RUST_ANALYZER_PATH` override;
- `$HOME/.cargo/bin/rust-analyzer` or the Windows equivalent;
- fixed operating-system package locations on macOS/Linux.

If Rust tooling is absent, TypeScript and Python remain available and the UI reports the missing provider. Installing it with `rustup component add rust-analyzer` enables Rust intelligence on the next application start.

## Safety boundaries

- LSP documentation is untrusted Markdown with HTML and command trust disabled.
- The workspace watcher forwards bounded `workspace/didChangeWatchedFiles` create/change/delete notifications to already-connected providers; it does not start a provider merely because a file changed.
- Definitions, references and refactor edits must resolve inside the active workspace.
- Documents and resulting edits retain existing Witch file and total-size bounds.
- Document symbols are limited to 500 entries and 20 nesting levels.
- LSP `workspace/applyEdit` never writes source directly; edits become a Witch review preview.
- Arbitrary server commands remain blocked. Only the bundled TypeScript organize-imports command can execute, and its resulting text edit is still captured for review.
- Project-local TypeScript plugins are disabled.
- Rust build-script execution, proc macros, automatic Cargo reload and check-on-save are disabled in the initial provider configuration. Enabling code-generating Rust features requires a later explicit trust design.
- A language server runs with the local user's read authority. It is not a VM or container boundary, so only trusted system language-server executables are accepted.

## Current limits and next slice

- Python candidates from `.venv`, `venv`, `env`, active Conda and the system path are discovered without executing them. Witch stores an explicit per-project selection outside the repository and sends the active absolute interpreter path to Pyright.
- Rust requires a separately installed `rust-analyzer`. On 2026-08-31 the Windows development host connected to rust-analyzer 1.98.0 through the production `LanguageServer` adapter and verified parser diagnostics, definition/reference navigation, Outline, hover and outgoing call hierarchy against a temporary Cargo library. CI environments without the optional tool skip only this live integration case.
- Python/Rust formatter and test commands are available as confirmed Tasks, and Python uses a bounded debugpy DAP adapter. A test explorer and Rust debugger adapter are not yet implemented.
- The architecture analyzer produces compiler-verified TypeScript/JavaScript direct calls and conservative inferred Python/Rust internal call candidates. A bounded second pass consumes Pyright and installed rust-analyzer call hierarchy: matches become inferred/corroborated, while a one-line unambiguous mismatch preserves both targets and creates an OpenQuestion. Absence remains provisional. Explicit branch arms and retry-like loops/decorators feed a workflow projection with workflow focus, graph/sequence modes, and reversible branch-only collapsing. Provider type hierarchy and runtime traces are not yet consumed.
