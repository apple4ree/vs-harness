import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProposedChange } from "../../shared/agent";
import type { WorkspaceCopy } from "./change-review";
import { assertMutablePath, contentHash } from "./workspace-files";

const CHECKPOINT_ID =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export type CheckpointArtifact = {
  checkpointId: string;
  parentId?: string;
  label: string;
  manifestHash: string;
  changedPaths: string[];
  totalBytes: number;
};

type CheckpointManifest = {
  contract: "witch.checkpoint/v1";
  schemaVersion: 1;
  checkpointId: string;
  parentId?: string;
  kind: "baseline" | "review";
  label: string;
  createdAt: string;
  entries: Array<{
    path: string;
    beforeHash: string | null;
    afterHash: string | null;
    size: number;
  }>;
  changesHash?: string;
  totalBytes: number;
};

async function atomicWrite(target: string, contents: string) {
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await fs.open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.unlink(temporary).catch(() => undefined);
    throw error;
  }
}

async function persistCheckpoint(
  runDirectory: string,
  manifest: CheckpointManifest,
  changes?: readonly ProposedChange[],
): Promise<CheckpointArtifact> {
  const directory = path.join(
    runDirectory,
    "checkpoints",
    manifest.checkpointId,
  );
  await fs.mkdir(directory, { recursive: true });
  if (changes) {
    const contents = `${JSON.stringify({
      contract: "witch.checkpoint-changes/v1",
      schemaVersion: 1,
      checkpointId: manifest.checkpointId,
      changes,
    })}\n`;
    if (Buffer.byteLength(contents, "utf8") > 24_000_000)
      throw new Error("Checkpoint review payload exceeds 24 MB");
    await atomicWrite(path.join(directory, "changes.json"), contents);
  }
  const manifestHash = contentHash(JSON.stringify(manifest));
  await atomicWrite(
    path.join(directory, "manifest.json"),
    `${JSON.stringify({ ...manifest, manifestHash }, null, 2)}\n`,
  );
  return {
    checkpointId: manifest.checkpointId,
    ...(manifest.parentId ? { parentId: manifest.parentId } : {}),
    label: manifest.label,
    manifestHash,
    changedPaths: manifest.entries
      .filter((entry) => entry.beforeHash !== entry.afterHash)
      .map((entry) => entry.path)
      .sort(),
    totalBytes: manifest.totalBytes,
  };
}

export async function createBaselineCheckpoint(
  runDirectory: string,
  copy: WorkspaceCopy,
) {
  const checkpointId = randomUUID();
  const entries: CheckpointManifest["entries"] = [];
  let totalBytes = 0;
  for (const [relative, hash] of Object.entries(copy.baseline).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    const stat = await fs.stat(
      path.join(copy.baselineRoot, ...relative.split("/")),
    );
    totalBytes += stat.size;
    entries.push({
      path: relative,
      beforeHash: hash,
      afterHash: hash,
      size: stat.size,
    });
  }
  return persistCheckpoint(runDirectory, {
    contract: "witch.checkpoint/v1",
    schemaVersion: 1,
    checkpointId,
    kind: "baseline",
    label: "Immutable source baseline",
    createdAt: new Date().toISOString(),
    entries,
    totalBytes,
  });
}

export async function createReviewCheckpoint(
  runDirectory: string,
  parentId: string | undefined,
  changes: readonly ProposedChange[],
  label = "Stopped isolated review",
) {
  const checkpointId = randomUUID();
  const totalBytes = changes.reduce(
    (sum, change) =>
      sum +
      Buffer.byteLength(change.before || "", "utf8") +
      Buffer.byteLength(change.after || "", "utf8"),
    0,
  );
  const changesHash = contentHash(JSON.stringify(changes));
  return persistCheckpoint(
    runDirectory,
    {
      contract: "witch.checkpoint/v1",
      schemaVersion: 1,
      checkpointId,
      ...(parentId ? { parentId } : {}),
      kind: "review",
      label: label.slice(0, 1_000),
      createdAt: new Date().toISOString(),
      entries: changes
        .map((change) => ({
          path: change.path,
          beforeHash: change.beforeHash,
          afterHash: change.afterHash,
          size:
            Buffer.byteLength(change.before || "", "utf8") +
            Buffer.byteLength(change.after || "", "utf8"),
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
      changesHash,
      totalBytes,
    },
    changes,
  );
}

export async function readReviewCheckpoint(
  runDirectory: string,
  checkpointId: string,
) {
  if (!CHECKPOINT_ID.test(checkpointId))
    throw new Error("Invalid checkpoint id");
  const directory = path.join(runDirectory, "checkpoints", checkpointId);
  const manifestPath = path.join(directory, "manifest.json");
  const changesPath = path.join(directory, "changes.json");
  const [manifestStat, changesStat] = await Promise.all([
    fs.lstat(manifestPath),
    fs.lstat(changesPath),
  ]);
  if (
    manifestStat.isSymbolicLink() ||
    !manifestStat.isFile() ||
    manifestStat.size > 8_000_000
  )
    throw new Error("Checkpoint manifest exceeds its safety bound");
  if (
    changesStat.isSymbolicLink() ||
    !changesStat.isFile() ||
    changesStat.size > 24_000_000
  )
    throw new Error("Checkpoint changes exceed their safety bound");
  const storedManifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const { manifestHash, ...manifest } = storedManifest || {};
  if (
    manifest.contract !== "witch.checkpoint/v1" ||
    manifest.schemaVersion !== 1 ||
    manifest.kind !== "review" ||
    manifest.checkpointId !== checkpointId ||
    typeof manifestHash !== "string" ||
    contentHash(JSON.stringify(manifest)) !== manifestHash
  )
    throw new Error("Checkpoint manifest failed integrity validation");
  const storedChanges = JSON.parse(await fs.readFile(changesPath, "utf8"));
  if (
    storedChanges?.contract !== "witch.checkpoint-changes/v1" ||
    storedChanges.schemaVersion !== 1 ||
    storedChanges.checkpointId !== checkpointId ||
    !Array.isArray(storedChanges.changes) ||
    storedChanges.changes.length > 200 ||
    contentHash(JSON.stringify(storedChanges.changes)) !== manifest.changesHash
  )
    throw new Error("Checkpoint changes failed integrity validation");
  for (const change of storedChanges.changes) {
    if (
      !change ||
      typeof change.path !== "string" ||
      (change.before !== null && typeof change.before !== "string") ||
      (change.after !== null && typeof change.after !== "string") ||
      (change.before !== null &&
        contentHash(change.before) !== change.beforeHash) ||
      (change.after !== null && contentHash(change.after) !== change.afterHash)
    )
      throw new Error("Checkpoint change contents failed integrity validation");
    assertMutablePath(change.path);
  }
  return storedChanges.changes as ProposedChange[];
}
