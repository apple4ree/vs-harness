import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  FederationApproval,
  FederationApprovalHistoryEntry,
} from "../../shared/federation";

const UUID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const MAX_APPROVALS = 1_000;
const MAX_REVOCATIONS = 1_000;

type ApprovalRevocation = {
  contract: "witch.federation-approval-revocation/v1";
  id: string;
  decision: "revoke-provider-approval";
  approvalId: string;
  questionId: string;
  subjectWorkspaceRoot: string;
  subjectSourceRevision: string;
  ecosystem: FederationApproval["ecosystem"];
  packageName: string;
  revokedAt: string;
};

type ApprovalStoreDocument = {
  contract: "witch.federation-approval-store/v1";
  approvals: FederationApproval[];
  revocations: ApprovalRevocation[];
};

function validApproval(value: unknown): value is FederationApproval {
  const item = value as FederationApproval;
  return Boolean(
    item &&
    item.contract === "witch.federation-approval/v1" &&
    UUID.test(item.id) &&
    item.decision === "approve-provider" &&
    typeof item.questionId === "string" &&
    item.questionId.length > 0 &&
    typeof item.federationRevision === "string" &&
    item.federationRevision.length > 0 &&
    path.isAbsolute(item.subjectWorkspaceRoot) &&
    typeof item.subjectSourceRevision === "string" &&
    item.subjectSourceRevision.length > 0 &&
    path.isAbsolute(item.providerWorkspaceRoot) &&
    typeof item.providerSourceRevision === "string" &&
    item.providerSourceRevision.length > 0 &&
    ["npm", "python", "cargo"].includes(item.ecosystem) &&
    typeof item.packageName === "string" &&
    item.packageName.length > 0 &&
    item.packageName.length <= 200 &&
    typeof item.decidedAt === "string" &&
    Number.isFinite(Date.parse(item.decidedAt)) &&
    new Date(Date.parse(item.decidedAt)).toISOString() === item.decidedAt,
  );
}

function validRevocation(value: unknown): value is ApprovalRevocation {
  const item = value as ApprovalRevocation;
  return Boolean(
    item &&
    item.contract === "witch.federation-approval-revocation/v1" &&
    UUID.test(item.id) &&
    item.decision === "revoke-provider-approval" &&
    UUID.test(item.approvalId) &&
    typeof item.questionId === "string" &&
    item.questionId.length > 0 &&
    path.isAbsolute(item.subjectWorkspaceRoot) &&
    typeof item.subjectSourceRevision === "string" &&
    item.subjectSourceRevision.length > 0 &&
    ["npm", "python", "cargo"].includes(item.ecosystem) &&
    typeof item.packageName === "string" &&
    item.packageName.length > 0 &&
    item.packageName.length <= 200 &&
    typeof item.revokedAt === "string" &&
    Number.isFinite(Date.parse(item.revokedAt)) &&
    new Date(Date.parse(item.revokedAt)).toISOString() === item.revokedAt,
  );
}

function sameScope(
  approval: FederationApproval,
  revocation: ApprovalRevocation,
) {
  return (
    approval.questionId === revocation.questionId &&
    approval.subjectWorkspaceRoot === revocation.subjectWorkspaceRoot &&
    approval.subjectSourceRevision === revocation.subjectSourceRevision &&
    approval.ecosystem === revocation.ecosystem &&
    approval.packageName === revocation.packageName
  );
}

function revocationFor(
  approval: FederationApproval,
  revocations: ApprovalRevocation[],
) {
  return revocations
    .filter(
      (revocation) =>
        sameScope(approval, revocation) &&
        revocation.revokedAt >= approval.decidedAt,
    )
    .sort(
      (left, right) =>
        right.revokedAt.localeCompare(left.revokedAt) ||
        right.id.localeCompare(left.id),
    )[0];
}

function newestEventTime(document: ApprovalStoreDocument) {
  return Math.max(
    ...document.approvals.map((item) => Date.parse(item.decidedAt)),
    ...document.revocations.map((item) => Date.parse(item.revokedAt)),
    0,
  );
}

export class FederationApprovalStore {
  private writes: Promise<unknown> = Promise.resolve();

  constructor(private target: string) {
    if (!path.isAbsolute(target))
      throw new Error("Federation approval storage must use an absolute path");
  }

  private async read(): Promise<ApprovalStoreDocument> {
    try {
      const stat = await fs.stat(this.target);
      if (!stat.isFile() || stat.size > 5_000_000)
        throw new Error("Federation approval store is invalid or too large");
      const value = JSON.parse(
        await fs.readFile(this.target, "utf8"),
      ) as Partial<ApprovalStoreDocument>;
      const revocations = value.revocations ?? [];
      if (
        value.contract !== "witch.federation-approval-store/v1" ||
        !Array.isArray(value.approvals) ||
        !Array.isArray(revocations) ||
        value.approvals.length > MAX_APPROVALS ||
        revocations.length > MAX_REVOCATIONS ||
        value.approvals.some((item) => !validApproval(item)) ||
        revocations.some((item) => !validRevocation(item)) ||
        new Set(value.approvals.map((item) => item.id)).size !==
          value.approvals.length ||
        new Set(revocations.map((item) => item.id)).size !==
          revocations.length ||
        revocations.some((item) => {
          const approval = value.approvals!.find(
            (candidate) => candidate.id === item.approvalId,
          );
          return (
            !approval ||
            !sameScope(approval, item) ||
            item.revokedAt < approval.decidedAt
          );
        })
      )
        throw new Error("Federation approval store has an invalid contract");
      return {
        contract: "witch.federation-approval-store/v1",
        approvals: value.approvals,
        revocations,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return {
          contract: "witch.federation-approval-store/v1",
          approvals: [],
          revocations: [],
        };
      throw new Error(
        `Federation approvals could not be loaded; the original file was preserved. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async atomicWrite(value: ApprovalStoreDocument) {
    await fs.mkdir(path.dirname(this.target), { recursive: true });
    const temporary = `${this.target}.${randomUUID()}.tmp`;
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      try {
        await handle.writeFile(JSON.stringify(value) + "\n", "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.target);
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  async list() {
    await this.writes.catch(() => undefined);
    const value = await this.read();
    return structuredClone(
      value.approvals
        .filter((approval) => !revocationFor(approval, value.revocations))
        .sort(
          (left, right) =>
            right.decidedAt.localeCompare(left.decidedAt) ||
            right.id.localeCompare(left.id),
        ),
    );
  }

  async history(): Promise<FederationApprovalHistoryEntry[]> {
    await this.writes.catch(() => undefined);
    const value = await this.read();
    return structuredClone(
      value.approvals
        .map((approval) => {
          const revocation = revocationFor(approval, value.revocations);
          return {
            approval,
            status: revocation ? ("revoked" as const) : ("active" as const),
            ...(revocation ? { revokedAt: revocation.revokedAt } : {}),
          };
        })
        .sort(
          (left, right) =>
            right.approval.decidedAt.localeCompare(left.approval.decidedAt) ||
            right.approval.id.localeCompare(left.approval.id),
        ),
    );
  }

  async approve(
    input: Omit<
      FederationApproval,
      "contract" | "id" | "decision" | "decidedAt"
    >,
  ) {
    const operation = this.writes
      .catch(() => undefined)
      .then(async () => {
        const document = await this.read();
        const approval: FederationApproval = {
          contract: "witch.federation-approval/v1",
          id: randomUUID(),
          decision: "approve-provider",
          ...input,
          decidedAt: new Date(
            Math.max(Date.now(), newestEventTime(document) + 1),
          ).toISOString(),
        };
        if (!validApproval(approval))
          throw new Error("Federation approval is invalid");
        document.approvals.unshift(approval);
        document.approvals = document.approvals.slice(0, MAX_APPROVALS);
        const retained = new Set(document.approvals.map((item) => item.id));
        document.revocations = document.revocations.filter((item) =>
          retained.has(item.approvalId),
        );
        await this.atomicWrite(document);
        return structuredClone(approval);
      });
    this.writes = operation;
    return operation;
  }

  async revoke(approvalId: string) {
    if (!UUID.test(approvalId))
      throw new Error("Federation approval id is invalid");
    const operation = this.writes
      .catch(() => undefined)
      .then(async () => {
        const document = await this.read();
        const approval = document.approvals.find(
          (candidate) => candidate.id === approvalId,
        );
        if (!approval) throw new Error("Federation approval was not found");
        if (revocationFor(approval, document.revocations))
          throw new Error("Federation approval is already revoked");
        const revocation: ApprovalRevocation = {
          contract: "witch.federation-approval-revocation/v1",
          id: randomUUID(),
          decision: "revoke-provider-approval",
          approvalId,
          questionId: approval.questionId,
          subjectWorkspaceRoot: approval.subjectWorkspaceRoot,
          subjectSourceRevision: approval.subjectSourceRevision,
          ecosystem: approval.ecosystem,
          packageName: approval.packageName,
          revokedAt: new Date(
            Math.max(Date.now(), newestEventTime(document) + 1),
          ).toISOString(),
        };
        document.revocations.unshift(revocation);
        document.revocations = document.revocations.slice(0, MAX_REVOCATIONS);
        await this.atomicWrite(document);
        return structuredClone(revocation);
      });
    this.writes = operation;
    return operation;
  }

  async flush() {
    await this.writes;
  }
}
