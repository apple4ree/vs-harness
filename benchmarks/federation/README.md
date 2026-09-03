# Federation benchmark

[English](README.md) · [한국어](README.ko.md)

This Witch-owned regression suite measures the `witch.graph-federation/v1`
contract without running repository code or calling an AI Provider.

## Cases

The six v1 cases cover:

- an exact npm provider;
- Python PEP 503 name normalization;
- a Cargo separator near-match that must not link;
- duplicate npm providers that must remain an open ambiguity;
- a corroborated `.witch/federation.json` provider mapping;
- an authored mapping that cannot resolve and must remain a question.

The duplicate-provider case also applies an exact approval receipt and then a
stale receipt. This checks both positive resolution and fail-closed staleness.

## Metrics

The runner reports link precision and recall, exact-case rate, ambiguity-question
recall, validation rate, input-order invariance, authored resolution, explicit
approval resolution, and stale-approval rejection separately. It intentionally
does not produce a weighted overall score.

Run:

```sh
npm run benchmark:federation:check
```

The command prints `witch.federation-benchmark-run/v1` JSON with the suite
SHA-256 and runtime environment, and exits non-zero if any declared metric
regresses.

## Interpretation boundary

These fixtures are deterministic development data owned by Witch. A perfect
result establishes regression behavior only for exact npm, Python, and Cargo
package identities represented here. It does not establish general accuracy for
Git URLs, aliases, service endpoints, deployment topology, arbitrary monorepos,
or independent third-party repositories.
