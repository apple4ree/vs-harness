# Analysis depth v1

[English](analysis-depth-v1.md) · [한국어](analysis-depth-v1.ko.md)

Witch now retains internal type hierarchy and module-state access that the
symbol parsers previously discarded. The implementation remains source-only:
opening a repository does not import, compile, build, or execute project code.

## Emitted relations

| Language                | Relation                | Trust    | Acceptance rule                                                                                                                                                                        |
| ----------------------- | ----------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript / JavaScript | `extends`, `implements` | Verified | TypeChecker resolves both endpoints to extracted internal declarations.                                                                                                                |
| TypeScript / JavaScript | `overrides`             | Verified | A method resolves to a declaration on a directly extended internal base type.                                                                                                          |
| TypeScript / JavaScript | `reads`, `writes`       | Verified | TypeChecker resolves an identifier inside a callable to an extracted internal module variable. Plain assignment emits `writes`; compound assignment and increment/decrement emit both. |
| Python                  | `extends`, `overrides`  | Inferred | A direct base class is unique in the same module or an explicitly resolved internal import. Runtime metaclasses and rebinding remain unproven.                                         |
| Rust                    | `implements`            | Inferred | An `impl Trait for Type` trait and matching trait method are unique internal source declarations. Compiler type resolution remains unproven.                                           |

Every accepted relation carries the exact source path, line, content hash, and
bounded excerpt. Unresolved, external, ambiguous, dynamic, computed, or
metaclass-generated targets are omitted rather than converted into a confident
edge.

The Meaning workspace exposes two dedicated projections:

- **Types · Hierarchy** shows only `extends`, `implements`, and `overrides`.
- **Data · State access** shows only `reads` and `writes`.

Both reuse the validated `witch.semantic/v1` graph, relation evidence, trust
styling, readable-backbone projection, and Complete map. They are projections,
not separate sources of truth.

## Fixed ten-repository regression

The same frozen Trending corpus used by the previous benchmark was analyzed
again. All ten semantic receipts remained valid.

| Project                            | Previous relations | New relations |              Added |
| ---------------------------------- | -----------------: | ------------: | -----------------: |
| THU-MAIC/OpenMAIC                  |             37,990 |        41,707 |              3,717 |
| K-Dense-AI/scientific-agent-skills |             25,863 |        26,049 |                186 |
| Lakr233/vphone-cli                 |                627 |           627 |                  0 |
| tt-a1i/archify                     |              5,013 |         5,672 |                659 |
| p-e-w/heretic                      |                522 |           522 |                  0 |
| unclecode/crawl4ai                 |             16,295 |        16,564 |                269 |
| mvanhorn/last30days-skill          |             16,135 |        16,182 |                 47 |
| majd/ipatool                       |                  0 |             0 |                  0 |
| punkpeye/awesome-mcp-servers       |                  0 |             0 |                  0 |
| checkstyle/checkstyle              |                156 |           156 |                  0 |
| **Total**                          |        **102,601** |   **107,479** | **4,878 (+4.75%)** |

The 4,878 new relations are exactly 4,034 `reads`, 135 `writes`, 440
`extends`, 33 `implements`, and 236 `overrides`. Projects dominated by Swift,
Java, documentation, or code without an eligible internal relation correctly
remain unchanged.

Aggregate cold analysis time in the final run changed from 39,007 ms to 46,903
ms (+20.24%). The largest TypeScript repository, OpenMAIC, changed from 14,054
ms to 15,877 ms while adding 3,717 relations. A rejected first implementation
queried the TypeChecker for every identifier and took 30,101 ms on OpenMAIC.
The accepted implementation prefilters only local and resolved-import module
variable candidates, retaining 3,462 state relations there while avoiding that
cost. Timing is machine- and cache-sensitive; the relation and receipt counts
are the deterministic regression criteria.

Raw results are stored outside the repository under
`witch-benchmarks/github-trending-2026-08-31/results-analysis-depth-v1-final`.

## Explicit limits

- Python arbitrary instance properties, monkey-patching, descriptors,
  metaclasses, and transitive override search are not resolved.
- Rust inherent `impl` blocks do not produce a trait relation. Trait aliases,
  macro-generated implementations, blanket implementations, and associated
  type bindings require compiler or rust-analyzer evidence.
- TypeScript property calls remain outside the verified call graph because
  runtime override dispatch can select another implementation.
- Data access currently covers extracted TypeScript / JavaScript module
  variables. Object fields, parameters, locals, databases, files, message
  payloads, and cross-language data flow are not claimed.
- `reads` and `writes` describe static source access, not runtime frequency,
  ordering, value, side effects, or impact.
