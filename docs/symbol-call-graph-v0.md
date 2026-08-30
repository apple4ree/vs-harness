# Symbol call graph v0

Witch's first symbol-call slice adds source-grounded TypeScript/JavaScript call relations to the separately validated `witch.semantic/v1` graph. The file-level `witch.architecture/v1` topology remains an import/export graph.

## Accepted relation

A call becomes `verified / accepted` only when all of these conditions hold:

1. the syntax node is a `CallExpression` inside an extracted function, method or top-level const-function body;
2. the callee is a direct identifier, not a property access;
3. a bounded TypeScript `Program` and `TypeChecker` resolve that identifier to an analyzed workspace declaration;
4. the target is an extracted function declaration or immutable const-function; and
5. the call-site evidence path/hash still belongs to the current source revision.

Internal aliases and path-mapped imports are resolved through the same project module-resolution boundary as the file graph. The compiler host serves only source already accepted by the bounded repository scan. It does not load project TypeScript plugins or execute project code.

Property calls such as `service.submit()` are intentionally excluded because a static property symbol does not prove the runtime implementation under inheritance, interface dispatch, proxies or mutation. Constructors, callbacks passed as values, reflection, dynamic imports, external packages and module-level calls without an extracted caller are also excluded from v0.

## Meaning and Workflow projection

The **Calls · Symbols** Meaning lens shows only symbols participating in verified calls and the relations between them. Selecting a symbol exposes the call direction, trust, confidence and exact call-site evidence.

When an already inferred Workflow entry directly calls another resolved symbol, Witch adds that symbol as a provisional workflow participant:

- the underlying symbol-to-symbol `calls` relation remains verified;
- interpreting the callee as a workflow step remains inferred/provisional;
- no `precedes` relation, branch, retry, runtime order or observed execution is created;
- the participant description states this boundary explicitly.

The same nodes and call relations enter the bounded semantic dossier when a Meaning card is attached to the Agent. The main process reconstructs the dossier from the current validated graph instead of trusting renderer-provided labels or paths.

## Bounds and current limits

- Call resolution runs only when the scan contains a TypeScript/JavaScript call expression.
- Programs above 2,500 analyzed TS/JS files or 32 MB of accepted TS/JS source keep file/import analysis but skip call resolution with a warning.
- At most 10,000 unique call pairs and 20 evidence sites per pair are retained.
- Workflow projection adds at most six direct participants per workflow and 400 participants per graph.
- The call program is rebuilt after source analysis; a persistent/incremental symbol index is not yet claimed.
- Python/Pyright and Rust/rust-analyzer call hierarchy are the next language adapters. Regex/name matching will not be promoted to verified calls.
