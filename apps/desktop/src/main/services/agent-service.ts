import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  workspaceCopyBackend,
  type WorkspaceIsolationBackend,
  type WorkspaceCopy,
} from "./change-review";
import type {
  ArchitectureGraph,
  ComponentContext,
} from "../../shared/architecture";
import { componentContext } from "../../shared/architecture";
import type {
  AgentHostStatus,
  AgentProviderId,
  AgentRequest,
  AgentRun,
} from "../../shared/agent";
import {
  AgentProviderShutdownError,
  type AgentProviderAdapter,
  type AgentProviderEvent,
} from "./agent-provider";
import { CodexAgentAdapter } from "./codex-agent-adapter";
import {
  assertMutablePath,
  contentHash,
  resolveWorkspacePath,
} from "./workspace-files";
import { EngineeringRunJournal } from "./engineering-run-journal";
import {
  createBaselineCheckpoint,
  createReviewCheckpoint,
  type CheckpointArtifact,
} from "./engineering-run-artifacts";
import {
  createHarnessPlan,
  evaluateHarnessPlan,
  failedVerificationReceipts,
  verificationFailureFingerprint,
  verifyIsolatedReview,
} from "./engineering-verification";
import {
  defaultRunBudget,
  type AnalysisUpdateReceipt,
  type EngineeringRunProjection,
  type HarnessEventPayloads,
  type HarnessEventType,
  type HarnessRunState,
} from "../../shared/engineering-run";
import {
  hashHarnessPayload,
  projectLegacyAgentRun,
} from "../../shared/engineering-run-reducer";

export type AgentHostOptions = {
  dataDirectory: string;
  command?: () => string | null;
  version?: string;
  shell?: boolean;
  serverArguments?: string[];
  providers?: AgentProviderAdapter[];
  defaultProviderId?: AgentProviderId;
  onApplied?: (
    root: string,
    paths: string[],
    sourceRevision: string,
  ) => Promise<AnalysisUpdateReceipt>;
  isolationBackend?: WorkspaceIsolationBackend;
};

type AgentContinuation = {
  action: "resume" | "fork";
  parentRunId: string;
  sourceRevision: string;
  nativeSession?: AgentRun["nativeSession"];
};

export class AgentHost extends EventEmitter {
  private runs: AgentRun[] = [];
  private loaded = false;
  private loading: Promise<void> | null = null;
  private active: {
    run: AgentRun;
    provider: AgentProviderAdapter;
    copy?: WorkspaceCopy;
    canceled: boolean;
    controller: AbortController;
    openTools: Set<string>;
    baselineCheckpointId?: string;
    responsePrefix?: string;
    continuation?: AgentContinuation;
    completion?: Promise<void>;
  } | null = null;
  private writes: Promise<void> = Promise.resolve();
  private readonly providers: Map<AgentProviderId, AgentProviderAdapter>;
  private readonly defaultProviderId: AgentProviderId;
  private readonly engineeringRuns: EngineeringRunJournal;
  private readonly isolation: WorkspaceIsolationBackend;
  private readonly engineeringFailures = new Map<string, Error>();
  private maintenance = false;

  constructor(private options: AgentHostOptions) {
    super();
    const configured = options.providers || [
      new CodexAgentAdapter({
        command: options.command || (() => null),
        version: options.version || "unknown",
        serverArguments: options.serverArguments,
      }),
    ];
    this.providers = new Map(
      configured.map((provider) => [provider.id, provider]),
    );
    if (this.providers.size !== configured.length)
      throw new Error("Agent Provider IDs must be unique");
    this.defaultProviderId =
      options.defaultProviderId || configured[0]?.id || "codex";
    if (!this.providers.has(this.defaultProviderId))
      throw new Error("The default Agent Provider is not registered");
    this.engineeringRuns = new EngineeringRunJournal(
      path.join(path.dirname(options.dataDirectory), "engineering-runs"),
    );
    this.isolation = options.isolationBackend || workspaceCopyBackend;
  }
  isRunning() {
    return Boolean(this.active) || this.maintenance;
  }
  isConnected() {
    return Boolean(this.active?.provider.isConnected());
  }
  isProviderRunning(providerId: AgentProviderId) {
    return this.active?.provider.id === providerId;
  }
  isProviderConnected(providerId: AgentProviderId) {
    return Boolean(
      this.active?.provider.id === providerId &&
      this.active.provider.isConnected(),
    );
  }
  status(): AgentHostStatus {
    return {
      defaultProviderId: this.defaultProviderId,
      ...(this.active ? { activeProviderId: this.active.provider.id } : {}),
      providers: [...this.providers.values()].map((provider) =>
        provider.descriptor(),
      ),
    };
  }
  private async load() {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = this.loadHistory();
    try {
      await this.loading;
      this.loaded = true;
    } finally {
      this.loading = null;
    }
  }
  private async loadHistory() {
    const target = path.join(this.options.dataDirectory, "history.json");
    try {
      if ((await fs.stat(target)).size > 150_000_000)
        throw new Error("History exceeds 150 MB");
      const value = JSON.parse(await fs.readFile(target, "utf8"));
      if (
        !Array.isArray(value) ||
        value.some(
          (run) =>
            !run ||
            !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
              run.id,
            ) ||
            typeof run.workspaceRoot !== "string" ||
            !path.isAbsolute(run.workspaceRoot) ||
            typeof run.workspaceName !== "string" ||
            typeof run.prompt !== "string" ||
            typeof run.response !== "string" ||
            (run.providerId !== undefined &&
              !["codex", "claude"].includes(run.providerId)) ||
            (run.providerLabel !== undefined &&
              typeof run.providerLabel !== "string") ||
            (run.nativeSession !== undefined &&
              (!run.nativeSession ||
                !["codex", "claude"].includes(run.nativeSession.providerId) ||
                typeof run.nativeSession.sessionId !== "string" ||
                (run.nativeSession.turnId !== undefined &&
                  typeof run.nativeSession.turnId !== "string"))) ||
            !["ask", "change"].includes(run.mode) ||
            ![
              "preparing",
              "running",
              "review",
              "completed",
              "interrupted",
              "failed",
              "applied",
              "archived",
            ].includes(run.status) ||
            !Array.isArray(run.contexts) ||
            !Array.isArray(run.activity) ||
            !Array.isArray(run.changes) ||
            !Number.isFinite(Date.parse(run.createdAt)),
        )
      )
        throw new Error("Invalid agent history format");
      const interrupted = new Set<string>(
        value
          .filter((stored) => ["running", "preparing"].includes(stored.status))
          .map((stored) => stored.id),
      );
      this.runs = value.map((stored): AgentRun => {
        const { engineering: _storedEngineering, ...legacy } = stored;
        const providerId: AgentProviderId = stored.providerId || "codex";
        const run: AgentRun = {
          ...legacy,
          providerId,
          providerLabel:
            stored.providerLabel ||
            this.providers.get(providerId)?.descriptor().label ||
            "Codex",
        };
        return ["running", "preparing"].includes(run.status)
          ? {
              ...run,
              status: "interrupted",
              error: "Witch closed before this run finished",
            }
          : run;
      });
      for (const run of this.runs) {
        try {
          let projection = await this.engineeringRuns.read(run.id);
          if (!projection) continue;
          if (
            interrupted.has(run.id) &&
            ![
              "completed",
              "applied",
              "archived",
              "failed",
              "interrupted",
            ].includes(projection.state)
          )
            projection = await this.transitionEngineeringRun(
              run,
              projection,
              "interrupted",
              "Witch closed before this run finished",
            );
          this.updateEngineeringSummary(run, projection);
        } catch (error) {
          this.markEngineeringFailure(run, error);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") this.runs = [];
      else
        throw new Error(
          `Agent history could not be loaded. The original file is retained at ${target}. ${error}`,
        );
    }
  }
  private async persist() {
    const contents = JSON.stringify(this.runs.slice(0, 100), null, 2);
    this.writes = this.writes
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.options.dataDirectory, { recursive: true });
        const target = path.join(this.options.dataDirectory, "history.json");
        const temporary = target + ".tmp";
        await fs.writeFile(temporary, contents, "utf8");
        await fs.rename(temporary, target);
      });
    await this.writes;
  }
  private async appendEngineeringEvent<T extends HarnessEventType>(
    run: AgentRun,
    type: T,
    payload: HarnessEventPayloads[T],
    timestamp?: string,
  ) {
    const projection = await this.engineeringRuns.append(
      run.id,
      type,
      payload,
      timestamp,
    );
    this.updateEngineeringSummary(run, projection);
    return projection;
  }
  private updateEngineeringSummary(
    run: AgentRun,
    projection: EngineeringRunProjection,
  ) {
    const analysis = projection.analysisUpdates.at(-1);
    const latestVerification = new Map(
      projection.verification.map((receipt) => [receipt.intentId, receipt]),
    );
    const planEvaluation = projection.planEvaluations.at(-1);
    run.engineering = {
      contract: projection.contract,
      state: projection.state,
      eventCount: projection.eventCount,
      lastSequence: projection.lastSequence,
      eventDigest: projection.eventDigest,
      checkpointCount: projection.checkpointIds.length,
      verificationPassed: [...latestVerification.values()].filter(
        (receipt) => receipt.status === "passed",
      ).length,
      verificationFailed: [...latestVerification.values()].filter(
        (receipt) => receipt.status === "failed",
      ).length,
      repairAttempts: projection.usage.repairAttempts,
      planUnexpectedFiles: planEvaluation?.unexpectedFiles.length || 0,
      ...(projection.repairStopReason
        ? { repairStopReason: projection.repairStopReason }
        : {}),
      ...(analysis
        ? {
            analysisStatus: analysis.status,
            ...(analysis.changedNodes !== undefined
              ? { analysisChangedNodes: analysis.changedNodes }
              : {}),
            ...(analysis.changedRelations !== undefined
              ? { analysisChangedRelations: analysis.changedRelations }
              : {}),
          }
        : {}),
      healthy: true,
    };
  }
  private recordEngineeringEvent<T extends HarnessEventType>(
    run: AgentRun,
    type: T,
    payload: HarnessEventPayloads[T],
    timestamp?: string,
  ) {
    if (this.engineeringFailures.has(run.id)) return;
    void this.appendEngineeringEvent(run, type, payload, timestamp).catch(
      (error) => this.markEngineeringFailure(run, error),
    );
  }
  private markEngineeringFailure(run: AgentRun, value: unknown) {
    if (this.engineeringFailures.has(run.id)) return;
    const error = value instanceof Error ? value : new Error(String(value));
    this.engineeringFailures.set(run.id, error);
    run.engineering = {
      contract: "witch.engineering-run/v1",
      state: run.engineering?.state || "attention-required",
      eventCount: run.engineering?.eventCount || 0,
      lastSequence: run.engineering?.lastSequence || 0,
      eventDigest: run.engineering?.eventDigest || "",
      checkpointCount: run.engineering?.checkpointCount || 0,
      verificationPassed: run.engineering?.verificationPassed || 0,
      verificationFailed: run.engineering?.verificationFailed || 0,
      repairAttempts: run.engineering?.repairAttempts || 0,
      planUnexpectedFiles: run.engineering?.planUnexpectedFiles || 0,
      ...(run.engineering?.repairStopReason
        ? { repairStopReason: run.engineering.repairStopReason }
        : {}),
      ...(run.engineering?.analysisStatus
        ? { analysisStatus: run.engineering.analysisStatus }
        : {}),
      ...(run.engineering?.analysisChangedNodes !== undefined
        ? { analysisChangedNodes: run.engineering.analysisChangedNodes }
        : {}),
      ...(run.engineering?.analysisChangedRelations !== undefined
        ? {
            analysisChangedRelations: run.engineering.analysisChangedRelations,
          }
        : {}),
      healthy: false,
      error: error.message,
    };
    run.error = `${run.error ? `${run.error} ` : ""}Engineering journal failed; applying changes is blocked. ${error.message}`;
    this.publish(run);
  }
  private async initializeEngineeringRun(
    run: AgentRun,
    sourceRevision: string,
  ) {
    let projection = await this.appendEngineeringEvent(run, "run.created", {
      contract: "witch.engineering-run/v1",
      schemaVersion: 1,
      runId: run.id,
      ...(run.parentRunId ? { parentRunId: run.parentRunId } : {}),
      workspaceRoot: run.workspaceRoot,
      workspaceName: run.workspaceName,
      sourceRevision,
      providerId: run.providerId,
      providerLabel: run.providerLabel,
      mode: run.mode,
      goal: run.prompt,
      createdAt: run.createdAt,
      budget: defaultRunBudget(run.mode),
    });
    projection = await this.transitionEngineeringRun(
      run,
      projection,
      "context-planning",
      "Selecting user-authored and graph-derived context",
      run.createdAt,
    );
    for (const [priority, context] of run.contexts.entries())
      projection = await this.appendEngineeringEvent(
        run,
        "context.selected",
        {
          subjectId: context.nodeId,
          reason: "user-selected",
          evidenceIds: context.paths,
          priority: 1_000 - priority,
        },
        run.createdAt,
      );
    return projection;
  }
  private async transitionEngineeringRun(
    run: AgentRun,
    projection: EngineeringRunProjection,
    to: HarnessRunState,
    reason?: string,
    timestamp?: string,
  ) {
    if (projection.state === to) return projection;
    return this.appendEngineeringEvent(
      run,
      "state.changed",
      {
        from: projection.state,
        to,
        ...(reason ? { reason } : {}),
      },
      timestamp,
    );
  }
  private async ensureEngineeringRun(run: AgentRun) {
    const failure = this.engineeringFailures.get(run.id);
    if (failure)
      throw new Error(
        `Engineering Run journal is unhealthy; changes cannot be applied. ${failure.message}`,
      );
    let projection = await this.engineeringRuns.read(run.id);
    if (!projection) {
      const legacy = projectLegacyAgentRun(run);
      projection = await this.engineeringRuns.import(legacy.events);
    }
    if (!projection)
      throw new Error("Engineering Run journal could not be initialized");
    projection = await this.engineeringRuns.verify(run.id);
    this.updateEngineeringSummary(run, projection);
    return projection;
  }
  private async finalizeEngineeringRun(run: AgentRun) {
    await this.engineeringRuns.flush(run.id);
    const failure = this.engineeringFailures.get(run.id);
    if (failure) throw failure;
    let projection = await this.engineeringRuns.verify(run.id);
    const completedAt = run.completedAt || new Date().toISOString();
    if (run.status === "review") {
      const changedPaths = [
        ...new Set(run.changes.map((change) => change.path)),
      ].sort();
      if (changedPaths.length)
        projection = await this.appendEngineeringEvent(run, "file.changed", {
          paths: changedPaths,
        });
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "review-ready",
        "A review was built from the stopped isolated workspace",
      );
      await this.appendEngineeringEvent(run, "review.created", {
        reviewId: randomUUID(),
        changeSetIds: run.changes.map(
          (change, index) => `${index + 1}:${change.path}`,
        ),
        changedPaths,
      });
      return;
    }
    if (run.status === "completed") {
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "completed",
        undefined,
        completedAt,
      );
      await this.appendEngineeringEvent(
        run,
        "run.completed",
        { response: run.response, completedAt },
        completedAt,
      );
      return;
    }
    if (run.status === "failed") {
      const error = run.error || "Agent Provider run failed";
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "failed",
        error,
        completedAt,
      );
      await this.appendEngineeringEvent(
        run,
        "run.failed",
        { error, completedAt },
        completedAt,
      );
      return;
    }
    if (run.status === "interrupted")
      await this.transitionEngineeringRun(
        run,
        projection,
        "interrupted",
        run.error || "Agent run was interrupted",
        completedAt,
      );
  }
  private async recordCheckpoint(run: AgentRun, artifact: CheckpointArtifact) {
    return this.appendEngineeringEvent(run, "checkpoint.created", {
      checkpointId: artifact.checkpointId,
      ...(artifact.parentId ? { parentId: artifact.parentId } : {}),
      label: artifact.label,
      manifestHash: artifact.manifestHash,
      changedPaths: artifact.changedPaths,
      totalBytes: artifact.totalBytes,
    });
  }
  private async prepareEngineeringReview(
    active: NonNullable<AgentHost["active"]>,
    incomplete: boolean,
  ) {
    const run = active.run;
    if (run.status !== "review") return;
    const failure = this.engineeringFailures.get(run.id);
    if (failure) throw failure;
    let checkpoint = await this.checkpointEngineeringReview(
      active,
      active.baselineCheckpointId,
      "Provider review",
    );
    if (incomplete) return;
    let projection = await this.engineeringRuns.verify(run.id);
    projection = await this.transitionEngineeringRun(
      run,
      projection,
      "verifying",
      "Validating the stopped isolated workspace before review",
    );
    let receipts = await this.verifyEngineeringReview(run);
    const seenFingerprints = new Set<string>();
    let fingerprint = verificationFailureFingerprint(receipts, run.changes);
    while (failedVerificationReceipts(receipts).length) {
      if (seenFingerprints.has(fingerprint)) {
        await this.appendEngineeringEvent(run, "repair.stopped", {
          fingerprint,
          attempts: projection.usage.repairAttempts,
          reason: "same-fingerprint",
          stoppedAt: new Date().toISOString(),
        });
        this.activity(
          run,
          "Repair stopped because the same verification failure repeated.",
        );
        break;
      }
      if (
        projection.usage.repairAttempts >= projection.budget.maxRepairAttempts
      ) {
        await this.appendEngineeringEvent(run, "repair.stopped", {
          fingerprint,
          attempts: projection.usage.repairAttempts,
          reason: "budget-exhausted",
          stoppedAt: new Date().toISOString(),
        });
        this.activity(run, "Repair budget exhausted; review remains available.");
        break;
      }
      seenFingerprints.add(fingerprint);
      const repaired = await this.executeEngineeringRepair(
        active,
        projection.usage.repairAttempts + 1,
        fingerprint,
        receipts,
      );
      if (!repaired) break;
      checkpoint = await this.checkpointEngineeringReview(
        active,
        checkpoint.checkpointId,
        `Repair ${projection.usage.repairAttempts + 1}`,
      );
      projection = await this.engineeringRuns.verify(run.id);
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "verifying",
        "Re-validating the isolated workspace after a bounded repair",
      );
      receipts = await this.verifyEngineeringReview(run);
      const failures = failedVerificationReceipts(receipts);
      const completedAt = new Date().toISOString();
      await this.appendEngineeringEvent(
        run,
        "repair.completed",
        {
          receipt: {
            attempt: projection.usage.repairAttempts,
            fingerprint,
            failedIntentIds: failures.map((receipt) => receipt.intentId).sort(),
            status: failures.length ? "failed" : "passed",
            startedAt:
              projection.repairs.at(-1)?.startedAt || completedAt,
            completedAt,
            checkpointId: checkpoint.checkpointId,
          },
        },
        completedAt,
      );
      projection = await this.engineeringRuns.verify(run.id);
      fingerprint = verificationFailureFingerprint(receipts, run.changes);
    }
    run.status = "review";
  }

  private async checkpointEngineeringReview(
    active: NonNullable<AgentHost["active"]>,
    parentId: string | undefined,
    label: string,
  ) {
    const run = active.run;
    const checkpoint = await createReviewCheckpoint(
      path.join(this.options.dataDirectory, run.id),
      parentId,
      run.changes,
      label,
    );
    let projection = await this.recordCheckpoint(run, checkpoint);
    if (!projection.plan)
      throw new Error("Engineering review is missing its structured plan");
    projection = await this.appendEngineeringEvent(run, "plan.evaluated", {
      evaluation: evaluateHarnessPlan(projection.plan, run.changes),
    });
    const unexpected = projection.planEvaluations.at(-1)?.unexpectedFiles || [];
    if (unexpected.length)
      this.activity(
        run,
        `Plan scope diagnostic: ${unexpected.length} changed file(s) were outside the expected set.`,
      );
    return checkpoint;
  }

  private async verifyEngineeringReview(run: AgentRun) {
    const receipts = await verifyIsolatedReview(run.stagingRoot!, run.changes);
    for (const receipt of receipts)
      await this.appendEngineeringEvent(
        run,
        "verification.completed",
        { receipt },
        receipt.completedAt,
      );
    return receipts;
  }

  private async executeEngineeringRepair(
    active: NonNullable<AgentHost["active"]>,
    attempt: number,
    fingerprint: string,
    receipts: readonly import("../../shared/engineering-run").VerificationReceipt[],
  ) {
    const run = active.run;
    let projection = await this.engineeringRuns.verify(run.id);
    projection = await this.transitionEngineeringRun(
      run,
      projection,
      "repairing",
      `Preparing bounded repair attempt ${attempt}`,
    );
    const startedAt = new Date().toISOString();
    projection = await this.appendEngineeringEvent(
      run,
      "repair.started",
      {
        receipt: {
          attempt,
          fingerprint,
          failedIntentIds: failedVerificationReceipts(receipts)
            .map((receipt) => receipt.intentId)
            .sort(),
          status: "started",
          startedAt,
        },
      },
      startedAt,
    );
    projection = await this.transitionEngineeringRun(
      run,
      projection,
      "executing",
      `Running bounded repair attempt ${attempt}`,
    );
    run.status = "running";
    this.activity(run, `Repair attempt ${attempt} started.`);
    const previousResponse = run.response;
    active.responsePrefix = `${previousResponse}\n\nRepair attempt ${attempt}:\n`;
    run.response = active.responsePrefix;
    try {
      const result = await active.provider.execute(
        {
          cwd: run.stagingRoot!,
          mode: "change",
          prompt: [
            "Witch verification found failures in the isolated workspace.",
            "Repair only those failures. Do not broaden the task or touch the original workspace.",
            `Attempt: ${attempt}/${projection.budget.maxRepairAttempts}`,
            `Failure fingerprint: ${fingerprint}`,
            ...failedVerificationReceipts(receipts).map(
              (receipt) =>
                `- ${receipt.intentId}: ${(receipt.boundedOutput || receipt.status).slice(0, 4000)}`,
            ),
          ].join("\n"),
        },
        {
          onEvent: (event) => this.providerEvent(active, event),
          onSession: async (session) => {
            run.nativeSession = session;
            this.publish(run);
            await this.appendEngineeringEvent(run, "provider.session", {
              session,
            });
            await this.persist();
          },
        },
      );
      if (active.canceled || result.status === "interrupted") {
        const completedAt = new Date().toISOString();
        await this.appendEngineeringEvent(
          run,
          "repair.completed",
          {
            receipt: {
              attempt,
              fingerprint,
              failedIntentIds: failedVerificationReceipts(receipts)
                .map((receipt) => receipt.intentId)
                .sort(),
              status: "interrupted",
              startedAt,
              completedAt,
            },
          },
          completedAt,
        );
        await this.appendEngineeringEvent(run, "repair.stopped", {
          fingerprint,
          attempts: attempt,
          reason: "provider-interrupted",
          stoppedAt: completedAt,
        });
        run.error = `${run.error ? `${run.error} ` : ""}Repair attempt ${attempt} was interrupted.`;
        run.status = "review";
        return false;
      }
      run.changes = await this.isolation.collect(run.workspaceRoot, active.copy!);
      await this.closeEngineeringTools(active);
      run.status = "review";
      return true;
    } catch (error) {
      if (error instanceof AgentProviderShutdownError) {
        run.status = "failed";
        throw error;
      }
      run.status = "interrupted";
      await this.closeEngineeringTools(active).catch(() => undefined);
      const completedAt = new Date().toISOString();
      await this.appendEngineeringEvent(
        run,
        "repair.completed",
        {
          receipt: {
            attempt,
            fingerprint,
            failedIntentIds: failedVerificationReceipts(receipts)
              .map((receipt) => receipt.intentId)
              .sort(),
            status: "interrupted",
            startedAt,
            completedAt,
          },
        },
        completedAt,
      );
      await this.appendEngineeringEvent(run, "repair.stopped", {
        fingerprint,
        attempts: attempt,
        reason: "provider-interrupted",
        stoppedAt: completedAt,
      });
      run.error = `${run.error ? `${run.error} ` : ""}Repair attempt ${attempt} could not complete: ${error instanceof Error ? error.message : String(error)}`;
      run.status = "review";
      return false;
    } finally {
      active.responsePrefix = undefined;
    }
  }
  async list(root: string) {
    await this.load();
    return this.runs.filter((run) => run.workspaceRoot === root);
  }
  private publish(run: AgentRun) {
    this.emit("event", {
      run: {
        ...run,
        activity: [...run.activity],
        changes: [...run.changes],
        ...(run.engineering ? { engineering: { ...run.engineering } } : {}),
      },
    });
  }
  private activity(run: AgentRun, text: string) {
    run.activity.push(text.slice(0, 1000));
    run.activity = run.activity.slice(-80);
    this.publish(run);
  }
  private contexts(
    requested: ComponentContext[],
    graph: ArchitectureGraph,
  ): ComponentContext[] {
    if (!Array.isArray(requested) || requested.length > 12)
      throw new Error("Attach up to 12 components");
    return requested.map((context) => {
      if (!context || typeof context.nodeId !== "string")
        throw new Error("Invalid component context");
      if (context.revision !== graph.revision)
        throw new Error(
          "An attached component is from an older graph revision. Remove it and attach the current component.",
        );
      const nodes = context.nodeId.startsWith("module:")
        ? graph.nodes.filter((node) => node.module === context.nodeId.slice(7))
        : graph.nodes.filter((node) => node.id === context.nodeId);
      const semantic = graph.semantic?.nodes.find(
        (node) => node.id === context.nodeId,
      );
      if (
        semantic &&
        (graph.semantic?.validation.valid !== true ||
          graph.semantic.sourceRevision !== graph.revision)
      )
        throw new Error("The attached semantic context is not validated");
      const paths = semantic
        ? this.semanticPaths(graph, semantic.id)
        : nodes.flatMap((node) => (node.path ? [node.path] : []));
      if (!paths.length)
        throw new Error(
          "This component is not present in the current workspace graph",
        );
      return componentContext(
        context.nodeId,
        context.nodeId.startsWith("module:")
          ? context.nodeId.slice(7)
          : semantic?.label || nodes[0].label,
        paths,
        graph.revision,
        semantic?.evidence[0]?.line || context.line,
        semantic
          ? {
              kind: semantic.kind,
              trust: semantic.trust,
              status: semantic.status,
              confidence: semantic.confidence,
            }
          : undefined,
      );
    });
  }
  private semanticPaths(graph: ArchitectureGraph, semanticId: string) {
    const semantic = graph.semantic;
    if (!semantic) return [];
    const selected = semantic.nodes.find((node) => node.id === semanticId);
    if (!selected) return [];
    if (selected.kind === "system")
      return graph.nodes.flatMap((node) => (node.path ? [node.path] : []));
    if (selected.kind === "component")
      return graph.nodes
        .filter((node) => node.module === selected.label && node.path)
        .map((node) => node.path!);
    const ids = new Set([semanticId]);
    for (let depth = 0; depth < 3; depth++)
      for (const relation of semantic.relations)
        if (
          ids.has(relation.from) &&
          ["contains", "executes", "defines"].includes(relation.kind)
        )
          ids.add(relation.to);
    const sourceIds = new Set<string>();
    const paths = new Set<string>();
    for (const node of semantic.nodes)
      if (ids.has(node.id)) {
        if (node.sourceNodeId) sourceIds.add(node.sourceNodeId);
        if (node.path) paths.add(node.path);
        node.evidence.forEach((item) => paths.add(item.path));
      }
    for (const node of graph.nodes)
      if (sourceIds.has(node.id) && node.path) paths.add(node.path);
    const existing = new Set(
      graph.nodes.flatMap((node) => (node.path ? [node.path] : [])),
    );
    return [...paths].filter((file) => existing.has(file)).sort();
  }
  private semanticDossier(
    contexts: ComponentContext[],
    graph: ArchitectureGraph,
  ) {
    const semantic = graph.semantic;
    if (!semantic) return null;
    const selected = new Set(
      contexts
        .map((context) => context.nodeId)
        .filter((id) => semantic.nodes.some((node) => node.id === id)),
    );
    if (!selected.size) return null;
    const included = new Set(selected);
    for (let depth = 0; depth < 2; depth++)
      for (const relation of semantic.relations)
        if (included.has(relation.from)) included.add(relation.to);
        else if (included.has(relation.to)) included.add(relation.from);
    const nodes = semantic.nodes
      .filter((node) => included.has(node.id))
      .slice(0, 100)
      .map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        trust: node.trust,
        status: node.status,
        confidence: node.confidence,
        ...(node.stepKind ? { stepKind: node.stepKind } : {}),
        ...(node.description ? { description: node.description } : {}),
        provenance: node.provenance,
        evidence: node.evidence.slice(0, 4),
      }));
    const visible = new Set(nodes.map((node) => node.id));
    return {
      contract: semantic.contract,
      analyzerVersion: semantic.analyzerVersion,
      policyVersion: semantic.policyVersion,
      revision: semantic.revision,
      sourceRevision: semantic.sourceRevision,
      boundary:
        "Verified, inferred, and authored items remain distinct. Language-server corroboration is a second static observer, not runtime proof. Static workflow order, branch membership, and retry structure remain provisional control-flow evidence.",
      selected: [...selected],
      nodes,
      relations: semantic.relations
        .filter(
          (relation) => visible.has(relation.from) && visible.has(relation.to),
        )
        .slice(0, 160)
        .map((relation) => ({
          from: relation.from,
          to: relation.to,
          kind: relation.kind,
          trust: relation.trust,
          status: relation.status,
          confidence: relation.confidence,
          ...(relation.description
            ? { description: relation.description }
            : {}),
          provenance: relation.provenance,
          evidence: relation.evidence.slice(0, 3),
        })),
      ...(graph.behavior
        ? {
            behavior: {
              contract: graph.behavior.contract,
              revision: graph.behavior.revision,
              boundary:
                "Static direct bindings only. Inferred Python/Rust flows are provisional; no runtime values, frequency, branch choice, or dynamic dispatch are claimed.",
              relations: graph.behavior.relations
                .filter(
                  (relation) =>
                    visible.has(relation.from) && visible.has(relation.to),
                )
                .slice(0, 120)
                .map((relation) => ({
                  id: relation.id,
                  from: relation.from,
                  to: relation.to,
                  kind: relation.kind,
                  trust: relation.trust,
                  status: relation.status,
                  confidence: relation.confidence,
                  value: graph.behavior?.values.find(
                    (value) => value.id === relation.valueId,
                  )?.label,
                  provenance: relation.provenance,
                  evidence: relation.evidence.slice(0, 3),
                })),
              workflows: graph.behavior.workflows.filter((summary) =>
                selected.has(summary.workflowId),
              ),
            },
          }
        : {}),
      ...(graph.frameworks
        ? {
            frameworks: {
              contract: graph.frameworks.contract,
              revision: graph.frameworks.revision,
              boundary:
                "Source-only explicit framework registrations. Rule-backed static facts are not proof that a route, task, graph edge, or channel executed at runtime.",
              coverage: graph.frameworks.coverage.filter(
                (item) => item.detectedFiles || item.candidateCount || item.excludedCount,
              ),
              candidates: graph.frameworks.candidates
                .filter(
                  (candidate) =>
                    visible.has(candidate.from) || visible.has(candidate.to),
                )
                .slice(0, 80)
                .map((candidate) => ({
                  framework: candidate.framework,
                  ruleId: candidate.ruleId,
                  kind: candidate.kind,
                  from: candidate.from,
                  to: candidate.to,
                  value: candidate.valueLabel,
                  trust: candidate.trust,
                  confidence: candidate.confidence,
                  evidence: candidate.evidence.slice(0, 3),
                })),
              diagnostics: graph.frameworks.diagnostics.slice(0, 20),
            },
          }
        : {}),
      claims: semantic.claims
        .filter((claim) => selected.has(claim.subjectId))
        .slice(0, 60)
        .map((claim) => ({
          subjectId: claim.subjectId,
          key: claim.key,
          value: claim.value,
          trust: claim.trust,
          status: claim.status,
          reason: claim.reason,
          provenance: claim.provenance,
          evidence: claim.evidence.slice(0, 3),
        })),
      openQuestions: semantic.questions
        .filter(
          (question) =>
            selected.has(question.subjectId) && question.status === "open",
        )
        .slice(0, 30)
        .map((question) => ({
          id: question.id,
          subjectId: question.subjectId,
          claimIds: question.claimIds,
          ...(question.relationIds
            ? { relationIds: question.relationIds }
            : {}),
          prompt: question.prompt,
          recommendation: question.recommendation,
          options: question.options,
          evidence: question.evidence.slice(0, 3),
        })),
    };
  }
  async start(
    root: string,
    graph: ArchitectureGraph,
    request: AgentRequest,
    continuation?: AgentContinuation,
  ): Promise<AgentRun> {
    await this.load();
    if (path.resolve(graph.workspaceRoot) !== path.resolve(root))
      throw new Error("The graph belongs to a different workspace");
    if (this.isRunning())
      throw new Error(
        "An agent is already running; stop it before starting another task",
      );
    if (
      !request ||
      typeof request.prompt !== "string" ||
      !request.prompt.trim() ||
      request.prompt.length > 30_000
    )
      throw new Error("Enter a task under 30,000 characters");
    if (!["ask", "change"].includes(request.mode))
      throw new Error("Unknown agent mode");
    const providerId = request.providerId || this.defaultProviderId;
    const provider = this.providers.get(providerId);
    if (!provider)
      throw new Error(`Agent Provider is not registered: ${providerId}`);
    const descriptor = provider.descriptor();
    if (!descriptor.available) throw new Error(descriptor.message);
    if (!descriptor.capabilities.modes.includes(request.mode))
      throw new Error(
        `${descriptor.label} does not support ${request.mode} Agent runs`,
      );
    if (continuation) {
      if (continuation.sourceRevision !== graph.revision)
        throw new Error(
          "The continuation baseline no longer matches the current workspace",
        );
      if (
        continuation.action === "resume" &&
        !descriptor.capabilities.sessionResume
      )
        throw new Error(`${descriptor.label} does not support native resume`);
      if (continuation.action === "fork" && !descriptor.capabilities.fork)
        throw new Error(`${descriptor.label} does not support native fork`);
      if (
        continuation.nativeSession &&
        continuation.nativeSession.providerId !== providerId
      )
        throw new Error("Native session belongs to another Agent Provider");
    }
    const contexts = this.contexts(request.contexts || [], graph);
    const run: AgentRun = {
      id: randomUUID(),
      providerId,
      providerLabel: descriptor.label,
      workspaceRoot: root,
      workspaceName: path.basename(root),
      prompt: request.prompt.trim(),
      mode: request.mode,
      contexts,
      status: "preparing",
      createdAt: new Date().toISOString(),
      response: "",
      activity: [],
      changes: [],
      isolation: request.mode === "change" ? "workspace-copy" : "read-only",
      ...(continuation ? { parentRunId: continuation.parentRunId } : {}),
    };
    this.runs.unshift(run);
    const active = {
      run,
      provider,
      canceled: false,
      controller: new AbortController(),
      openTools: new Set<string>(),
      ...(continuation ? { continuation } : {}),
    } as NonNullable<AgentHost["active"]>;
    this.active = active;
    try {
      await this.initializeEngineeringRun(run, graph.revision);
      await this.persist();
    } catch (error) {
      const projection = await this.engineeringRuns
        .read(run.id)
        .catch(() => null);
      if (projection && !["failed", "interrupted"].includes(projection.state))
        await this.transitionEngineeringRun(
          run,
          projection,
          "failed",
          `Agent run initialization failed: ${error}`,
        ).catch(() => undefined);
      this.active = null;
      this.runs = this.runs.filter((item) => item.id !== run.id);
      throw error;
    }
    this.publish(run);
    active.completion = this.execute(active, graph);
    return run;
  }
  private providerEvent(
    active: NonNullable<AgentHost["active"]>,
    event: AgentProviderEvent,
  ) {
    const run = active.run;
    if (event.type === "message-delta") {
      run.response = (run.response + event.delta).slice(-250_000);
      this.recordEngineeringEvent(run, "provider.message", {
        text: event.delta.slice(-250_000),
        completed: false,
      });
      this.publish(run);
      return;
    }
    if (event.type === "message-completed") {
      run.response = (
        event.text
          ? `${active.responsePrefix || ""}${event.text}`
          : run.response
      ).slice(-250_000);
      this.recordEngineeringEvent(run, "provider.message", {
        text: run.response,
        completed: true,
      });
      this.publish(run);
      return;
    }
    if (event.type === "tool-started") {
      // Codex and Claude stream top-level tool starts serially but do not expose
      // one common completion shape. The next top-level start is therefore the
      // deterministic completion boundary for the previous reported tool.
      for (const previousId of active.openTools) {
        this.recordEngineeringEvent(run, "tool.completed", {
          requestId: previousId,
          status: "completed",
          completedAt: new Date().toISOString(),
        });
        active.openTools.delete(previousId);
      }
      const requestId = randomUUID();
      active.openTools.add(requestId);
      this.recordEngineeringEvent(run, "tool.requested", {
        request: {
          id: requestId,
          toolId: `${run.providerId}.command`,
          capability: "process",
          argumentsHash: hashHarnessPayload(event.command || "running"),
          scope: [run.stagingRoot || run.workspaceRoot],
          reason: "Agent Provider reported a command execution",
        },
      });
      this.recordEngineeringEvent(run, "tool.started", {
        requestId,
        startedAt: new Date().toISOString(),
      });
      this.activity(run, "Provider command execution started");
      return;
    }
    if (event.type === "file-change-started") {
      this.activity(
        run,
        `Editing: ${event.paths.join(", ") || "workspace files"}`,
      );
      return;
    }
    if (event.type === "interaction-denied") {
      const requestId = randomUUID();
      this.recordEngineeringEvent(run, "approval.requested", {
        requestId,
        capability: "process",
        reason: "Agent Provider requested an additional capability",
      });
      this.recordEngineeringEvent(run, "approval.resolved", {
        requestId,
        decision: "deny",
        policyId: "witch.provider-capability-boundary/v1",
        reason: event.message.slice(0, 100_000),
      });
    }
    this.activity(run, event.message);
  }

  private async closeEngineeringTools(
    active: NonNullable<AgentHost["active"]>,
  ) {
    await this.engineeringRuns.flush(active.run.id);
    const failure = this.engineeringFailures.get(active.run.id);
    if (failure) throw failure;
    const status =
      active.run.status === "failed"
        ? "failed"
        : active.run.status === "interrupted"
          ? "interrupted"
          : "completed";
    for (const requestId of active.openTools)
      await this.appendEngineeringEvent(active.run, "tool.completed", {
        requestId,
        status,
        completedAt: active.run.completedAt || new Date().toISOString(),
      });
    active.openTools.clear();
  }

  private async execute(
    active: NonNullable<AgentHost["active"]>,
    graph: ArchitectureGraph,
  ) {
    const run = active.run;
    let stopped = true;
    let incompleteReview = false;
    try {
      let projection = await this.engineeringRuns.verify(run.id);
      if (run.mode === "change") {
        projection = await this.transitionEngineeringRun(
          run,
          projection,
          "planning",
          "Preparing the isolated execution boundary",
        );
        projection = await this.appendEngineeringEvent(run, "plan.created", {
          plan: createHarnessPlan(run, graph),
        });
        this.activity(
          run,
          "Creating an isolated copy. Original files stay unchanged until you approve the review.",
        );
        active.copy = await this.isolation.create(
          run.workspaceRoot,
          path.join(this.options.dataDirectory, run.id),
          active.controller.signal,
        );
        run.stagingRoot = active.copy.root;
        const baselineCheckpoint = await createBaselineCheckpoint(
          path.join(this.options.dataDirectory, run.id),
          active.copy,
        );
        active.baselineCheckpointId = baselineCheckpoint.checkpointId;
        projection = await this.recordCheckpoint(run, baselineCheckpoint);
        active.copy.warnings
          .slice(0, 10)
          .forEach((warning) => this.activity(run, warning));
      }
      if (active.canceled) throw new Error("Run canceled");
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "executing",
        run.mode === "change"
          ? "Agent Provider started inside the isolated workspace"
          : "Read-only Agent Provider execution started",
      );
      const cwd = active.copy?.root || run.workspaceRoot;
      const selectedModules = new Set(
        run.contexts
          .filter((context) => context.nodeId.startsWith("module:"))
          .map((context) => context.nodeId.slice(7)),
      );
      const selectedNodes = new Set(
        run.contexts.map((context) => context.nodeId),
      );
      const selectedContextPaths = new Set(
        run.contexts.flatMap((context) => context.paths),
      );
      const selectedFiles = new Set(
        graph.nodes
          .filter(
            (node) =>
              selectedModules.has(node.module) ||
              selectedNodes.has(node.id) ||
              selectedContextPaths.has(node.id),
          )
          .map((node) => node.id),
      );
      const related = graph.edges
        .filter(
          (edge) => selectedFiles.has(edge.from) || selectedFiles.has(edge.to),
        )
        .slice(0, 70);
      const contextText = JSON.stringify(
        {
          revision: graph.revision,
          scopeNote:
            "A module nodeId selects the entire module. Path lists are previews (at most 80 paths / 24,000 characters each); totalPaths is the full file count. Inspect the workspace for additional files when needed.",
          components: run.contexts,
          semantic: this.semanticDossier(run.contexts, graph),
          relations: related.map((edge) => ({
            from: edge.from,
            to: edge.to,
            evidence: edge.evidence.slice(0, 2),
          })),
        },
        null,
        2,
      );
      const history = this.runs
        .filter(
          (item) =>
            item.workspaceRoot === run.workspaceRoot &&
            item.providerId === run.providerId &&
            item.id !== run.id &&
            ["completed", "applied"].includes(item.status),
        )
        .slice(0, 3)
        .reverse()
        .map(
          (item) =>
            `Earlier user request: ${item.prompt.slice(0, 2000)}\nEarlier answer: ${item.response.slice(0, 4000)}`,
        )
        .join("\n\n");
      const result = await active.provider.execute(
        {
          cwd,
          mode: run.mode,
          prompt: `${history ? `Previous conversation (context only):\n${history}\n\n` : ""}Attached component evidence:\n${contextText}\n\nUser request:\n${run.prompt}`,
          ...(active.continuation
            ? {
                continuation: active.continuation.action,
                ...(active.continuation.nativeSession
                  ? { nativeSession: active.continuation.nativeSession }
                  : {}),
              }
            : {}),
        },
        {
          onEvent: (event) => this.providerEvent(active, event),
          onSession: async (session) => {
            run.nativeSession = session;
            if (session.turnId) run.status = "running";
            this.publish(run);
            await this.appendEngineeringEvent(run, "provider.session", {
              session,
            });
            await this.persist();
          },
        },
      );
      run.status =
        active.canceled || result.status === "interrupted"
          ? "interrupted"
          : "completed";
    } catch (error) {
      stopped = !(error instanceof AgentProviderShutdownError);
      run.status = active.canceled ? "interrupted" : "failed";
      run.error = error instanceof Error ? error.message : String(error);
      if (!stopped)
        run.error = `${run.error} No changes can be applied until process shutdown is confirmed.`;
    } finally {
      if (active.copy && stopped) {
        const outcome = run.status;
        const incomplete =
          active.canceled || ["interrupted", "failed"].includes(run.status);
        incompleteReview = incomplete;
        try {
          run.status = "preparing";
          this.activity(
            run,
            "Preparing the review from actual files in the stopped, isolated workspace…",
          );
          run.changes = await this.isolation.collect(
            run.workspaceRoot,
            active.copy,
          );
          if (run.changes.length) {
            run.status = "review";
            if (incomplete)
              run.error = `This run stopped before completing. Its partial changes need careful review. ${run.error || ""}`;
          } else run.status = outcome;
        } catch (error) {
          run.status = incomplete ? "interrupted" : "failed";
          run.error = `${run.error || ""} Review could not be prepared; the isolated workspace is retained. ${error}`;
        }
      }
      await this.closeEngineeringTools(active).catch((error) =>
        this.markEngineeringFailure(run, error),
      );
      await this.prepareEngineeringReview(active, incompleteReview).catch(
        (error) => this.markEngineeringFailure(run, error),
      );
      run.completedAt = new Date().toISOString();
      await this.finalizeEngineeringRun(run).catch((error) =>
        this.markEngineeringFailure(run, error),
      );
      await this.persist().catch((error) => {
        run.error = `${run.error || ""} History save failed: ${error}`;
      });
      if (this.active === active) this.active = null;
      this.publish(run);
    }
  }
  private async continuationParent(root: string, id: string) {
    await this.load();
    if (this.isRunning())
      throw new Error("Wait for the current Agent run to finish");
    const parent = this.runs.find(
      (run) => run.id === id && run.workspaceRoot === root,
    );
    if (!parent || ["preparing", "running"].includes(parent.status))
      throw new Error("Choose a completed Agent run to continue");
    const projection = await this.ensureEngineeringRun(parent);
    if (
      [
        "created",
        "context-planning",
        "planning",
        "awaiting-approval",
        "executing",
        "verifying",
        "repairing",
        "attention-required",
      ].includes(projection.state)
    )
      throw new Error("The parent Engineering Run is not stable enough to continue");
    return { parent, projection };
  }
  async resume(
    root: string,
    graph: ArchitectureGraph,
    id: string,
    prompt: string,
  ) {
    const { parent, projection } = await this.continuationParent(root, id);
    if (!parent.nativeSession)
      throw new Error("This Agent run has no native session to resume");
    const provider = this.providers.get(parent.providerId);
    if (!provider?.descriptor().capabilities.sessionResume)
      throw new Error(`${parent.providerLabel} does not support native resume`);
    return this.start(
      root,
      graph,
      {
        prompt,
        mode: parent.mode,
        contexts: parent.contexts,
        providerId: parent.providerId,
      },
      {
        action: "resume",
        parentRunId: parent.id,
        sourceRevision: projection.sourceRevision,
        nativeSession: parent.nativeSession,
      },
    );
  }
  async fork(
    root: string,
    graph: ArchitectureGraph,
    id: string,
    providerId: AgentProviderId,
    prompt: string,
  ) {
    const { parent, projection } = await this.continuationParent(root, id);
    const provider = this.providers.get(providerId);
    if (!provider?.descriptor().capabilities.fork)
      throw new Error(
        `${provider?.descriptor().label || providerId} does not support native fork`,
      );
    return this.start(
      root,
      graph,
      {
        prompt,
        mode: parent.mode,
        contexts: parent.contexts,
        providerId,
      },
      {
        action: "fork",
        parentRunId: parent.id,
        sourceRevision: projection.sourceRevision,
        ...(providerId === parent.providerId && parent.nativeSession
          ? { nativeSession: parent.nativeSession }
          : {}),
      },
    );
  }
  async stop() {
    const active = this.active;
    if (!active) return;
    active.canceled = true;
    active.controller.abort(new Error("Workspace preparation canceled"));
    await active.provider.stop().catch(() => undefined);
    await active.completion;
  }
  async apply(root: string, id: string, paths: string[]) {
    await this.load();
    if (this.isRunning())
      throw new Error(
        "Wait for the current agent to finish before applying changes",
      );
    const run = this.runs.find(
      (item) => item.id === id && item.workspaceRoot === root,
    );
    if (!run || run.status !== "review")
      throw new Error("This run is not ready for review");
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      paths.some((file) => !run.changes.some((change) => change.path === file))
    )
      throw new Error("Unknown review file");
    let projection = await this.ensureEngineeringRun(run);
    if (projection.state !== "review-ready")
      throw new Error(
        `Engineering Run is ${projection.state}, not review-ready`,
      );
    const approvalId = randomUUID();
    projection = await this.appendEngineeringEvent(run, "approval.requested", {
      requestId: approvalId,
      capability: "apply",
      reason: `Apply reviewed paths: ${paths.join(", ")}`,
    });
    projection = await this.appendEngineeringEvent(run, "approval.resolved", {
      requestId: approvalId,
      decision: "allow",
      policyId: "witch.explicit-review-selection/v1",
      reason: `The user selected ${paths.length} reviewed path(s) to apply`,
    });
    const selected = run.changes.filter((change) =>
      paths.includes(change.path),
    );
    const applied = await this.isolation.apply(
      root,
      selected,
      path.join(this.options.dataDirectory, id, `recovery-${Date.now()}`),
    );
    run.appliedPaths = [...(run.appliedPaths || []), ...applied];
    run.changes = run.changes.filter(
      (change) => !applied.includes(change.path),
    );
    run.status = run.changes.length ? "review" : "applied";
    let analysis: AnalysisUpdateReceipt;
    if (this.options.onApplied) {
      try {
        analysis = await this.options.onApplied(
          root,
          applied,
          projection.sourceRevision,
        );
      } catch (error) {
        analysis = {
          status: "failed",
          beforeRevision: projection.sourceRevision,
          invalidatedPaths: [...applied].sort(),
          completedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error),
        };
        run.error = `${run.error ? `${run.error} ` : ""}Incremental architecture refresh failed: ${analysis.error}`;
      }
    } else
      analysis = {
        status: "skipped",
        beforeRevision: projection.sourceRevision,
        invalidatedPaths: [...applied].sort(),
        completedAt: new Date().toISOString(),
        error: "No incremental analysis callback is configured",
      };
    projection = await this.appendEngineeringEvent(
      run,
      "analysis.updated",
      { receipt: analysis },
      analysis.completedAt,
    );
    if (run.status === "applied")
      await this.transitionEngineeringRun(
        run,
        projection,
        "applied",
        `Applied ${applied.length} reviewed path(s) to the original workspace`,
      );
    else
      await this.appendEngineeringEvent(run, "review.created", {
        reviewId: randomUUID(),
        changeSetIds: run.changes.map(
          (change, index) => `${index + 1}:${change.path}`,
        ),
        changedPaths: run.changes.map((change) => change.path).sort(),
      });
    await this.persist();
    this.publish(run);
    return run;
  }

  private async archivedReview(run: AgentRun) {
    if (!run.archivePath) throw new Error("Archived review payload is missing");
    const directory = path.resolve(this.options.dataDirectory, run.id);
    const archivePath = path.resolve(run.archivePath);
    const relative = path.relative(directory, archivePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("Archived review path escapes its Agent Run directory");
    const stat = await fs.lstat(archivePath);
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 24_000_000)
      throw new Error("Archived review exceeds its 24 MB safety bound");
    const snapshot = JSON.parse(await fs.readFile(archivePath, "utf8"));
    if (
      !snapshot ||
      ![1, 2].includes(snapshot.version) ||
      !snapshot.run ||
      snapshot.run.id !== run.id ||
      path.resolve(snapshot.run.workspaceRoot) !==
        path.resolve(run.workspaceRoot) ||
      !Array.isArray(snapshot.run.changes) ||
      snapshot.run.changes.length > 200
    )
      throw new Error("Archived review payload is invalid");
    if (snapshot.version === 2) {
      const { payloadHash, ...payload } = snapshot;
      if (
        typeof payloadHash !== "string" ||
        contentHash(JSON.stringify(payload)) !== payloadHash
      )
        throw new Error("Archived review integrity check failed");
    }
    for (const change of snapshot.run.changes) {
      if (
        !change ||
        typeof change.path !== "string" ||
        !["string", "object"].includes(typeof change.before) ||
        !["string", "object"].includes(typeof change.after) ||
        (change.before !== null &&
          contentHash(change.before) !== change.beforeHash) ||
        (change.after !== null &&
          contentHash(change.after) !== change.afterHash)
      )
        throw new Error("Archived review contents failed integrity validation");
      assertMutablePath(change.path);
    }
    return snapshot.run as AgentRun;
  }

  private async writeArchivedReviewToCopy(
    copy: WorkspaceCopy,
    changes: readonly AgentRun["changes"][number][],
  ) {
    for (const change of changes) {
      const target = await resolveWorkspacePath(copy.root, change.path, true);
      if (change.after === null)
        await fs.unlink(target).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      else {
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, change.after, "utf8");
      }
    }
  }

  async restore(root: string, id: string) {
    await this.load();
    if (this.isRunning())
      throw new Error("Wait for the current Agent operation to finish");
    const archived = this.runs.find(
      (item) => item.id === id && item.workspaceRoot === root,
    );
    if (!archived || archived.status !== "archived")
      throw new Error("Choose an archived review to restore");
    const archivedSnapshot = await this.archivedReview(archived);
    this.maintenance = true;
    const run: AgentRun = {
      id: randomUUID(),
      parentRunId: archived.id,
      providerId: archived.providerId,
      providerLabel: archived.providerLabel,
      workspaceRoot: root,
      workspaceName: archived.workspaceName,
      prompt: `Restore archived review: ${archived.prompt}`,
      mode: "change",
      contexts: structuredClone(archived.contexts),
      status: "preparing",
      createdAt: new Date().toISOString(),
      response:
        "Restoring the archived desired files into a new isolated review. The archived run remains immutable.",
      activity: [],
      changes: [],
      isolation: "workspace-copy",
    };
    let registered = false;
    try {
      const copy = await this.isolation.create(
        root,
        path.join(this.options.dataDirectory, run.id),
      );
      run.stagingRoot = copy.root;
      this.runs.unshift(run);
      registered = true;
      this.publish(run);
      const sourceRevision = `restore-baseline:${contentHash(
        JSON.stringify(Object.entries(copy.baseline).sort()),
      )}`;
      let projection = await this.initializeEngineeringRun(run, sourceRevision);
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "planning",
        "Forking an archived review onto a new immutable baseline",
      );
      projection = await this.appendEngineeringEvent(run, "plan.created", {
        plan: {
          objective: `Restore archived review ${archived.id}`,
          assumptions: [
            "The archived run remains immutable",
            "The desired archived contents are rebased onto the current source baseline",
          ],
          affectedComponents: run.contexts
            .map((item) => item.label)
            .slice(0, 100),
          expectedFiles: archivedSnapshot.changes
            .map((item) => item.path)
            .sort(),
          steps: [
            {
              id: "restore-copy",
              description: "Create a new isolated copy from current source",
              expectedOutcome: "Original and archived staging remain unchanged",
            },
            {
              id: "restore-review",
              description:
                "Project archived desired contents into the new copy",
              expectedOutcome:
                "A new review expresses the delta from current source",
            },
          ],
          verification: [
            {
              id: "changed-source-syntax",
              kind: "syntax",
              scope: ["restored TypeScript, JavaScript, and JSON files"],
              required: false,
            },
            {
              id: "isolated-architecture",
              kind: "architecture",
              scope: ["restored isolated workspace"],
              required: true,
            },
          ],
          risks: [
            "Current source may have diverged from the archived baseline",
          ],
        },
      });
      const baseline = await createBaselineCheckpoint(
        path.join(this.options.dataDirectory, run.id),
        copy,
      );
      projection = await this.recordCheckpoint(run, baseline);
      projection = await this.transitionEngineeringRun(
        run,
        projection,
        "executing",
        "Reconstructing archived desired contents in the new isolated copy",
      );
      await this.writeArchivedReviewToCopy(copy, archivedSnapshot.changes);
      run.changes = await this.isolation.collect(root, copy);
      run.completedAt = new Date().toISOString();
      if (!run.changes.length) {
        run.status = "completed";
        run.response =
          "The current project already matches every archived desired change; no new review was needed.";
      } else {
        run.status = "review";
        const checkpoint = await createReviewCheckpoint(
          path.join(this.options.dataDirectory, run.id),
          baseline.checkpointId,
          run.changes,
        );
        projection = await this.recordCheckpoint(run, checkpoint);
        projection = await this.transitionEngineeringRun(
          run,
          projection,
          "verifying",
          "Validating the restored isolated review",
        );
        for (const receipt of await verifyIsolatedReview(
          copy.root,
          run.changes,
        ))
          projection = await this.appendEngineeringEvent(
            run,
            "verification.completed",
            { receipt },
            receipt.completedAt,
          );
      }
      await this.finalizeEngineeringRun(run);
      await this.persist();
      this.publish(run);
      return run;
    } catch (error) {
      if (!registered) throw error;
      run.status = "failed";
      run.completedAt = new Date().toISOString();
      run.error = error instanceof Error ? error.message : String(error);
      const projection = await this.engineeringRuns
        .read(run.id)
        .catch(() => null);
      if (projection && !["failed", "interrupted"].includes(projection.state))
        await this.transitionEngineeringRun(
          run,
          projection,
          "failed",
          run.error,
          run.completedAt,
        ).catch((reason) => this.markEngineeringFailure(run, reason));
      await this.persist().catch(() => undefined);
      this.publish(run);
      throw error;
    } finally {
      this.maintenance = false;
    }
  }

  async archive(root: string, id: string) {
    await this.load();
    if (this.isRunning())
      throw new Error("Wait for the current agent to finish before archiving");
    const run = this.runs.find(
      (item) => item.id === id && item.workspaceRoot === root,
    );
    if (!run || run.status !== "review")
      throw new Error("This run has no pending review to archive");
    const engineering = await this.ensureEngineeringRun(run);
    if (engineering.state !== "review-ready")
      throw new Error(
        `Engineering Run is ${engineering.state}, not review-ready`,
      );
    const archivedAt = new Date().toISOString();
    const directory = path.join(this.options.dataDirectory, run.id);
    const archivePath = path.join(
      directory,
      `archived-review-${randomUUID()}.json`,
    );
    const temporary = archivePath + ".tmp";
    await fs.mkdir(directory, { recursive: true });
    // Preserve the complete pending diff before removing it from the active
    // history. Neither the original project nor the staged files are changed.
    try {
      const file = await fs.open(temporary, "wx", 0o600);
      try {
        const payload = { version: 2, archivedAt, run };
        await file.writeFile(
          JSON.stringify(
            {
              ...payload,
              payloadHash: contentHash(JSON.stringify(payload)),
            },
            null,
            2,
          ),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await fs.rename(temporary, archivePath);
    } catch (error) {
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
    const previous = { ...run };
    run.status = "archived";
    run.changes = [];
    run.archivePath = archivePath;
    run.archivedAt = archivedAt;
    try {
      await this.persist();
    } catch (error) {
      Object.assign(run, previous);
      delete run.archivePath;
      delete run.archivedAt;
      throw new Error(
        `Archive history could not be saved; the review is still active. A recovery copy is retained at ${archivePath}. ${error}`,
      );
    }
    try {
      await this.transitionEngineeringRun(
        run,
        engineering,
        "archived",
        `Archived the pending review at ${archivePath}`,
        archivedAt,
      );
    } catch (error) {
      this.markEngineeringFailure(run, error);
      throw new Error(
        `The review was archived, but its Engineering Run journal could not be finalized. ${error}`,
      );
    }
    this.publish(run);
    return run;
  }
}

// Transitional compatibility for existing imports while the application moves
// to the explicit AgentHost name.
export { AgentHost as AgentService };
