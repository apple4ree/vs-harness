import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { DiffEditor } from "@monaco-editor/react";
import {
  languageFor,
  monaco,
  restoreMonacoHoverFactory,
} from "./editor-runtime";
import type { GraphImpactReviewReceipt } from "../../../shared/agent-graph-tools";
import "./review.css";

export type ReviewFile = {
  path: string;
  before: string | null;
  after: string | null;
};

export function ReviewDialog({
  title,
  files,
  onClose,
  onApply,
  applyLabel = "Apply selected changes",
  description,
  impact,
}: {
  title: string;
  files: ReviewFile[];
  description?: string;
  impact?: GraphImpactReviewReceipt;
  onClose: () => void;
  onApply: (paths: string[]) => Promise<void>;
  applyLabel?: string;
}) {
  const [selected, setSelected] = useState(
    () => new Set(files.map((file) => file.path)),
  );
  const [activePath, setActivePath] = useState(files[0]?.path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const diff = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  useLayoutEffect(
    () => () => {
      const editor = diff.current;
      if (!editor) return;
      const model = editor.getModel();
      editor.setModel(null);
      if (model) {
        if (!model.original.isDisposed()) model.original.dispose();
        if (!model.modified.isDisposed()) model.modified.dispose();
      }
      diff.current = null;
    },
    [],
  );
  const active = files.find((file) => file.path === activePath) || files[0];
  useEffect(() => {
    container.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [busy, onClose]);
  async function apply() {
    setBusy(true);
    setError("");
    try {
      await onApply([...selected]);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="review-backdrop">
      <div
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={container}
        tabIndex={-1}
      >
        <header>
          <div>
            <span className="eyebrow">Review before applying</span>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close review">
            ×
          </button>
        </header>
        <p>
          {description ||
            "Left: current baseline. Right: proposed content. Only checked files will be changed."}
        </p>
        {impact && (
          <section
            className={`review-impact risk-${impact.risk.level}`}
            aria-label="Graph impact receipt"
          >
            <div>
              <span className="eyebrow">Graph impact · immutable receipt</span>
              <strong>
                {impact.risk.level} risk · {impact.risk.score}/100
              </strong>
            </div>
            <dl>
              <div>
                <dt>Resolved</dt>
                <dd>{impact.changedNodeIds.length} changed nodes</dd>
              </div>
              <div>
                <dt>Affected</dt>
                <dd>{impact.affectedCount} downstream nodes</dd>
              </div>
              <div>
                <dt>Boundaries</dt>
                <dd>
                  {impact.componentIds.length} components ·{" "}
                  {impact.workflowIds.length} workflows
                </dd>
              </div>
              <div>
                <dt>Tests</dt>
                <dd>{impact.suggestedTestPaths.length} graph-linked paths</dd>
              </div>
            </dl>
            {(impact.unresolvedInputs.length > 0 || impact.truncated) && (
              <small>
                {impact.unresolvedInputs.length
                  ? `${impact.unresolvedInputs.length} changed path(s) are outside the current graph. `
                  : ""}
                {impact.truncated
                  ? `${impact.omittedAffected} affected node(s) omitted from this bounded receipt.`
                  : ""}
              </small>
            )}
            {!!impact.suggestedTestPaths.length && (
              <details>
                <summary>Suggested verification targets</summary>
                <ul>
                  {impact.suggestedTestPaths.map((testPath) => (
                    <li key={testPath}>{testPath}</li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        )}
        <div className="review-body">
          <nav aria-label="Changed files">
            {files.map((file) => (
              <div
                key={file.path}
                className={
                  active?.path === file.path
                    ? "review-file selected"
                    : "review-file"
                }
              >
                <input
                  type="checkbox"
                  checked={selected.has(file.path)}
                  disabled={busy}
                  aria-label={`Apply ${file.path}`}
                  onChange={(event) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (event.target.checked) next.add(file.path);
                      else next.delete(file.path);
                      return next;
                    })
                  }
                />
                <button onClick={() => setActivePath(file.path)}>
                  <b>
                    {file.before === null
                      ? "+"
                      : file.after === null
                        ? "−"
                        : "M"}
                  </b>
                  <span>{file.path}</span>
                </button>
              </div>
            ))}
          </nav>
          <div className="review-diff">
            {active && (
              <>
                <div className="diff-caption">
                  {active.path} ·{" "}
                  {active.before === null
                    ? "new file"
                    : active.after === null
                      ? "deleted file"
                      : "modified"}
                </div>
                <DiffEditor
                  keepCurrentOriginalModel
                  keepCurrentModifiedModel
                  onMount={(editor) => {
                    restoreMonacoHoverFactory();
                    diff.current = editor;
                    editor.onDidDispose(() => {
                      if (diff.current === editor) diff.current = null;
                    });
                  }}
                  original={active.before || ""}
                  modified={active.after || ""}
                  language={languageFor(active.path)}
                  theme={`witch-${document.documentElement.dataset.theme || "night"}`}
                  options={{
                    readOnly: true,
                    originalEditable: false,
                    automaticLayout: true,
                    minimap: { enabled: false },
                    renderSideBySide: true,
                    scrollBeyondLastLine: false,
                    fontSize: 12,
                  }}
                />
              </>
            )}
          </div>
        </div>
        {error && (
          <div role="alert" className="inline-error">
            {error}
          </div>
        )}
        <footer>
          <span>
            {selected.size} of {files.length} files selected
          </span>
          <button
            className="primary-action"
            disabled={busy || !selected.size}
            onClick={() => void apply()}
          >
            {busy ? "Applying…" : applyLabel}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
