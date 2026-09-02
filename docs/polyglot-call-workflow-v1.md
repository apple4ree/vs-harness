# Polyglot call and workflow control flow v1

Witch now projects conservative Python and Rust symbol calls, plus source-level workflow order, branch membership, and explicit retry controllers into the separately validated `witch.semantic/v1` graph. Project code is read but never imported, compiled, or executed during this analysis.

## Trust contract

| Input                                                                                    | Relation      | Trust                    | Reason                                                                      |
| ---------------------------------------------------------------------------------------- | ------------- | ------------------------ | --------------------------------------------------------------------------- |
| TypeScript/JavaScript direct identifier resolved by `TypeChecker`                        | `calls`       | `verified / accepted`    | The compiler resolves an internal immutable function declaration.           |
| Python direct/local/imported name or conservative `self` method candidate                | `calls`       | `inferred / provisional` | Python names can be rebound or monkey-patched at runtime.                   |
| Rust direct/module/associated function candidate                                         | `calls`       | `inferred / provisional` | The bounded source resolver does not claim compiler type or trait dispatch. |
| Lexical order in one straight-line/control arm                                           | `precedes`    | `inferred / provisional` | Exceptions, returns and runtime dispatch can bypass later calls.            |
| Call lexically contained in `if`/`elif`/`else` or Rust `if`/`else`/`match` arm           | `branches-to` | `inferred / provisional` | Static membership is visible; the runtime-selected arm is not observed.     |
| Call body under an explicitly named retry/attempt/backoff loop or Python retry decorator | `retries`     | `inferred / provisional` | The source exposes repetition intent, not actual attempts or success.       |

The call lens includes both verified and inferred relations and keeps trust, confidence, resolver description, and exact source evidence visible. Property/dynamic dispatch without a conservative same-container binding is omitted instead of guessed.

## Python rules

The bounded Python adapter accepts calls inside extracted functions or methods when the target is unique and source-local through one of these forms:

- a same-module function, `validate()`;
- an explicit `from module import validate` binding, including aliases;
- a module import call, `risk.validate()`;
- a unique same-class `self.validate()` or explicit `Class.validate()` candidate.

Built-ins, constructors, arbitrary instance property calls, reflection, callbacks used only as values, unresolved imports, and external package targets are excluded. Strings and comments are masked before call/control matching. All accepted Python calls remain inferred because runtime rebinding is legal.

## Rust rules

The bounded Rust adapter accepts unique internal functions or methods through:

- a same-module function, `validate()`;
- an imported item, including `use ...::{item, item as alias}`;
- a module-qualified call, `broker::submit()` or `crate::broker::submit()`;
- a conservative same-`impl` `Self::method()`/`self.method()` candidate;
- a unique explicit associated function candidate, `RiskEngine::check()`.

Macros, external crates, unresolved trait-object/property dispatch, closures without extracted symbols, and ambiguous declarations are excluded. Rust calls remain inferred until a compatible rust-analyzer call hierarchy corroborates the target.

## Workflow projection

Only symbols already selected by the Agent/finance workflow policy become workflow roots. Their bounded call sites are ordered by source position, then projected as individual workflow-step nodes:

1. the entry step reaches the first visible call or controller;
2. straight-line calls and calls in the same control arm receive `precedes` edges;
3. every explicit branch receives a `guard` step and `branches-to` edges to each visible arm;
4. every retry-like loop/decorator receives a `retry` step and a `retries` edge to its body;
5. a numeric `range(N)` or Rust range upper bound is retained as an inferred maximum-attempt description;
6. possible branch convergence and post-retry continuation stay lower-confidence `precedes` relations.

No edge means that every runtime execution follows that path. The graph does not yet claim exception edges, return flow, async scheduling, data flow, timeout/cancel behavior, framework lifecycle, actual execution count, or observed latency.

## Bounds and safety

- Existing repository limits still apply: 64 MB accepted source by default and 1.5 MB per text file.
- At most 10,000 combined symbol-call pairs and 20 displayed evidence sites per pair are retained.
- A call pair keeps at most 40 bounded call sites for workflow projection.
- Each inferred workflow keeps at most 16 call-site participants; the graph keeps at most 800 participants across workflows.
- The renderer keeps its existing 220-node and 600-edge view limits; search/lenses narrow larger graphs.
- Semantic evidence path, hash, endpoints, trust/status, and revision are revalidated before rendering, history, export, or Agent attachment.

## Next corroboration layer

Pyright and rust-analyzer call hierarchy can later corroborate or reject these candidates. That future result must preserve the source candidate and provenance rather than silently rewriting an inferred relation into a verified fact. Runtime traces will be stored as a separate observed layer.
