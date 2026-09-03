# Call hierarchy corroboration and workflow exploration v1

<!-- witch-doc-languages: ko,en -->

> **한국어:** 보수적인 Python/Rust source binder 결과를 Pyright와 선택적 rust-analyzer call hierarchy로 교차 검증하는 신뢰 전이와 안전 예산을 정의합니다.
>
> **English:** This specification defines trust transitions and safety budgets when Pyright or optional rust-analyzer call hierarchy corroborates conservative Python/Rust source binding.

Witch now connects its conservative Python/Rust source binder to the language servers already used by the editor. Pyright is bundled; rust-analyzer is used when an executable is installed or configured. This is a second static observer, not a runtime trace.

## Trust transitions

| Result                                                                                      | Meaning graph state                                                                 | Behavior                                                                                                        |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Source binder and LSP resolve the same internal target                                      | `inferred / corroborated`                                                           | Confidence is raised, but Python rebinding, Rust dynamic dispatch, and runtime execution are still not claimed. |
| One unambiguous source line resolves to two different internal targets                      | both relations preserved; source candidate `conflicting`, LSP target `corroborated` | A relation-backed OpenQuestion recommends the language-server target and retains both evidence paths.           |
| LSP returns no result, times out, is unavailable, or resolves only external/dynamic targets | existing `inferred / provisional` relation                                          | Absence is never treated as contradiction.                                                                      |

The adapter checks at most 48 inferred callers, four at a time, with per-request and 12-second total safety budgets. Project source is synchronized as text. Witch does not import Python modules, compile Rust, enable rust-analyzer build scripts/proc macros, or execute project commands for corroboration.

## Workflow exploration

The Workflows lens has three independent display controls:

- **Workflow focus** limits the projection to one workflow, its contained steps, and—only in Graph mode—the source symbols those steps execute.
- **Graph / Sequence** switches between the relationship map and a top-to-bottom control-flow projection. Sequence mode keeps `precedes`, `branches-to`, `retries`, and the workflow entry link.
- **Collapse branches** hides branch-only paths while retaining the guard and any statically visible convergence. It changes only the projection; no semantic nodes or relations are deleted.

Sequence order and collapsed branch membership remain source-level interpretations. Runtime-selected arms, exception paths, early returns, retry outcomes, concurrency, and data flow require authored definitions or runtime observation.
