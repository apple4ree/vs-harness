# Witch Workspace Intelligence v0

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
- Definitions, references and refactor edits must resolve inside the active workspace.
- Documents and resulting edits retain existing Witch file and total-size bounds.
- Document symbols are limited to 500 entries and 20 nesting levels.
- LSP `workspace/applyEdit` never writes source directly; edits become a Witch review preview.
- Arbitrary server commands remain blocked. Only the bundled TypeScript organize-imports command can execute, and its resulting text edit is still captured for review.
- Project-local TypeScript plugins are disabled.
- Rust build-script execution, proc macros, automatic Cargo reload and check-on-save are disabled in the initial provider configuration. Enabling code-generating Rust features requires a later explicit trust design.
- A language server runs with the local user's read authority. It is not a VM or container boundary, so only trusted system language-server executables are accepted.

## Current limits and next slice

- Python interpreter and environment selection is automatic Pyright discovery; there is not yet a Witch `.venv`/Poetry/uv/Conda selector.
- Rust requires a separately installed `rust-analyzer` and has not been executed on this Windows development host because the tool is absent.
- Python/Rust formatter, linter, test explorer and debugger adapters are not part of this slice.
- The architecture analyzer does not yet consume LSP call hierarchy or type hierarchy. That is the bridge into Semantic Graph v2 after the local ADE language foundation is stable.
