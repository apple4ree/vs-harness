# Evaluation · Optional Runtime Trace

Phase 6 adds two independent capabilities: a bounded structural runtime reading
for one explicitly approved Project Task, and an offline-first evaluation harness
for comparing Provider outputs on identical fixtures. Neither capability changes
the source-grounded Architecture, Semantic, Behavior, or Framework contracts.

## Runtime trust boundary

Runtime tracing is off by default. Opening or analyzing a repository never runs
project code. A user selects a configured Task and accepts a native confirmation
showing the exact command and working directory. The process then has the same
local user permissions as an ordinary Witch Task; it is not an Agent sandbox.

The process may print one-line markers using this contract:

```text
WITCH_TRACE_V1 {"phase":"enter","path":"src/worker.ts","symbol":"run"}
WITCH_TRACE_V1 {"phase":"exit","path":"src/worker.ts","symbol":"run","outcome":"ok"}
```

Only `phase`, workspace-relative `path`, `symbol`, optional positive `line`, and
optional `outcome` are accepted. A marker containing any other field is dropped
in full. This prevents an `args`, `returnValue`, token, environment value, or
arbitrary payload from being partially retained. Ordinary terminal output is not
part of the trace store.

The main process resolves every marker back to exactly one symbol in the current
validated Semantic graph. Unresolved or ambiguous symbols remain diagnostics.
Accepted events retain only semantic IDs, parent identity, sequence, relative
duration, and outcome. Persisted sessions use `witch.runtime-trace/v1`; their
validation receipt fixes `actualValueCount` to `0`.

Sessions are stored outside the repository under Electron user data. A source or
Semantic revision mismatch makes a reading stale. It remains inspectable but is
not overlaid on the current graph. `observed` calls never overwrite Verified,
Inferred, or Authored static relations.

The Behavior screen provides:

- **Static**: the existing source-derived Behavior graph.
- **Observed**: directed call pairs derived from the selected compatible trace.
- **Compare**: both layers, with matched, static-only, and observed-only counts.

Stopping a trace, closing its PTY, switching projects, or quitting Witch records
an interrupted terminal state before the process is killed. Completed and failed
process exits remain distinct.

## Evaluation fixtures

Each case is self-contained and repository code is not executed by the harness:

```text
evals/<case-id>/
  project/
  request.json
  expected-scope.json
  assertions.json
  allowed-commands.json
```

The runner inventories regular files without following symbolic links, hashes
the fixture before and after the Provider call, validates bounded provider output,
and calculates context, plan, changed-path, command, verification, and source
stability metrics separately. A Provider cannot improve one dimension by hiding
failure in another score.

`npm run eval:offline` runs every local fixture with the deterministic Fake
Provider and prints a `witch.evaluation-matrix/v1` report. Programmatic matrices
may include multiple Providers; every Provider receives the same immutable case
input and receives its own score row.

Live evaluation is deliberately excluded from default gates. It requires all of:

1. a Provider declared as `live`;
2. `allowLive: true` from the runner;
3. explicit approval for that run;
4. `WITCH_LIVE_EVAL=1` in the environment.

Result replay accepts only a valid SHA-256 receipt and has no Provider, command,
or filesystem execution capability. Fault fixtures cover truncated provider
output, tool exit, checkpoint failure, renderer reload, app quit, external source
mutation, repeated verification, oversized diff, symlink scope, and stopping
before approval.

## Current limits

- Witch does not inject instrumentation automatically. Project code or a test
  harness must emit explicit structural markers.
- A trace is one Task process and its marker stream, not system-wide profiling.
- Asynchronous causal context crossing threads/processes is not inferred.
- Runtime arguments, returns, object values, terminal output, network payloads,
  and environment values are intentionally unavailable.
- Live Codex/Claude evaluation adapters are not enabled in default CI; the shared
  matrix contract is ready, while paid/online runs remain explicit opt-in work.
