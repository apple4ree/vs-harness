import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { analyzeRepository } from "../apps/desktop/src/main/services/architecture";
import {
  buildArchitectureFederation,
  validateArchitectureFederation,
  type FederationInput,
} from "../apps/desktop/src/shared/federation";

async function repository(
  root: string,
  name: string,
  dependencies: string[] = [],
  federation?: {
    repositoryKey: string;
    mappings?: Array<{
      ecosystem: "npm" | "python" | "cargo";
      package: string;
      provider: string;
    }>;
  },
) {
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(
    path.join(root, "src", "index.ts"),
    "export function identity(value: string) { return value }\n",
  );
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name,
        dependencies: Object.fromEntries(
          dependencies.map((dependency) => [dependency, "workspace:*"]),
        ),
      },
      null,
      2,
    ),
  );
  if (federation) {
    await fs.mkdir(path.join(root, ".witch"));
    await fs.writeFile(
      path.join(root, ".witch", "federation.json"),
      JSON.stringify({ version: 1, ...federation }, null, 2),
    );
  }
  return analyzeRepository(root);
}

test("federation preserves repository revisions and exact package evidence", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "witch-federation-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const app = await repository(path.join(parent, "app"), "@witch/app", [
    "@witch/core",
  ]);
  const core = await repository(path.join(parent, "core"), "@witch/core", [], {
    repositoryKey: "witch-core-primary",
  });
  const duplicate = await repository(
    path.join(parent, "core-copy"),
    "@witch/core",
    [],
    { repositoryKey: "witch-core-copy" },
  );
  const inputs: FederationInput[] = [
    { graph: app, role: "active", workspaceName: "App" },
    {
      graph: core,
      role: "snapshot",
      workspaceName: "Core",
      snapshotId: "snapshot-core",
    },
  ];
  const federation = buildArchitectureFederation(inputs);
  assert.equal(federation.contract, "witch.graph-federation/v1");
  assert.equal(federation.validation.valid, true);
  assert.equal(federation.validation.repositoryCount, 2);
  assert.equal(federation.links.length, 1);
  assert.equal(federation.links[0].packageName, "@witch/core");
  assert.equal(federation.links[0].status, "provisional");
  assert.deepEqual(
    [...new Set(federation.links[0].evidence.map((item) => item.role))].sort(),
    ["dependency-declaration", "package-declaration"],
  );
  assert(federation.repositories.every((item) => item.metaRevision));
  assert.equal(federation.repositories[0].role, "active");

  const repeated = buildArchitectureFederation([...inputs].reverse());
  assert.equal(repeated.revision, federation.revision);
  assert.deepEqual(repeated.repositories, federation.repositories);
  assert.deepEqual(repeated.links, federation.links);

  const tampered = structuredClone(federation);
  tampered.links[0].evidence[0].hash = "stale";
  const receipt = validateArchitectureFederation(tampered, inputs);
  assert.equal(receipt.valid, false);
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "FEDERATION_EVIDENCE_STALE",
    ),
  );
  assert(
    receipt.diagnostics.some(
      (item) => item.code === "FEDERATION_REVISION_MISMATCH",
    ),
  );

  const ambiguous = buildArchitectureFederation([
    ...inputs,
    {
      graph: duplicate,
      role: "snapshot",
      workspaceName: "Core copy",
      snapshotId: "snapshot-copy",
    },
  ]);
  assert.equal(ambiguous.links.length, 2);
  assert(ambiguous.links.every((link) => link.status === "conflicting"));
  assert.equal(ambiguous.questions.length, 1);
  assert.equal(ambiguous.questions[0].candidateRepositoryIds.length, 2);

  const subject = ambiguous.repositories.find(
    (repository) => repository.workspaceRoot === app.workspaceRoot,
  )!;
  const approvedProvider = ambiguous.repositories.find(
    (repository) => repository.workspaceRoot === core.workspaceRoot,
  )!;
  const approval = {
    contract: "witch.federation-approval/v1" as const,
    id: "44444444-4444-4444-8444-444444444444",
    decision: "approve-provider" as const,
    questionId: ambiguous.questions[0].id,
    federationRevision: ambiguous.revision,
    subjectWorkspaceRoot: subject.workspaceRoot,
    subjectSourceRevision: subject.sourceRevision,
    providerWorkspaceRoot: approvedProvider.workspaceRoot,
    providerSourceRevision: approvedProvider.sourceRevision,
    ecosystem: "npm" as const,
    packageName: "@witch/core",
    decidedAt: "2026-09-03T12:00:00.000Z",
  };
  const approved = buildArchitectureFederation(
    [
      ...inputs,
      {
        graph: duplicate,
        role: "snapshot",
        workspaceName: "Core copy",
        snapshotId: "snapshot-copy",
      },
    ],
    { approvals: [approval] },
  );
  assert.equal(approved.links.length, 1);
  assert.equal(approved.links[0].status, "resolved");
  assert.equal(approved.links[0].resolutionSource, "user-approval");
  assert.equal(approved.links[0].resolutionId, approval.id);
  assert.deepEqual(approved.approvals, [approval]);
  assert.equal(approved.questions.length, 0);

  const staleApproval = {
    ...approval,
    id: "55555555-5555-4555-8555-555555555555",
    providerSourceRevision: "stale",
  };
  const staleResult = buildArchitectureFederation(
    [
      ...inputs,
      {
        graph: duplicate,
        role: "snapshot",
        snapshotId: "snapshot-copy",
      },
    ],
    { approvals: [staleApproval] },
  );
  assert.equal(staleResult.questions.length, 1);
  assert.equal(staleResult.approvals.length, 0);

  for (const malformedApproval of [
    { ...approval, questionId: "federation-question:wrong" },
    { ...approval, decidedAt: "not-a-date" },
    { ...approval, id: "not-a-uuid" },
  ]) {
    const malformedResult = buildArchitectureFederation(
      [
        ...inputs,
        {
          graph: duplicate,
          role: "snapshot",
          snapshotId: "snapshot-copy",
        },
      ],
      { approvals: [malformedApproval] },
    );
    assert.equal(malformedResult.questions.length, 1);
    assert.equal(malformedResult.approvals.length, 0);
  }

  const mappedApp = await repository(
    path.join(parent, "mapped-app"),
    "@witch/mapped-app",
    ["@witch/core"],
    {
      repositoryKey: "witch-mapped-app",
      mappings: [
        {
          ecosystem: "npm",
          package: "@witch/core",
          provider: "witch-core-primary",
        },
      ],
    },
  );
  const authored = buildArchitectureFederation([
    { graph: mappedApp, role: "active" },
    { graph: duplicate, role: "snapshot" },
    { graph: core, role: "snapshot" },
  ]);
  assert.equal(authored.links.length, 1);
  assert.equal(authored.links[0].status, "resolved");
  assert.equal(authored.links[0].trust, "authored");
  assert.equal(authored.links[0].resolutionSource, "repository-manifest");
  assert.equal(authored.questions.length, 0);

  const similarConsumer = await repository(
    path.join(parent, "similar-consumer"),
    "similar-consumer",
    ["witch_core"],
  );
  const similarProvider = await repository(
    path.join(parent, "similar-provider"),
    "witch-core",
  );
  const exactNpmIdentity = buildArchitectureFederation([
    { graph: similarConsumer, role: "active" },
    { graph: similarProvider, role: "snapshot" },
  ]);
  assert.equal(exactNpmIdentity.links.length, 0);

  assert.throws(
    () =>
      buildArchitectureFederation([
        { graph: app, role: "active" },
        { graph: core, role: "active" },
      ]),
    /exactly one active repository/,
  );

  assert.throws(
    () =>
      buildArchitectureFederation([
        { graph: app, role: "active" },
        {
          graph: {
            ...core,
            integrity: { ...app.integrity!, status: "fallback" },
          },
          role: "snapshot",
        },
      ]),
    /quarantined/,
  );
});
