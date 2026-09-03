# Product benchmark contract

[English](README.md) · [한국어](README.ko.md)

This directory contains the machine-readable contract for comparing Witch with
code-structure explorers, IDEs, ADEs, coding-Agent harnesses, and computer-use
agents. It does not contain a leaderboard or third-party product binaries.

## Files

- `suite-v1.json` declares tool classes, independent evaluation dimensions,
  metrics, execution lanes, and external benchmark adapters.
- `scripts/check-product-benchmark.ts` rejects duplicate identifiers, invalid
  references, and weighted overall scores.
- `tests/product-benchmark.test.ts` keeps the contract and its no-composite-score
  policy under regression test.

Validate the contract with:

```sh
npm run benchmark:product:check
```

The normative interpretation and reporting protocol are in the
[product benchmark guide](../../docs/evaluation/product-benchmark.md).

## Important boundary

An adapter marked `candidate`, `planned`, `deferred`, or `reference-only` is not
an implemented Witch result. External tasks may execute untrusted project code,
require containers or VMs, call paid models, and expose benchmark data to a
Provider. Those runs require a separate environment and explicit opt-in.
