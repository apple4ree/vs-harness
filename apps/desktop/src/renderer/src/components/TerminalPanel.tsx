import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { Plus, ChevronDown, ChevronUp, TerminalSquare, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import type { ProjectTask, TerminalData } from "../../../shared/execution";
import { PanelDivider } from "./PanelDivider";

function TerminalView({
  active,
  label,
  onLabel,
  task,
  existing,
}: {
  active: boolean;
  label: string;
  onLabel: (label: string) => void;
  task?: { id: string; activeFile?: string };
  existing?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<() => void>(() => undefined);
  const labelRef = useRef(onLabel);
  labelRef.current = onLabel;
  useEffect(() => {
    if (!container.current) return;
    let disposed = false;
    let sessionId: string | null = null;
    const waiting = new Map<string, TerminalData[]>();
    const waitingExits = new Map<string, number>();
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 12,
      fontFamily: "'Cascadia Code', 'SFMono-Regular', Consolas, monospace",
      scrollback: 5000,
      theme: {
        background: "#0d0913",
        foreground: "#ded4e9",
        cursor: "#c8a4f4",
        selectionBackground: "#6f4b9b77",
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current);
    const resize = () => {
      if (
        disposed ||
        !container.current?.clientHeight ||
        !container.current.clientWidth
      )
        return;
      fit.fit();
      if (sessionId)
        void window.witch.terminal
          .resize(sessionId, terminal.cols, terminal.rows)
          .catch(() => undefined);
    };
    resizeRef.current = resize;
    const observer = new ResizeObserver(resize);
    observer.observe(container.current);
    const input = terminal.onData((data) => {
      if (sessionId)
        void window.witch.terminal
          .write(sessionId, data)
          .catch((error) => terminal.writeln(`\r\n${error}`));
    });
    const unsubscribe = window.witch.terminal.onData(
      ({ id, data, sequence }) => {
        if (sessionId === id) terminal.write(data);
        else if (!sessionId) {
          const pending = waiting.get(id) || [];
          if (pending.length < 1000) pending.push({ id, data, sequence });
          waiting.set(id, pending);
        }
      },
    );
    const exit = window.witch.terminal.onExit(({ id, exitCode }) => {
      if (id === sessionId) {
        terminal.writeln(`\r\n[Process exited with code ${exitCode}]`);
        labelRef.current(`${label} · exited`);
      } else if (!sessionId) waitingExits.set(id, exitCode);
    });
    const start = existing
      ? window.witch.terminal.attach(existing)
      : task
        ? window.witch.terminal.runTask(task.id, task.activeFile)
        : window.witch.terminal.create({ cols: 100, rows: 18 });
    void start
      .then((session) => {
        if (disposed) {
          void window.witch.terminal.close(session.id);
          return;
        }
        sessionId = session.id;
        if (session.buffer) terminal.write(session.buffer);
        for (const chunk of waiting.get(session.id) || [])
          if (chunk.sequence > session.sequence) terminal.write(chunk.data);
        waiting.clear();
        labelRef.current(session.shell.split(/[\\/]/).at(-1) || label);
        if (waitingExits.has(session.id)) {
          terminal.writeln(
            `\r\n[Process exited with code ${waitingExits.get(session.id)}]`,
          );
          labelRef.current(`${label} · exited`);
        }
        waitingExits.clear();
        resize();
      })
      .catch((error) => {
        if (!disposed)
          terminal.writeln(
            `\r\nTerminal could not start: ${error instanceof Error ? error.message : error}`,
          );
      });
    return () => {
      disposed = true;
      observer.disconnect();
      input.dispose();
      unsubscribe();
      exit();
      if (sessionId)
        void window.witch.terminal.close(sessionId).catch(() => undefined);
      terminal.dispose();
    };
  }, []);
  useEffect(() => {
    if (active) requestAnimationFrame(() => resizeRef.current());
  }, [active]);
  return (
    <div
      className="terminal-instance"
      ref={container}
      style={{ display: active ? "block" : "none" }}
      aria-label={label}
    />
  );
}

export function TerminalPanel({
  root,
  activeFile,
  onConfigure,
  height,
  maximumHeight,
  onHeightChange,
  onHeightCommit,
}: {
  root: string | undefined;
  activeFile?: string;
  onConfigure: () => void;
  height: number;
  maximumHeight: number;
  onHeightChange: (height: number) => void;
  onHeightCommit: (height: number) => void;
}) {
  const [tabs, setTabs] = useState<
    {
      id: number;
      label: string;
      existing?: string;
      task?: { id: string; activeFile?: string };
    }[]
  >([]);
  const [tasks, setTasks] = useState<ProjectTask[]>([]);
  const [selected, setSelected] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const counter = useRef(0);
  function add(task?: ProjectTask) {
    const id = ++counter.current;
    setTabs((previous) => [
      ...previous,
      {
        id,
        label: task?.label || `Terminal ${id}`,
        ...(task ? { task: { id: task.id, activeFile } } : {}),
      },
    ]);
    setSelected(id);
    setCollapsed(false);
  }
  useEffect(() => {
    setTabs([]);
    setSelected(0);
    let disposed = false;
    setRestoring(Boolean(root));
    if (root)
      void window.witch.terminal
        .list()
        .then((sessions) => {
          if (disposed) return;
          const restored = sessions.map((session) => ({
            id: ++counter.current,
            label: session.shell.split(/[\\/]/).at(-1) || session.shell,
            existing: session.id,
          }));
          setTabs(restored);
          setSelected(restored.at(-1)?.id || 0);
        })
        .finally(() => {
          if (!disposed) setRestoring(false);
        })
        .catch(() => undefined);
    const refresh = () => {
      void window.witch.execution
        .catalog()
        .then((catalog) => {
          if (!disposed) setTasks(catalog.tasks);
        })
        .catch(() => undefined);
    };
    refresh();
    const off = window.witch.workspace.onChanged((event) => {
      if (
        event.root === root &&
        event.paths.some(
          (path) => path.endsWith("tasks.json") || path === "package.json",
        )
      )
        refresh();
    });
    return () => {
      disposed = true;
      off();
    };
  }, [root]);
  function close(id: number) {
    const remaining = tabs.filter((tab) => tab.id !== id);
    setTabs(remaining);
    if (selected === id) setSelected(remaining.at(-1)?.id || 0);
  }
  return (
    <>
      {!collapsed && (
        <PanelDivider
          label="Resize terminal"
          orientation="horizontal"
          value={height}
          minimum={120}
          maximum={maximumHeight}
          defaultValue={200}
          reverse
          onChange={onHeightChange}
          onCommit={onHeightCommit}
        />
      )}
      <section
        className={`terminal-panel ${collapsed ? "collapsed" : ""}`}
        aria-label="Integrated terminals"
        style={{ height: collapsed ? 36 : height }}
      >
        <header className="terminal-header">
          <TerminalSquare size={13} />
          <strong>Terminal</strong>
          <select
            className="task-picker"
            aria-label="Run project task"
            value=""
            disabled={!root || restoring || tabs.length >= 8}
            onChange={(event) => {
              const task = tasks.find((item) => item.id === event.target.value);
              if (task) add(task);
            }}
          >
            <option value="">Run task…</option>
            {tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.label}
              </option>
            ))}
          </select>
          <button
            onClick={onConfigure}
            disabled={!root}
            aria-label="Edit tasks"
          >
            ⚙
          </button>
          <div className="terminal-tab-list">
            {tabs.map((tab) => (
              <div
                className={
                  tab.id === selected ? "terminal-tab selected" : "terminal-tab"
                }
                key={tab.id}
              >
                <button
                  onClick={() => {
                    setSelected(tab.id);
                    setCollapsed(false);
                  }}
                >
                  {tab.label}
                </button>
                <button
                  aria-label={`Close terminal ${tab.id}`}
                  onClick={() => close(tab.id)}
                >
                  <X size={10} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => add()}
            disabled={tabs.length >= 8 || !root || restoring}
            aria-label="New terminal"
            title="New terminal"
          >
            <Plus size={14} />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand terminal" : "Collapse terminal"}
          >
            {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </header>
        <div className="terminal-content" hidden={collapsed}>
          {!tabs.length && (
            <div className="terminal-placeholder">
              <span>A local shell, inside your project.</span>
              <button onClick={() => add()} disabled={!root || restoring}>
                Open terminal
              </button>
            </div>
          )}
          {tabs.map((tab) => (
            <TerminalView
              key={`${root}:${tab.id}`}
              label={tab.label}
              task={tab.task}
              existing={tab.existing}
              active={tab.id === selected && !collapsed}
              onLabel={(label) =>
                setTabs((previous) =>
                  previous.map((item) =>
                    item.id === tab.id ? { ...item, label } : item,
                  ),
                )
              }
            />
          ))}
        </div>
      </section>
    </>
  );
}
