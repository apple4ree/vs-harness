import { useEffect, useState } from "react";
import {
  Play,
  Pause,
  Square,
  StepForward,
  ArrowDownToLine,
  ArrowUpFromLine,
  Settings2,
} from "lucide-react";
import type {
  DebugState,
  DebugAction,
  DebugVariable,
  ExecutionCatalog,
} from "../../../shared/execution";
import "./debug.css";

function Variables({
  objectId,
  depth = 0,
}: {
  objectId: string;
  depth?: number;
}) {
  const [variables, setVariables] = useState<DebugVariable[]>([]);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [error, setError] = useState("");
  useEffect(() => {
    let disposed = false;
    setError("");
    void window.witch.debug
      .variables(objectId)
      .then((value) => {
        if (!disposed) setVariables(value);
      })
      .catch((reason) => {
        if (!disposed) setError(String(reason));
      });
    return () => {
      disposed = true;
    };
  }, [objectId]);
  if (error) return <p className="debug-error">{error}</p>;
  return (
    <div className="debug-variables">
      {variables.map((variable) => (
        <div key={variable.name}>
          <button
            disabled={!variable.objectId || depth >= 4}
            onClick={() =>
              setExpanded((previous) => {
                const next = new Set(previous);
                if (next.has(variable.name)) next.delete(variable.name);
                else next.add(variable.name);
                return next;
              })
            }
          >
            <span>
              {variable.objectId
                ? expanded.has(variable.name)
                  ? "▾"
                  : "▸"
                : "·"}{" "}
              {variable.name}
            </span>
            <code title={variable.value}>{variable.value}</code>
          </button>
          {variable.objectId && expanded.has(variable.name) && (
            <Variables objectId={variable.objectId} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

export function DebugPanel({
  root,
  activeFile,
  state,
  onNavigate,
  onConfigure,
  onError,
}: {
  root?: string;
  activeFile: string | null;
  state: DebugState;
  onNavigate: (path: string, line: number) => void;
  onConfigure: () => void;
  onError: (error: string) => void;
}) {
  const [catalog, setCatalog] = useState<ExecutionCatalog>({
    tasks: [],
    launches: [],
    warnings: [],
  });
  const [selected, setSelected] = useState("");
  const [frame, setFrame] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const running = ["starting", "running", "paused"].includes(state.status);
  const selectedFrame =
    state.frames.find((item) => item.id === frame) || state.frames[0];
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void window.witch.execution
        .catalog()
        .then((value) => {
          if (!disposed) setCatalog(value);
        })
        .catch((reason) => {
          if (!disposed) onError(String(reason));
        });
    };
    refresh();
    const off = window.witch.workspace.onChanged((event) => {
      if (
        event.root === root &&
        event.paths.some(
          (path) => path.endsWith("launch.json") || path.endsWith("tasks.json"),
        )
      )
        refresh();
    });
    return () => {
      disposed = true;
      off();
    };
  }, [root]);
  async function start() {
    setBusy(true);
    try {
      await window.witch.debug.start(selected || null, activeFile || undefined);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  async function action(action: DebugAction) {
    setBusy(true);
    try {
      await window.witch.debug.action(action);
    } catch (reason) {
      onError(String(reason));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setFrame(null);
  }, [state.status, state.frames[0]?.line]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "F5") {
        event.preventDefault();
        if (event.shiftKey && running) void action("stop");
        else if (state.status === "paused") void action("continue");
        else if (!running) void start();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [state.status, selected, activeFile, root]);
  return (
    <section className="debug-panel" aria-label="Run and debug">
      <h2>Run and debug</h2>
      <div className="debug-config">
        <select
          aria-label="Debug configuration"
          value={selected}
          disabled={running || busy}
          onChange={(event) => setSelected(event.target.value)}
        >
          <option value="">Active JavaScript / Python file</option>
          {catalog.launches.map((launch) => (
            <option key={launch.id} value={launch.id}>
              {launch.name}
            </option>
          ))}
        </select>
        <button aria-label="Edit launch configurations" onClick={onConfigure}>
          <Settings2 size={13} />
        </button>
      </div>
      <div className="debug-controls">
        {!running ? (
          <button
            onClick={() => void start()}
            disabled={
              busy ||
              !root ||
              (!selected && !/(?:\.[cm]?js|\.py)$/i.test(activeFile || ""))
            }
            aria-label="Start debugging"
          >
            <Play size={13} />
            <span>Start · F5</span>
          </button>
        ) : (
          <>
            <button
              disabled={busy || state.status === "starting"}
              onClick={() =>
                void action(state.status === "paused" ? "continue" : "pause")
              }
              aria-label={
                state.status === "paused"
                  ? "Continue debugging"
                  : "Pause debugging"
              }
            >
              {state.status === "paused" ? (
                <Play size={13} />
              ) : (
                <Pause size={13} />
              )}
            </button>
            <button
              disabled={busy || state.status !== "paused"}
              onClick={() => void action("stepOver")}
              aria-label="Step over"
            >
              <StepForward size={13} />
            </button>
            <button
              disabled={busy || state.status !== "paused"}
              onClick={() => void action("stepInto")}
              aria-label="Step into"
            >
              <ArrowDownToLine size={13} />
            </button>
            <button
              disabled={busy || state.status !== "paused"}
              onClick={() => void action("stepOut")}
              aria-label="Step out"
            >
              <ArrowUpFromLine size={13} />
            </button>
            <button
              disabled={busy}
              onClick={() => void action("stop")}
              aria-label="Stop debugging"
            >
              <Square size={12} />
            </button>
          </>
        )}
      </div>
      <p className="debug-status">
        {state.status}
        {state.reason ? ` · ${state.reason}` : ""}
      </p>
      <p className="rail-note">
        {state.adapter === "python" ? "Python / debugpy" : "Node / JavaScript"}
        {" · "}F9 toggles a breakpoint. Python uses the selected environment;
        TypeScript source maps and Rust debugging are not yet supported.
      </p>
      {state.error && <p className="debug-error">{state.error}</p>}
      {!!catalog.warnings.length && (
        <details className="debug-warnings">
          <summary>{catalog.warnings.length} configuration notices</summary>
          {catalog.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </details>
      )}
      {!!state.frames.length && (
        <>
          <h3>Call stack</h3>
          <div className="debug-stack">
            {state.frames.map((item) => (
              <button
                key={item.id}
                className={item.id === selectedFrame?.id ? "selected" : ""}
                onClick={() => {
                  setFrame(item.id);
                  if (item.path) onNavigate(item.path, item.line);
                }}
              >
                <strong>{item.name}</strong>
                <span>
                  {item.path || "Node internals"}:{item.line}
                </span>
              </button>
            ))}
          </div>
          <h3>Variables</h3>
          {selectedFrame?.scopes.map((scope) => (
            <details
              key={`${state.output.length}:${state.frames[0]?.line}:${scope.objectId}`}
              className="debug-scope"
              open={scope.type === "local"}
            >
              <summary>
                {scope.type} · {scope.name}
              </summary>
              <Variables objectId={scope.objectId} />
            </details>
          ))}
        </>
      )}
      {state.output && (
        <details className="debug-console" open={state.status === "failed"}>
          <summary>Debug console</summary>
          <pre>{state.output}</pre>
        </details>
      )}
    </section>
  );
}
