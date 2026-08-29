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
import type { AgentMode, AgentRun } from "../../../shared/agent";
import { ReviewDialog } from "./ReviewDialog";
import "./chat.css";

export function ChatPanel({
  root,
  graph,
  attachments,
  onAttachments,
  available,
  onOpenFile,
}: {
  root: string | undefined;
  graph: ArchitectureGraph | null;
  attachments: ComponentContext[];
  onAttachments: (contexts: ComponentContext[]) => void;
  available: boolean;
  onOpenFile: (path: string, line?: number) => void;
}) {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<AgentMode>("ask");
  const [starting, setStarting] = useState(false);
  const [archiving, setArchiving] = useState<string | null>(null);
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
    runs.some((run) => ["preparing", "running"].includes(run.status));
  useEffect(() => {
    let disposed = false;
    setRuns([]);
    setError("");
    setReview(null);
    setArchiving(null);
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
          Codex · {busy ? "working" : available ? "CLI" : "not installed"}
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
            <span className="chat-sigil">✧</span>
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
                You · {run.mode === "change" ? "change request" : "question"}
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
              {run.status === "review" && (
                <>
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
              {run.status === "archived" && (
                <details className="archived-note">
                  <summary>Pending changes archived, not applied</summary>
                  <p>
                    The isolated workspace and full review copy are retained
                    locally. Restoring a review in the UI is not yet supported.
                  </p>
                  <p>{run.archivePath}</p>
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
              <small>{context.totalPaths ?? context.paths.length}</small>
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
          <label>
            <span className="sr-only">Agent mode</span>
            <select
              aria-label="Agent mode"
              value={mode}
              disabled={busy || !!archiving}
              onChange={(event) => setMode(event.target.value as AgentMode)}
            >
              <option value="ask">Ask · read only</option>
              <option value="change">Change · isolated copy</option>
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
              disabled={!root || !available || !prompt.trim() || !!archiving}
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
