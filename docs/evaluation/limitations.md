# Evaluation limitations

The published methodology makes Witch's evidence inspectable; it does not turn
the current preview into a complete or certified IDE.

## Analysis limits

- Deep static analysis currently targets TypeScript/JavaScript, Python, and
  Rust. File-level visibility for another language is not semantic support.
- Python reflection, monkey patching, generated attributes, arbitrary
  decorators, metaclasses, and runtime container contents cannot be fully
  recovered statically.
- Rust macro expansion, build-script output, feature-dependent resolution, and
  all higher-order callable flows are not complete.
- Static workflow order is provisional. It is not an execution trace.
- Framework adapters recognize bounded, explicit source registrations and leave
  unresolved dynamic cases as diagnostics.

## Oracle limits

- SWARM-CG and PyAnalyzer use different symbol conventions and corpus designs.
- A scoped score describes only the mutually comparable symbol universe.
- Low oracle coverage can coexist with high scoped precision.
- Dynamic traces depend on upstream test coverage and are not complete static
  truth.
- Witch-owned fixtures measure regressions, not independent generalization.
- The current Rust benchmark is micro development data; no independent Rust
  macro holdout has been published yet.

## Product-test limits

- Passing source E2E does not mean the current commit has been packaged, signed,
  notarized, installed, upgraded, or removed on every platform.
- Local Windows success does not establish current macOS behavior; CI and
  packaged-app receipts are reported separately.
- E2E uses temporary test repositories. Long-running work on many real
  monorepos remains a separate reliability concern.
- Default tests verify provider protocols with deterministic doubles. They do
  not measure live-model quality or consume Codex or Claude usage.
- SSH currently provides an interactive terminal, not a remote Explorer,
  Editor, Search, LSP, Task, Debugger, or Agent workspace.

## Performance limits

- Timing and RSS depend on hardware, operating system, antivirus, filesystem,
  source size, and cache state.
- Analyzer-process RSS is not total Electron application memory.
- A bounded visual projection can remain responsive while the canonical graph
  is much larger; both sizes must be reported.
- One synthetic 5,000-file result does not predict every monorepo.

## Human interpretation limits

Crossing counts and layout constraints can reject visibly broken graphs but do
not measure whether a person understands the architecture. Readability,
explanation quality, and comparison with another visualization tool require a
dated human review and screenshots. Such review is qualitative evidence, not a
substitute for graph accuracy.

## Security limits

Static benchmarking does not execute project code, but Terminal, Task,
Debugger, SSH, optional Runtime Trace, and approved Agent operations execute
with the user's local permissions. An isolated Agent copy is a review boundary,
not a VM or container security boundary.
