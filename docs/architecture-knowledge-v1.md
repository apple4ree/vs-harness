# Witch Architecture Knowledge v1 Specification

[English](architecture-knowledge-v1.md) · [한국어](architecture-knowledge-v1.ko.md)

Status: first P2 stage implemented
Contract: `witch.knowledge/v1`
Inputs: `witch.architecture/v1`, optional `witch.semantic/v1`, and repository ADR/RFC, manifest, and configuration files

## 1. Objective

Compare the structure shown by code with human decisions, package boundaries, and project configuration in one queryable graph. The Knowledge overlay does not replace Source, Semantic, or Behavior IR. Every item retains its source file, line, content hash, and extractor rule.

## 2. Supported inputs

- ADR/RFC: Markdown under `adr`, `adrs`, `rfc`, `rfcs`, or `architecture/decisions`, plus numbered ADR/RFC filenames
- npm: package name and dependencies/devDependencies/peerDependencies/optionalDependencies from `package.json`
- Python: PEP 621 or Poetry packages and dependencies from `pyproject.toml`, plus `requirements*.txt`
- Rust: package and dependency/dev-dependency/build-dependency declarations from `Cargo.toml`
- Configuration: `tsconfig*`, `jsconfig*`, Ruff, Mypy, Pytest, Tox, Rust toolchain, Cargo config, Compose, and GitHub Actions
- Federation authorship: stable `repositoryKey` and package-provider mappings from `.witch/federation.json`

Project code is never executed. Only known paths and static syntax are read.

## 3. Nodes and relations

Node kinds are `decision`, `rfc`, `manifest`, `package`, `dependency`, `configuration`, `federation-repository`, and `federation-mapping`.

Relations are limited to `documented-in`, `declared-in`, `depends-on`, `configures`, `documents`, `describes`, `supersedes`, and `evidenced-by`.

- Packages and dependencies declared directly by a manifest are `verified/accepted`.
- ADR/RFC text and explicit supersedes declarations are `authored`.
- Links claiming a document or configuration describes the overall System are path-convention-based `inferred/provisional` readings.
- Authored and Inferred readings are never collapsed into one certain fact.
- Federation repository keys and mappings are `authored/accepted`; exact package declarations remain independently `verified/accepted`.

## 4. Rationale extraction

Deterministically extract the title, Status, and first paragraph under Context/Problem, Decision/Proposal, and Consequences/Tradeoffs. Each field is bounded to 600 characters. An explicit `Supersedes:` or `Replaces:` creates an authored `supersedes` relation only when it clearly resolves to a title or path in the current document set. An unresolved target remains a warning rather than a guessed edge.

## 5. Privacy and trust boundary

- Do not copy arbitrary configuration values, scripts, environment values, or credentials into Knowledge descriptions.
- Manifest/config evidence stores only path, line, and hash, with no source excerpt.
- Dependency and package names are retained as structural declaration facts.
- Only bounded authored ADR/RFC rationale text is retained.
- Federation nodes retain only bounded repository keys, ecosystems, and package/provider identities; local absolute provider paths are not written to source.

## 6. Validation and limits

- Every evidence hash must match the corresponding Architecture source node.
- Every relation endpoint must exist in Source, Semantic, or Knowledge IR.
- Bounds are 2,000 nodes, 5,000 relations, and 1,200 dependencies per manifest.
- Malformed `package.json` and unresolved supersedes declarations produce warnings while retaining other knowledge.
- Lockfile parsing, transitive resolution, license/CVE judgment, and natural-language inference over Markdown are not implemented yet.

## 7. Product integration

The Graph Intelligence index includes Knowledge nodes, relations, and `knowledgeRevision`. Query, typed impact, Architecture Brief, and Codex/Claude preflight consume the same bounded knowledge. **Intelligence → Knowledge** separates decisions, packages/dependencies, and configuration; each result can open its source or be attached to Agent context.

When Semantic Composer produces a new semantic revision, Witch rebinds the Knowledge overlay while retaining only endpoints that still exist. It never sends relations bound to an older meaning revision as if they were current.

## 8. Acceptance criteria

- Python, Rust, and TypeScript manifest fixtures reproduce under the same rules.
- ADR rationale and explicit supersedes retain source evidence.
- Arbitrary config values are not copied into Knowledge JSON.
- Tampered evidence and stale semantic revisions fail closed.
- Knowledge nodes resolve through path impact and Agent graph queries.
- Federation keys and mappings retain source evidence and reject invalid reserved fields.
