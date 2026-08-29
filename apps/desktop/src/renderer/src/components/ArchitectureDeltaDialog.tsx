import type {
  ArchitectureDelta,
  ArchitectureDeltaCollection,
  ArchitectureEdgeChange,
  ArchitectureEdgeSummary,
  ArchitectureNodeChange,
  ArchitectureNodeSummary,
} from "../../../shared/architecture-delta";

function countLabel(value: number, label: string) {
  return `${value} ${label}${value === 1 ? "" : "s"}`;
}

function factLabel(field: string) {
  return field === "evidenceFingerprint" ? "evidence" : field;
}

function NodeList({
  title,
  collection,
  tone,
  onOpenFile,
}: {
  title: string;
  collection: ArchitectureDeltaCollection<
    ArchitectureNodeSummary | ArchitectureNodeChange
  >;
  tone: "added" | "changed" | "removed";
  onOpenFile: (path: string) => void;
}) {
  return (
    <section className={`delta-section delta-${tone}`}>
      <h3>
        {title} <span>{collection.total}</span>
      </h3>
      <div className="delta-list">
        {collection.items.slice(0, 80).map((item) => {
          const changed = "before" in item;
          const summary = changed ? item.after : item;
          return (
            <button
              key={`${tone}:${item.id}`}
              disabled={!summary.path || tone === "removed"}
              onClick={() =>
                tone !== "removed" && summary.path && onOpenFile(summary.path)
              }
            >
              <strong>{summary.path || summary.label}</strong>
              <small>
                {changed
                  ? `Changed ${item.fields.join(", ")}`
                  : `${summary.module} · ${summary.language}`}
              </small>
            </button>
          );
        })}
        {!collection.total && <p>No {title.toLowerCase()}.</p>}
        {(collection.truncated || collection.total > 80) && (
          <p>
            Showing {Math.min(collection.items.length, 80)}/{collection.total}{" "}
            exact changes.
          </p>
        )}
      </div>
    </section>
  );
}

function EdgeList({
  title,
  collection,
}: {
  title: string;
  collection: ArchitectureDeltaCollection<
    ArchitectureEdgeSummary | ArchitectureEdgeChange
  >;
}) {
  return (
    <details className="delta-edge-section">
      <summary>
        {title} · {collection.total}
      </summary>
      {collection.items.slice(0, 80).map((item) => {
        const changed = "before" in item;
        const summary = changed ? item.after : item;
        return (
          <div key={`${title}:${item.id}`}>
            <code>
              {summary.from} → {summary.to}
            </code>
            <small>
              {changed
                ? `Changed ${item.fields.map(factLabel).join(", ")}`
                : `${summary.kind} · ${summary.evidenceCount} evidence`}
            </small>
          </div>
        );
      })}
      {!collection.total && <p>No changes.</p>}
    </details>
  );
}

export function ArchitectureDeltaDialog({
  delta,
  onClose,
  onOpenFile,
}: {
  delta: ArchitectureDelta;
  onClose: () => void;
  onOpenFile: (path: string) => void;
}) {
  const total = Object.values(delta.summary).reduce(
    (sum, count) => sum + count,
    0,
  );
  return (
    <div className="architecture-delta-backdrop">
      <section
        className="architecture-delta-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Architecture delta"
      >
        <header>
          <div>
            <span className="eyebrow">Verified architecture snapshots</span>
            <h2>Before · Delta · After</h2>
          </div>
          <button onClick={onClose} aria-label="Close architecture delta">
            ×
          </button>
        </header>
        <div className="delta-timeline">
          <section>
            <span>Before</span>
            <strong>{delta.base.revision.slice(0, 8)}</strong>
            <small>
              {delta.base.nodeCount} nodes · {delta.base.edgeCount} relations
            </small>
          </section>
          <section className="delta-center">
            <span>Delta</span>
            <strong>{countLabel(total, "fact")}</strong>
            <small>Authored topology only · no impact inference</small>
          </section>
          <section>
            <span>After</span>
            <strong>{delta.head.revision.slice(0, 8)}</strong>
            <small>
              {delta.head.nodeCount} nodes · {delta.head.edgeCount} relations
            </small>
          </section>
        </div>
        <div className="delta-summary">
          <span>+{delta.summary.addedNodes} nodes</span>
          <span>~{delta.summary.changedNodes} nodes</span>
          <span>−{delta.summary.removedNodes} nodes</span>
          <span>+{delta.summary.addedEdges} relations</span>
          <span>~{delta.summary.changedEdges} relations</span>
          <span>−{delta.summary.removedEdges} relations</span>
        </div>
        <div className="delta-node-grid">
          <NodeList
            title="Added nodes"
            tone="added"
            collection={delta.nodes.added}
            onOpenFile={onOpenFile}
          />
          <NodeList
            title="Changed nodes"
            tone="changed"
            collection={delta.nodes.changed}
            onOpenFile={onOpenFile}
          />
          <NodeList
            title="Removed nodes"
            tone="removed"
            collection={delta.nodes.removed}
            onOpenFile={onOpenFile}
          />
        </div>
        <div className="delta-edge-grid">
          <EdgeList title="Added relations" collection={delta.edges.added} />
          <EdgeList
            title="Changed relations"
            collection={delta.edges.changed}
          />
          <EdgeList
            title="Removed relations"
            collection={delta.edges.removed}
          />
        </div>
      </section>
    </div>
  );
}
