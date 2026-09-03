# Witch Multi-repository Federation v1

[English](multi-repository-federation-v1.md) · [한국어](multi-repository-federation-v1.ko.md)

Status: implemented preview
Contract: `witch.graph-federation/v1`
Algorithm: `exact-package-identity-v1`

## Purpose

Federation shows how independently analyzed repositories may form one system without pretending that they share one source tree. Open **Intelligence → Federation**, select the latest saved readings of recent projects, and build a read-only system map.

Witch currently creates a cross-repository link only when one repository declares a dependency and another declares the same normalized package identity in the same ecosystem. npm, Python, and Cargo identities are kept separate.

## Trust and revision boundary

- Every repository retains its own workspace root and Source, Semantic, Behavior, Knowledge, and Meta Graph revisions.
- Local node ID spaces are never merged. Federation links connect repository IDs, not guessed internal symbols.
- Only validated, accepted graph readings are admitted. A quarantined last-known-good fallback cannot enter a new federation.
- Snapshot repositories are immutable readings. The active repository uses the currently displayed accepted graph.
- Cross-repository links are `inferred` and `provisional`; a manifest match is not proof of a runtime deployment connection.
- A matching repository-authored mapping or an explicit UI provider approval changes only that exact link to `authored/resolved`.
- Evidence stores the declaring repository ID, relative path, line, and source hash for both ends.

## Input selection

The main process offers at most the newest snapshot from each of the 11 most recent inactive projects. Together with the active project, one federation contains at most 12 repositories. An IPC caller cannot select an arbitrary or older snapshot by ID.

Repositories must first be opened and analyzed with **Read structure** so Witch can save their validated reading. Opening or federating a project never runs its source, Tasks, build scripts, or package manager.

## Authored repository mapping

Each participating repository may add a portable `.witch/federation.json` file. It uses stable authored keys instead of local absolute paths:

```json
{
  "version": 1,
  "repositoryKey": "witch-app",
  "mappings": [
    {
      "ecosystem": "npm",
      "package": "@witch/core",
      "provider": "witch-core"
    }
  ]
}
```

The provider repository declares its own matching `repositoryKey`. Witch stores the repository identity and each mapping as source-backed `authored` Knowledge nodes. A mapping resolves a link only when exactly one selected repository has that key and also contains the exact package declaration. Missing keys, duplicate keys, contradictory mappings, and package mismatches remain open `authored-mismatch` questions.

## Explicit approval journal

For an inferred duplicate-provider question, the Federation screen offers one **Approve** action per exact candidate. The main process rebuilds the federation, verifies its revision and candidate endpoints, and then appends `witch.federation-approval/v1` to an atomic app-data journal. The receipt binds the question, prior federation revision, ecosystem/package, both workspace roots, and both source revisions. Repository content is not written.

Only the newest approval whose complete subject/provider revisions still match is applied. A source change automatically makes an old approval inapplicable while retaining it in history. Repository-authored mappings take precedence; the UI cannot silently override an authored mismatch.

The Federation approval-history panel distinguishes applied, active, superseded, stale, out-of-current-map, and revoked receipts. Revocation requires a second confirmation and appends a `witch.federation-approval-revocation/v1` event. It invalidates all earlier approvals for the same question, subject revision, ecosystem, and package, so an older provider choice cannot silently reactivate. A later explicit approval becomes a new auditable decision.

## Matching rules

Package names use Unicode NFKC and lowercase comparison. Python alone additionally applies the PEP 503 equivalence for runs of hyphens, underscores, and dots; npm and Cargo separators remain distinct. A link requires:

1. equal ecosystem: `npm`, `python`, or `cargo`;
2. equal normalized dependency and provider package identity;
3. different repository roots;
4. source-hash-valid dependency and package declaration evidence.

One provider produces a link with confidence `0.86`. If two or more selected repositories declare the same package, Witch retains every candidate at confidence `0.45`, marks the links `conflicting`, and creates an open Grill-me question. A matching authored mapping resolves at confidence `1.0`; an exact UI approval resolves at `0.98`. Witch does not choose a duplicate provider silently.

Each link keeps at most 12 evidence entries, evenly bounded between dependency and package declarations. A federation is capped at 500 links and reports truncation as a diagnostic.

## Validation receipt

The deterministic federation revision covers canonical repositories, links, questions, and their evidence. Validation rejects:

- duplicate repository roots or IDs;
- stale Source/Semantic/Behavior/Knowledge revisions;
- missing or duplicate link IDs and invalid endpoints;
- evidence with a missing repository, stale hash, invalid line, or missing declaration role;
- ambiguity questions with fewer than two valid targets;
- resolved links without a matching source-authored mapping or revision-bound approval receipt;
- content that does not match its federation revision.

Identical accepted graph inputs produce the same repository ordering, links, questions, and federation revision regardless of selection order.

## Current limits

- Matching does not resolve Git URLs, renamed packages, publish aliases, service URLs, queues, databases, RPC schemas, or runtime topology.
- The screen opens source only for evidence in the active repository. Snapshot evidence is shown read-only with its path and line.
- Federation is generated on demand and is not yet stored as a separate historical artifact or attached to Agent preflight context.
- Approval and revocation history is bounded to 1,000 records of each kind. The screen renders the newest 100 approval records and reports the retained total. Export and cross-device synchronization are not implemented.
