# Evaluation metrics

[English](metrics.md) · [한국어](metrics.ko.md)

## Call-graph sets

For one case:

- `G` is the set of oracle internal edges.
- `W` is the set of internal edges emitted by Witch.
- `Dg` is the set of symbols declared by the oracle.
- `Dw` is the set of source symbols declared by Witch.
- `C = Dg ∩ Dw` is the mutually comparable symbol universe.
- `Gs` contains edges from `G` whose endpoints are both in `C`.
- `Ws` contains edges from `W` whose endpoints are both in `C`.

The scoped comparison is symmetric: both graphs are restricted to `C`.
Restricting only the oracle would unfairly count Witch edges that the oracle
cannot describe as false positives.

## Edge accuracy

For either raw or scoped sets:

```text
TP = |prediction ∩ oracle|
FP = |prediction - oracle|
FN = |oracle - prediction|

precision = TP / (TP + FP)
recall    = TP / (TP + FN)
F1        = 2 × precision × recall / (precision + recall)
```

F1 is zero when both precision and recall are zero. The JSON contract retains
set-comparison identities for empty denominators but records `metricValidity`.
Human-readable reports display an invalid empty-denominator metric as `n/a`,
not as evidence of perfect performance.

## Coverage

Scoped accuracy is incomplete without these quantities:

```text
oracle edge coverage   = |Gs| / |G|
oracle symbol coverage = |C| / |Dg|
```

A high scoped F1 with low edge coverage means Witch performs well only on a
small comparable slice. It is not a whole-corpus accuracy claim.

## Case accuracy

- `exact`: no raw false positive and no raw false negative.
- `scopedExact`: `Ws` and `Gs` are identical.
- `nonVacuous`: `Gs` contains at least one edge.
- `nonVacuousExactRate`: exact scoped cases divided by non-vacuous cases.

Vacuous scoped cases are counted and disclosed but do not improve the
non-vacuous exact rate.

## Aggregation

Edge metrics are micro-aggregated within a single declared corpus by summing TP,
FP, and FN before calculating ratios. Reports also retain per-project counts.
Witch does not combine:

- micro fixtures with macro projects;
- development with holdout results;
- static curated ground truth with dynamic observations;
- different languages into one headline F1.

## Dynamic agreement

DyPyBench records edges observed while upstream tests execute. Its scoped
figures mean agreement between Witch's static graph and that observation.
An unobserved static edge can still be correct, and an unexecuted path can still
be missing from the dynamic oracle. These numbers are labeled `dynamic
agreement`, not general static precision.

## Product and scale metrics

Product reports use pass/fail counts with the exact command and environment.
Scale reports may include elapsed time, files, source symbols, relations,
validation failures, cache hits, maximum RSS, projected nodes, omitted nodes,
and layout time. Analyzer-process RSS is not presented as total Electron memory.
