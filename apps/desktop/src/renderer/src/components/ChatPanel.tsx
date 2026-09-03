import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Grip,
  MessageSquare,
  Paperclip,
  Square,
  X,
} from "lucide-react";
import {
  COMPONENT_DRAG_TYPE,
  type ArchitectureGraph,
  type ComponentContext,
} from "../../../shared/architecture";
import type {
  AgentHostStatus,
  AgentMode,
  AgentProviderId,
  AgentRun,
} from "../../../shared/agent";
import astralObservatory from "../assets/witch-astral-observatory.png";
import { ReviewDialog } from "./ReviewDialog";
import "./chat.css";

export function ChatPanel({
  root,
  graph,
  attachments,
  onAttachments,
  available,
  providerStatus,
  onOpenFile,
}: {
  root: string | undefined;
  graph: ArchitectureGraph | null;
  attachments: ComponentContext[];
  onAttachments: (contexts: ComponentContext[]) => void;
  available: boolean;
  providerStatus: ProviderStatus | null;
  onOpenFile: (path: string, line?: number) => void;
}) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [agentHost, setAgentHost] = useState<AgentHostStatus | null>(null);
  const [providerId, setProviderId] = useState<AgentProviderId>("codex");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("ask");
  const [starting, setStarting] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [continuing, setContinuing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  // Keep the reviewed contents stable while live apply events update the history.
  // Otherwise an all-files-applied event empties and disposes the diff editor
  // before the dialog's own cleanup runs.
  const [review, setReview] = useState<AgentRun | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const currentRoot = useRef(root);
  currentRoot.current = root;
  const busy =
    starting ||
    !!continuing ||
    runs.some((run) => ["preparing", "running"].includes(run.status));
  const provider = agentHost?.providers.find((item) => item.id === providerId);
  const providerAvailable = provider?.available ?? available;
  useEffect(() => {
    let disposed = false;
    void window.witch.agent
      .status()
      .then((status) => {
        if (disposed) return;
        setAgentHost(status);
        setProviderId((current) =>
          status.providers.some((item) => item.id === current)
            ? current
            : status.defaultProviderId,
        );
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [
    providerStatus?.codex.authenticated,
    providerStatus?.claude.authenticated,
  ]);
  useEffect(() => {
    let disposed = false;
    setRuns([]);
    setError("");
    setReview(null);
    setArchiving(null);
    setRestoring(null);
    const events = new Map<string, AgentRun>();
    const unsubscribe = window.witch.agent.onEvent(({ run }) => {
      if (run.workspaceRoot !== root) return;
      events.set(run.id, run);
      setRuns((previous) =>
        [run, ...previous.filter((item) => item.id !== run.id)].sort((a, b) =>
          b.createdAt.localeCompare(a.createdAt),
        ),
      );
    });
    if (root)
      void window.witch.agent
        .list()
        .then((items) => {
          if (!disposed)
            setRuns(
              [
                ...new Map(
                  [...items, ...events.values()].map((item) => [item.id, item]),
                ).values(),
              ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
            );
        })
        .catch((reason) => {
          if (!disposed) setError(String(reason));
        });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [root]);
  useEffect(() => {
    if (follow.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [runs]);
  function drop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    try {
      const raw = event.dataTransfer.getData(COMPONENT_DRAG_TYPE);
      if (!raw || raw.length > 50_000)
        throw new Error("Drag a component from the current structure map");
      const context = JSON.parse(raw) as ComponentContext;
      if (
        !context ||
        typeof context.nodeId !== "string" ||
        context.revision !== graph?.revision ||
        !Array.isArray(context.paths)
      )
        throw new Error(
          "This component belongs to an older map. Attach it from the current map.",
        );
      if (attachments.length >= 12)
        throw new Error("Attach up to 12 components");
      onAttachments([
        ...attachments.filter((item) => item.nodeId !== context.nodeId),
        context,
      ]);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Invalid component");
    }
  }
  async function send() {
    if (!prompt.trim() || busy || archiving) return;
    setStarting(true);
    setError("");
    follow.current = true;
    try {
      const run = await window.witch.agent.start({
        prompt: prompt.trim(),
        mode,
        contexts: attachments,
        providerId,
      });
      setRuns((previous) =>
        previous.some((item) => item.id === run.id)
          ? previous
          : [run, ...previous],
      );
      setPrompt("");
      onAttachments([]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setStarting(false);
    }
  }
  async function archive(run: AgentRun) {
    if (busy || archiving || !root) return;
    const origin = root;
    setArchiving(run.id);
    setError("");
    try {
      const updated = await window.witch.agent.archive(run.id);
      if (currentRoot.current === origin)
        setRuns((previous) =>
          previous.map((item) => (item.id === updated.id ? updated : item)),
        );
    } catch (reason) {
      if (currentRoot.current === origin)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (currentRoot.current === origin) setArchiving(null);
    }
  }
  async function restore(run: AgentRun) {
    if (busy || archiving || restoring || !root) return;
    const origin = root;
    setRestoring(run.id);
    setError("");
    try {
      const restored = await window.witch.agent.restore(run.id);
      if (currentRoot.current === origin)
        setRuns((previous) => [
          restored,
          ...previous.filter((item) => item.id !== restored.id),
        ]);
    } catch (reason) {
      if (currentRoot.current === origin)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (currentRoot.current === origin) setRestoring(null);
    }
  }
  async function continueRun(run: AgentRun, action: "resume" | "fork") {
    if (busy || archiving || restoring || !root || !prompt.trim()) return;
    const origin = root;
    setContinuing(`${action}:${run.id}`);
    setError("");
    follow.current = true;
    try {
      const continued =
        action === "resume"
          ? await window.witch.agent.resume(run.id, prompt.trim())
          : await window.witch.agent.fork(run.id, providerId, prompt.trim());
      if (currentRoot.current === origin) {
        setRuns((previous) => [
          continued,
          ...previous.filter((item) => item.id !== continued.id),
        ]);
        setPrompt("");
        onAttachments([]);
      }
    } catch (reason) {
      if (currentRoot.current === origin)
        setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (currentRoot.current === origin) setContinuing(null);
    }
  }
  return (
    <section
      className={`chat-panel ${dragging ? "dragging" : ""}`}
      aria-label="Component chat"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(COMPONENT_DRAG_TYPE)) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDragging(false);
      }}
      onDrop={drop}
    >
      <header>
        <div>
          <MessageSquare size={15} />
          <h2>Witch companion</h2>
        </div>
        <span className="chat-engine">
          {provider?.label || "Codex"} ·{" "}
          {busy ? "working" : providerAvailable ? "ready" : "unavailable"}
        </span>
      </header>
      <div
        className="chat-messages"
        ref={scroll}
        onScroll={() => {
          const el = scroll.current;
          if (el)
            follow.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 90;
        }}
      >
        {!runs.length && (
          <div className="chat-welcome">
            <div className="chat-observatory" aria-hidden="true">
              <span className="chat-orbit chat-orbit-one" />
              <span className="chat-orbit chat-orbit-two" />
              <img src={astralObservatory} alt="" draggable={false} />
            </div>
            <h3>Understand, then shape.</h3>
            <p>
              Drag a component from the map into this conversation. Ask about
              its source, or request a change in an isolated workspace.
            </p>
            <p className="chat-private">
              Source relevant to your request is sent to your signed-in AI
              provider. Original files change only after review.
            </p>
          </div>
        )}
        {[...runs].reverse().map((run) => (
          <article className="chat-run" key={run.id}>
            <div className="chat-user">
              <span>
                You · {run.providerLabel} ·{" "}
                {run.mode === "change" ? "change request" : "question"}
              </span>
              <p>{run.prompt}</p>
              {!!run.contexts.length && (
                <div className="context-history">
                  {run.contexts.map((context) => (
                    <button
                      key={context.nodeId}
                      onClick={() =>
                        context.paths[0] &&
                        onOpenFile(context.paths[0], context.line)
                      }
                    >
                      <Paperclip size={10} />
                      {context.label}
                      {context.semantic && (
                        <small>
                          {context.semantic.kind} · {context.semantic.trust}
                        </small>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-assistant">
              <header>
                <strong>✦ Witch</strong>
                <span className={`run-state ${run.status}`}>{run.status}</span>
              </header>
              {run.engineering && (
                <div
                  className={`engineering-run-summary ${run.engineering.healthy ? "healthy" : "unhealthy"}`}
                  title={
                    run.engineering.healthy
                      ? `Replay digest ${run.engineering.eventDigest}`
                      : run.engineering.error
                  }
                >
                  <span>Harness · {run.engineering.state}</span>
                  <small>
                    {run.engineering.eventCount} immutable event
                    {run.engineering.eventCount === 1 ? "" : "s"} ·{" "}
                    {run.engineering.checkpointCount} checkpoint
                    {run.engineering.checkpointCount === 1 ? "" : "s"} ·{" "}
                    {run.engineering.verificationPassed} passed
                    {run.engineering.verificationFailed
                      ? ` · ${run.engineering.verificationFailed} failed`
                      : ""}
                    {run.engineering.repairAttempts
                      ? ` · ${run.engineering.repairAttempts} repair${run.engineering.repairAttempts === 1 ? "" : "s"}`
                      : ""}
                    {run.engineering.planUnexpectedFiles
                      ? ` · ${run.engineering.planUnexpectedFiles} outside plan`
                      : ""}
                    {run.engineering.repairStopReason
                      ? ` · stopped ${run.engineering.repairStopReason}`
                      : ""}
                    {run.engineering.analysisStatus
                      ? ` · analysis ${run.engineering.analysisStatus}`
                      : ""}
                    {run.engineering.impactRiskLevel
                      ? ` · impact ${run.engineering.impactRiskLevel} ${run.engineering.impactRiskScore}/100 (${run.engineering.impactAffectedNodes} nodes)`
                      : ""}
                    {run.engineering.experienceCount
                      ? ` · ${run.engineering.experienceCount} experience`
                      : ""}
                    {" · "}
                    {run.engineering.healthy
                      ? "journal verified"
                      : "apply blocked"}
                  </small>
                </div>
              )}
              {run.graphContext?.experience &&
                (run.graphContext.experience.included.length > 0 ||
                  run.graphContext.experience.staleRecordIds.length > 0 ||
                  run.graphContext.experience.unknownRecordIds.length > 0) && (
                  <div className="agent-experience-context">
                    <span>Experience context</span>
                    <small>
                      {run.graphContext.experience.included.length} fresh used ·{" "}
                      {run.graphContext.experience.staleRecordIds.length} stale
                      excluded
                      {run.graphContext.experience.unknownRecordIds.length
                        ? ` · ${run.graphContext.experience.unknownRecordIds.length} unknown excluded`
                        : ""}
                    </small>
                  </div>
                )}
              {run.response ? (
                <div className="assistant-text">{run.response}</div>
              ) : (
                <p className="chat-muted">
                  {run.status === "preparing"
                    ? "Preparing the workspace…"
                    : run.status === "running"
                      ? "Reading source evidence…"
                      : "No response was produced."}
                </p>
              )}
              {run.error && (
                <div className="inline-error" role="alert">
                  {run.error}
                </div>
              )}
              {!!run.activity.length && (
                <details className="agent-activity">
                  <summary>
                    {run.activity.length} activity events ·{" "}
                    {run.isolation === "workspace-copy"
                      ? "isolated copy"
                      : "read-only"}
                  </summary>
                  <ol>
                    {run.activity.map((activity, index) => (
                      <li key={index}>{activity}</li>
                    ))}
                  </ol>
                </details>
              )}
              {(Boolean(
                run.nativeSession &&
                agentHost?.providers.find((item) => item.id === run.providerId)
                  ?.capabilities.sessionResume,
              ) ||
                Boolean(
                  provider?.capabilities.fork &&
                  provider.capabilities.modes.includes(run.mode),
                )) && (
                <div className="agent-native-controls">
                  {run.nativeSession &&
                    agentHost?.providers.find(
                      (item) => item.id === run.providerId,
                    )?.capabilities.sessionResume && (
                      <button
                        disabled={busy || !prompt.trim()}
                        aria-label={`Resume ${run.providerLabel} session`}
                        onClick={() => void continueRun(run, "resume")}
                      >
                        {continuing === `resume:${run.id}`
                          ? "Resuming…"
                          : "Resume session"}
                      </button>
                    )}
                  {provider?.capabilities.fork &&
                    provider.capabilities.modes.includes(run.mode) && (
                      <button
                        disabled={busy || !prompt.trim()}
                        aria-label={`Fork run with ${provider.label}`}
                        onClick={() => void continueRun(run, "fork")}
                      >
                        {continuing === `fork:${run.id}`
                          ? "Forking…"
                          : `Fork with ${provider.label}`}
                      </button>
                    )}
                </div>
              )}
              {run.status === "review" && (
                <>
                  {run.graphImpact && (
                    <div
                      className={`agent-impact-summary risk-${run.graphImpact.risk.level}`}
                    >
                      <span>Graph impact</span>
                      <strong>
                        {run.graphImpact.risk.level} ·{" "}
                        {run.graphImpact.risk.score}/100
                      </strong>
                      <small>
                        {run.graphImpact.affectedCount} affected ·{" "}
                        {run.graphImpact.workflowIds.length} workflows ·{" "}
                        {run.graphImpact.suggestedTestPaths.length} test targets
                      </small>
                    </div>
                  )}
                  <button
                    className="review-changes-button"
                    disabled={busy || !!archiving}
                    onClick={() => setReview(run)}
                  >
                    Review {run.changes.length} changed file
                    {run.changes.length === 1 ? "" : "s"} →
                  </button>
                  <button
                    className="archive-review-button"
                    disabled={busy || !!archiving}
                    onClick={() => void archive(run)}
                  >
                    {archiving === run.id
                      ? "Archiving…"
                      : "Archive without applying"}
                  </button>
                </>
              )}
              {!!run.experiences?.length && (
                <div
                  className="agent-experience-outcomes"
                  aria-label="Agent experiences"
                >
                  {run.experiences.map((experience) => (
                    <span
                      key={experience.id}
                      className={`experience-${experience.outcome}`}
                      title={experience.reason}
                    >
                      {experience.outcome}
                    </span>
                  ))}
                </div>
              )}
              {run.status === "archived" && (
                <details className="archived-note">
                  <summary>Pending changes archived, not applied</summary>
                  <p>
                    The isolated workspace and full review copy are retained
                    locally. Restoring a review in the UI is not yet supported.
                  </p>
                  <p>{run.archivePath}</p>
                  <button
                    className="restore-review-button"
                    disabled={busy || !!archiving || !!restoring}
                    onClick={() => void restore(run)}
                  >
                    {restoring === run.id
                      ? "Restoring…"
                      : "Restore as new review"}
                  </button>
                </details>
              )}
              {!!run.appliedPaths?.length && (
                <p className="applied-note">
                  ✓ {run.appliedPaths.length} file(s) applied · the structure
                  map is refreshed
                </p>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="chat-compose">
        {dragging && (
          <div className="drop-hint">
            <Grip size={18} /> Drop component as source context
          </div>
        )}
        <div className="context-chips">
          {attachments.map((context) => (
            <span
              className={
                context.revision === graph?.revision
                  ? "context-chip"
                  : "context-chip stale"
              }
              key={context.nodeId}
              title={context.paths.join("\n")}
            >
              <Paperclip size={11} />
              {context.label}
              <small>
                {context.semantic
                  ? `${context.semantic.kind} · ${context.semantic.trust}`
                  : (context.totalPaths ?? context.paths.length)}
              </small>
              <button
                onClick={() =>
                  onAttachments(
                    attachments.filter(
                      (item) => item.nodeId !== context.nodeId,
                    ),
                  )
                }
                aria-label={`Remove ${context.label}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        {error && (
          <div className="inline-error" role="alert">
            {error}
          </div>
        )}
        <textarea
          aria-label="Message Witch"
          placeholder={
            root ? "Ask about this project…" : "Open a project to begin"
          }
          value={prompt}
          disabled={!root || busy || !!archiving}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <footer>
          {agentHost && agentHost.providers.length > 1 && (
            <label>
              <span className="sr-only">Agent provider</span>
              <select
                aria-label="Agent provider"
                value={providerId}
                disabled={busy || !!archiving}
                onChange={(event) => {
                  const next = event.target.value as AgentProviderId;
                  setProviderId(next);
                  const descriptor = agentHost.providers.find(
                    (item) => item.id === next,
                  );
                  if (
                    descriptor &&
                    !descriptor.capabilities.modes.includes(mode)
                  )
                    setMode(descriptor.capabilities.modes[0] || "ask");
                }}
              >
                {agentHost.providers.map((item) => (
                  <option
                    key={item.id}
                    value={item.id}
                    disabled={!item.available}
                  >
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            <span className="sr-only">Agent mode</span>
            <select
              aria-label="Agent mode"
              value={mode}
              disabled={busy || !!archiving}
              onChange={(event) => setMode(event.target.value as AgentMode)}
            >
              <option
                value="ask"
                disabled={Boolean(
                  provider && !provider.capabilities.modes.includes("ask"),
                )}
              >
                Ask · read only
              </option>
              <option
                value="change"
                disabled={Boolean(
                  provider && !provider.capabilities.modes.includes("change"),
                )}
              >
                Change · isolated copy
              </option>
            </select>
          </label>
          {busy ? (
            <button
              className="chat-send"
              aria-label="Stop agent"
              onClick={() =>
                void window.witch.agent
                  .stop()
                  .catch((reason) => setError(String(reason)))
              }
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              className="chat-send"
              aria-label="Send message"
              onClick={() => void send()}
              disabled={
                !root || !providerAvailable || !prompt.trim() || !!archiving
              }
            >
              <ArrowUp size={17} />
            </button>
          )}
        </footer>
        <small className="compose-hint">
          Enter to send · Shift+Enter for a new line
        </small>
      </div>
      {review && (
        <ReviewDialog
          key={review.id}
          title="Review agent changes"
          files={review.changes}
          impact={review.graphImpact}
          onClose={() => setReview(null)}
          onApply={async (paths) => {
            const updated = await window.witch.agent.apply(review.id, paths);
            setRuns((previous) =>
              previous.map((run) => (run.id === updated.id ? updated : run)),
            );
          }}
        />
      )}
    </section>
  );
}
