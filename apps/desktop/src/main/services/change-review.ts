import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  listWorkspace,
  resolveWorkspacePath,
  contentHash,
  assertMutablePath,
  TEXT_LIMIT,
  decodeWorkspaceText,
} from "./workspace-files";
import type { ProposedChange } from "../../shared/agent";
import { readBoundedFile } from "./bounded-file";

/** Best-effort known credential names; arbitrary source code can still contain secrets. */
export function isPrivateAgentFile(relative: string) {
  return (
    /(^|\/)(\.env(?:\..*)?|id_rsa|id_ed25519|\.npmrc|\.pypirc|\.netrc|_netrc|\.git-credentials|credentials\.json|auth\.json)$|\.(?:pem|p12|pfx|key|keystore)$/i.test(
      relative,
    ) || /(^|\/)(\.ssh|\.aws|\.azure|\.gnupg|\.kube)(\/|$)/i.test(relative)
  );
}

export type WorkspaceCopy = {
  root: string;
  baseline: Record<string, string>;
  baselineRoot: string;
  warnings: string[];
};

export async function createWorkspaceCopy(
  source: string,
  runDirectory: string,
  signal?: AbortSignal,
): Promise<WorkspaceCopy> {
  const listing = await listWorkspace(source);
  signal?.throwIfAborted();
  if (listing.truncated)
    throw new Error(
      "Workspace exceeds the isolation file limit; narrow the opened folder",
    );
  const root = path.join(runDirectory, "workspace");
  const baselineRoot = path.join(runDirectory, "baseline");
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(baselineRoot, { recursive: true });
  const baseline: Record<string, string> = Object.create(null);
  const warnings = [...listing.warnings];
  let total = 0;
  for (const entry of listing.entries) {
    signal?.throwIfAborted();
    if (entry.kind !== "file") continue;
    if (isPrivateAgentFile(entry.path)) {
      warnings.push(`Private file excluded: ${entry.path}`);
      continue;
    }
    if (total + entry.size > 250_000_000)
      throw new Error(
        "Workspace copy exceeds 250 MB; narrow the opened folder",
      );
    const input = await resolveWorkspacePath(source, entry.path);
    const output = await resolveWorkspacePath(root, entry.path, true);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const bytes = await readBoundedFile(input, 250_000_000 - total);
    total += bytes.length;
    if (total > 250_000_000) throw new Error("Workspace copy exceeds 250 MB");
    const mode = (await fs.stat(input)).mode;
    await fs.writeFile(output, bytes, { flag: "wx", mode });
    const baselineFile = await resolveWorkspacePath(
      baselineRoot,
      entry.path,
      true,
    );
    await fs.mkdir(path.dirname(baselineFile), { recursive: true });
    await fs.writeFile(baselineFile, bytes, { flag: "wx", mode });
    baseline[entry.path] = contentHash(bytes);
  }
  // The baseline is outside the writable agent root.
  await fs.writeFile(
    path.join(runDirectory, "baseline.json"),
    JSON.stringify(baseline, null, 2),
  );
  return { root, baseline, baselineRoot, warnings };
}

export async function collectChanges(
  source: string,
  copy: WorkspaceCopy,
): Promise<ProposedChange[]> {
  const listing = await listWorkspace(copy.root, 20_000, false);
  if (listing.truncated)
    throw new Error("Agent output exceeds the review file limit");
  const paths = new Set([
    ...Object.keys(copy.baseline),
    ...listing.entries
      .filter((entry) => entry.kind === "file")
      .map((entry) => entry.path),
  ]);
  const changes: ProposedChange[] = [];
  let reviewBytes = 0;
  let scannedBytes = 0;
  for (const relative of paths) {
    assertMutablePath(relative);
    const staged = await resolveWorkspacePath(copy.root, relative, true);
    const afterBytes = await readBoundedFile(
      staged,
      250_000_000 - scannedBytes,
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    scannedBytes += afterBytes?.length || 0;
    const beforeHash = copy.baseline[relative] || null;
    const afterHash = afterBytes ? contentHash(afterBytes) : null;
    if (beforeHash === afterHash) continue;
    const original = await resolveWorkspacePath(
      copy.baselineRoot,
      relative,
      true,
    );
    const beforeBytes = beforeHash
      ? await readBoundedFile(original, TEXT_LIMIT).catch(
          (error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return null;
            throw error;
          },
        )
      : null;
    if (beforeHash && (!beforeBytes || contentHash(beforeBytes) !== beforeHash))
      throw new Error(
        `Baseline integrity check failed: ${relative}. The isolated work has been retained.`,
      );
    if (
      [beforeBytes, afterBytes].some(
        (bytes) => bytes && (bytes.length > TEXT_LIMIT || bytes.includes(0)),
      )
    )
      throw new Error(
        `Cannot review a binary or oversized agent change: ${relative}`,
      );
    reviewBytes += (beforeBytes?.length || 0) + (afterBytes?.length || 0);
    if (changes.length >= 200 || reviewBytes > 12_000_000)
      throw new Error(
        "Review exceeds 200 files or 12 MB. The isolated workspace is retained for manual review.",
      );
    changes.push({
      path: relative,
      before: beforeBytes ? decodeWorkspaceText(beforeBytes) : null,
      after: afterBytes ? decodeWorkspaceText(afterBytes) : null,
      beforeHash,
      afterHash,
    });
  }
  return changes;
}

/** Preflight every file, keep a recovery journal, and roll back completed writes on failure. */
export async function applyReviewedChanges(
  root: string,
  changes: ProposedChange[],
  recoveryDirectory: string,
) {
  if (!changes.length) throw new Error("Select at least one change");
  if (new Set(changes.map((change) => change.path)).size !== changes.length)
    throw new Error("Duplicate change paths");
  const modes = new Map<string, number>();
  for (const change of changes) {
    assertMutablePath(change.path);
    const target = await resolveWorkspacePath(root, change.path, true);
    const bytes = await readBoundedFile(target, TEXT_LIMIT).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      },
    );
    if ((bytes ? contentHash(bytes) : null) !== change.beforeHash)
      throw new Error(
        `Conflict: ${change.path} changed since the preview. Nothing was applied.`,
      );
    if (
      (change.after !== null &&
        contentHash(change.after) !== change.afterHash) ||
      (change.before !== null &&
        contentHash(change.before) !== change.beforeHash)
    )
      throw new Error("Review contents failed integrity validation");
    if (bytes) modes.set(change.path, (await fs.stat(target)).mode);
  }
  await fs.mkdir(recoveryDirectory, { recursive: true });
  await fs.writeFile(
    path.join(recoveryDirectory, "recovery.json"),
    JSON.stringify({ root, status: "applying", changes }, null, 2),
  );
  const applied: ProposedChange[] = [];
  try {
    for (const change of changes) {
      const target = await resolveWorkspacePath(root, change.path, true);
      const current = await readBoundedFile(target, TEXT_LIMIT).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return null;
          throw error;
        },
      );
      if ((current ? contentHash(current) : null) !== change.beforeHash)
        throw new Error(`Conflict during apply: ${change.path}`);
      if (change.after === null) await fs.unlink(target);
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        const temporary = path.join(
          path.dirname(target),
          `.witch-${randomUUID()}.tmp`,
        );
        await fs.writeFile(temporary, change.after, {
          encoding: "utf8",
          flag: "wx",
          mode: modes.get(change.path),
        });
        try {
          await fs.rename(temporary, target);
        } catch (error) {
          await fs.unlink(temporary).catch(() => undefined);
          throw error;
        }
      }
      applied.push(change);
    }
  } catch (error) {
    const recoveryErrors: string[] = [];
    for (const change of applied.reverse()) {
      try {
        const target = await resolveWorkspacePath(root, change.path, true);
        const current = await readBoundedFile(target, TEXT_LIMIT).catch(
          (reason: NodeJS.ErrnoException) => {
            if (reason.code === "ENOENT") return null;
            throw reason;
          },
        );
        if ((current ? contentHash(current) : null) !== change.afterHash)
          throw new Error(
            "File changed again after apply; automatic rollback would overwrite another edit",
          );
        if (change.before === null) await fs.unlink(target);
        else
          await fs.writeFile(target, change.before, {
            encoding: "utf8",
            mode: modes.get(change.path),
          });
      } catch (recoveryError) {
        recoveryErrors.push(`${change.path}: ${recoveryError}`);
      }
    }
    await fs.writeFile(
      path.join(recoveryDirectory, "result.json"),
      JSON.stringify({
        status: recoveryErrors.length ? "recovery-required" : "rolled-back",
        error: String(error),
        recoveryErrors,
      }),
    );
    throw new Error(
      `${error instanceof Error ? error.message : error}${recoveryErrors.length ? `; recovery needed in ${recoveryDirectory}` : "; previous writes were rolled back"}`,
    );
  }
  await fs.writeFile(
    path.join(recoveryDirectory, "result.json"),
    JSON.stringify({
      status: "applied",
      paths: changes.map((change) => change.path),
    }),
  );
  return changes.map((change) => change.path);
}
