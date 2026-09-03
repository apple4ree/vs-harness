# Evaluation datasets

[English](datasets.md) · [한국어](datasets.ko.md)

Witch stores dataset descriptions and immutable manifests, not third-party
source archives. A contributor obtains each corpus from its upstream project and
checks out the declared revision.

## Call-graph corpora

| Corpus                                                                     | Role          | Scale         | Upstream revision                          | Oracle                                                                          |
| -------------------------------------------------------------------------- | ------------- | ------------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| [SWARM-CG Python](https://github.com/secure-software-engineering/SWARM-CG) | development   | micro         | `5929c0a36a9c8e8c6c7539dc412336cdf6c09e58` | Published `pycg_extended` adjacency lists                                       |
| Witch Rust v1                                                              | development   | micro         | Current repository fixture                 | 17 manually authored internal edges across 12 cases                             |
| [PyAnalyzer newly-added](https://github.com/2024icse/PyAnalyzer)           | holdout       | micro         | `ea143ef8bdec2b5f8841bb600b348f0975b90349` | Separately authored micro call graphs                                           |
| [PyAnalyzer macro C](https://github.com/2024icse/PyAnalyzer)               | holdout       | macro         | `ea143ef8bdec2b5f8841bb600b348f0975b90349` | Manually curated graphs for five real projects                                  |
| [DyPyBench released pilot](https://github.com/sola-st/DyPyBench)           | blind-holdout | macro/dynamic | `bccfda78e3b7e4d8a65dfa58d1b0cd3bd35c127d` | Calls observed by upstream test suites and released in `DynaPyt_callgraphs.zip` |

The executable manifests are under
[`benchmarks/callgraph`](../../benchmarks/callgraph/README.md). They record the
role, scale, upstream location, revision, subpath, source roots, and case list.

## DyPyBench pilot selection

The pilot project list was fixed before running Witch and uses five upstream
project numbers with available released traces:

| Upstream project | Repository             | Source rule                         |
| ---------------: | ---------------------- | ----------------------------------- |
|                3 | `flask-api/flask-api`  | Last commit on or before 2023-01-18 |
|                4 | `dbader/schedule`      | Last commit on or before 2023-01-18 |
|               10 | `pallets/click`        | Last commit on or before 2023-01-18 |
|               12 | `faif/python-patterns` | Last commit on or before 2023-01-18 |
|               33 | `psf/requests`         | Last commit on or before 2023-01-18 |

This is a pilot, not a claim over all DyPyBench projects. Expanding it requires
publishing the new project list before its scores are inspected. Recreating all
dynamic traces requires the upstream isolated runtime and is intentionally not
part of ordinary Witch development or CI.

## Repository-scale corpora

Repository-scale benchmarks may use fixed public Git checkouts to measure
analysis completion, time, memory, validation, graph size, and presentation.
They do not become accuracy ground truth merely because they are large. A
report must distinguish:

- a corpus with curated expected relations;
- an upstream dynamic observation;
- a regression repository expected only to analyze successfully;
- a screenshot or human presentation comparison.

GitHub popularity or trending rank may be used to discover projects, but it is
not an accuracy metric. The selected date, source URL, full commit, language,
inclusion rule, and analysis failures must be published.

## Local synthetic data

Witch-owned fixtures are small and reviewable. They exist to isolate one
language or safety mechanism and to prevent regressions. They are development
tests, never independent evidence of real-project generalization.

## Data not stored in this repository

- third-party repository source or build artifacts;
- generated upstream runtime environments and the DyPyBench Docker image;
- local absolute checkout paths;
- credentials, provider responses, or proprietary projects;
- blind-holdout per-edge misses;
- ordinary project terminal output or runtime values.

Users fetching an upstream corpus remain responsible for its license and terms.
