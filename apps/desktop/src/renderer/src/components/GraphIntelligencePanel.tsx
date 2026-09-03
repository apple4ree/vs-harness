import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Ban,
  Boxes,
  CircleHelp,
  GitBranch,
  History,
  LoaderCircle,
  Network,
  Route,
  Search,
  Share2,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import {
  componentContext,
  type ArchitectureGraph,
  type ComponentContext,
} from "../../../shared/architecture";
import {
  analyzeGraphImpact,
  buildGraphIntelligenceIndex,
  createArchitectureBrief,
  projectGraphCommunities,
  queryArchitectureGraph,
  type GraphImpactReceipt,
  type GraphIntelligenceNode,
  type GraphQueryReceipt,
} from "../../../shared/graph-intelligence";
import {
  buildArchitectureMetaGraph,
  projectArchitectureMetaFrame,
  type ArchitectureMetaNode,
} from "../../../shared/graph-meta";
import type {
  ArchitectureFederation,
  FederationApprovalHistoryEntry,
  FederationCandidate,
} from "../../../shared/federation";
import "./graph-intelligence.css";

type IntelligenceTab =
  "query" | "brief" | "map" | "federation" | "knowledge" | "communities";

const META_CARD_WIDTH = 190;
const META_CARD_HEIGHT = 82;
const META_COLUMN_GAP = 28;
const META_ROW_GAP = 18;

function metaNodeSummary(node: ArchitectureMetaNode) {
  const kinds = Object.entries(node.kindCounts)
    .sort(
      ([left], [right]) =>
        ["component", "module", "workflow", "workflow-step", "symbol"].indexOf(
          left,
        ) -
          [
            "component",
            "module",
            "workflow",
            "workflow-step",
            "symbol",
          ].indexOf(right) || left.localeCompare(right),
    )
    .filter(([, count]) => count > 0)
    .slice(0, 3)
    .map(([kind, count]) => `${count} ${kind}`);
  return kinds.join(" · ") || `${node.memberCount} structural members`;
}

function sourcePaths(node: GraphIntelligenceNode) {
  return [
    ...new Set(
      [node.path, ...node.evidence.map((item) => item.path)].filter(
        (item): item is string => Boolean(item),
      ),
    ),
  ];
}

function errorMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

function workspaceName(root: string) {
  return root.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) || root;
}

function approvalMapStatus(
  entry: FederationApprovalHistoryEntry,
  federation: ArchitectureFederation | null,
) {
  if (entry.status === "revoked") return "revoked";
  if (federation?.approvals.some((item) => item.id === entry.approval.id))
    return "applied";
  if (!federation) return "active";
  const subject = federation.repositories.find(
    (item) => item.workspaceRoot === entry.approval.subjectWorkspaceRoot,
  );
  const provider = federation.repositories.find(
    (item) => item.workspaceRoot === entry.approval.providerWorkspaceRoot,
  );
  if (!subject || !provider) return "out of current map";
  if (
    subject.sourceRevision !== entry.approval.subjectSourceRevision ||
    provider.sourceRevision !== entry.approval.providerSourceRevision
  )
    return "stale";
  return "superseded";
}

export function GraphIntelligencePanel({
  graph,
  onOpenFile,
  onAttach,
  onClose,
}: {
  graph: ArchitectureGraph;
  onOpenFile: (path: string, line?: number) => void;
  onAttach: (context: ComponentContext) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<IntelligenceTab>("query");
  const [query, setQuery] = useState("");
  const [depth, setDepth] = useState(2);
  const [tokenBudget, setTokenBudget] = useState(2_000);
  const [direction, setDirection] = useState<
    "upstream" | "downstream" | "both"
  >("both");
  const [receipt, setReceipt] = useState<GraphQueryReceipt | null>(null);
  const [impact, setImpact] = useState<GraphImpactReceipt | null>(null);
  const [metaFocusId, setMetaFocusId] = useState<string | null>(null);
  const [federationCandidates, setFederationCandidates] = useState<
    FederationCandidate[]
  >([]);
  const [federationApprovals, setFederationApprovals] = useState<
    FederationApprovalHistoryEntry[]
  >([]);
  const [pendingRevokeApprovalId, setPendingRevokeApprovalId] = useState<
    string | null
  >(null);
  const [selectedSnapshots, setSelectedSnapshots] = useState<string[]>([]);
  const [federation, setFederation] = useState<ArchitectureFederation | null>(
    null,
  );
  const [federationBusy, setFederationBusy] = useState(false);
  const [federationError, setFederationError] = useState("");
  const index = useMemo(
    () => buildGraphIntelligenceIndex(graph),
    [
      graph.revision,
      graph.semantic?.revision,
      graph.behavior?.revision,
      graph.knowledge?.revision,
    ],
  );
  const communities = useMemo(
    () => projectGraphCommunities(graph),
    [
      graph.revision,
      graph.semantic?.revision,
      graph.behavior?.revision,
      graph.knowledge?.revision,
    ],
  );
  const brief = useMemo(
    () => createArchitectureBrief(graph, communities),
    [
      communities,
      graph.revision,
      graph.semantic?.revision,
      graph.behavior?.revision,
      graph.knowledge?.revision,
    ],
  );
  const metaGraph = useMemo(
    () => buildArchitectureMetaGraph(graph, communities),
    [
      communities,
      graph.revision,
      graph.semantic?.revision,
      graph.behavior?.revision,
      graph.knowledge?.revision,
    ],
  );
  const metaFrame = useMemo(
    () =>
      projectArchitectureMetaFrame(metaGraph, metaFocusId || metaGraph.rootId),
    [metaGraph, metaFocusId],
  );
  const metaNodeById = useMemo(
    () => new Map(metaGraph.nodes.map((node) => [node.id, node])),
    [metaGraph],
  );
  const nodes = useMemo(
    () => new Map(index.nodes.map((node) => [node.id, node])),
    [index],
  );

  useEffect(() => {
    setFederation(null);
    setFederationError("");
  }, [graph.revision]);

  useEffect(() => {
    if (tab !== "federation") return;
    let active = true;
    setFederationBusy(true);
    setFederationError("");
    void Promise.all([
      window.witch.analysis.federationCandidates(),
      window.witch.analysis.federationApprovals(),
    ])
      .then(([candidates, approvals]) => {
        if (!active) return;
        setFederationCandidates(candidates);
        setFederationApprovals(approvals);
        setSelectedSnapshots((current) => {
          const available = new Set(
            candidates.map((candidate) => candidate.snapshotId),
          );
          const retained = current.filter((id) => available.has(id));
          return retained.length
            ? retained
            : candidates.slice(0, 4).map((candidate) => candidate.snapshotId);
        });
      })
      .catch((reason) => {
        if (active) setFederationError(errorMessage(reason));
      })
      .finally(() => {
        if (active) setFederationBusy(false);
      });
    return () => {
      active = false;
    };
  }, [graph.workspaceRoot, tab]);

  const runQuery = (event?: FormEvent) => {
    event?.preventDefault();
    setReceipt(
      queryArchitectureGraph(graph, {
        query,
        depth,
        tokenBudget,
        direction,
      }),
    );
    setImpact(null);
  };
  const inspectImpact = (nodeId: string) => {
    setImpact(
      analyzeGraphImpact(graph, {
        changedNodeIds: [nodeId],
        maxDepth: Math.max(3, depth),
      }),
    );
  };
  const attach = (node: GraphIntelligenceNode) => {
    const semantic = graph.semantic?.nodes.find((item) => item.id === node.id);
    onAttach(
      componentContext(
        node.id,
        node.label,
        sourcePaths(node),
        graph.revision,
        node.line,
        semantic
          ? {
              kind: semantic.kind,
              trust: semantic.trust,
              status: semantic.status,
              confidence: semantic.confidence,
            }
          : undefined,
      ),
    );
  };
  const openSource = (node: GraphIntelligenceNode) => {
    const evidence = node.evidence[0];
    const path = node.path || evidence?.path;
    if (path) onOpenFile(path, node.line || evidence?.line);
  };
  const metaSource = (node: ArchitectureMetaNode) =>
    node.sourceNodeId
      ? nodes.get(node.sourceNodeId)
      : node.hubIds.map((id) => nodes.get(id)).find(Boolean);
  const metaColumns = Math.min(
    4,
    Math.max(
      1,
      Math.ceil(Math.sqrt(Math.max(1, metaFrame.nodes.length) * 1.7)),
    ),
  );
  const metaRows = Math.max(1, Math.ceil(metaFrame.nodes.length / metaColumns));
  const metaStageWidth =
    260 + metaColumns * (META_CARD_WIDTH + META_COLUMN_GAP);
  const metaStageHeight = Math.max(
    120,
    20 + metaRows * (META_CARD_HEIGHT + META_ROW_GAP),
  );
  const metaFocusPosition = {
    x: 18,
    y: Math.max(18, Math.round((metaStageHeight - META_CARD_HEIGHT) / 2)),
  };
  const metaPositions = new Map(
    metaFrame.nodes.map((node, index) => [
      node.id,
      {
        x: 260 + (index % metaColumns) * (META_CARD_WIDTH + META_COLUMN_GAP),
        y:
          18 +
          Math.floor(index / metaColumns) * (META_CARD_HEIGHT + META_ROW_GAP),
      },
    ]),
  );
  const buildFederation = async () => {
    setFederationBusy(true);
    setFederationError("");
    try {
      setFederation(await window.witch.analysis.federate(selectedSnapshots));
    } catch (reason) {
      setFederation(null);
      setFederationError(errorMessage(reason));
    } finally {
      setFederationBusy(false);
    }
  };
  const toggleFederationCandidate = (snapshotId: string) => {
    setFederation(null);
    setSelectedSnapshots((current) =>
      current.includes(snapshotId)
        ? current.filter((id) => id !== snapshotId)
        : current.length < 11
          ? [...current, snapshotId]
          : current,
    );
  };
  const approveFederationProvider = async (
    questionId: string,
    providerRepositoryId: string,
  ) => {
    if (!federation) return;
    setFederationBusy(true);
    setFederationError("");
    try {
      const resolved = await window.witch.analysis.approveFederation({
        snapshotIds: selectedSnapshots,
        federationRevision: federation.revision,
        questionId,
        providerRepositoryId,
      });
      setFederation(resolved);
      setFederationApprovals(await window.witch.analysis.federationApprovals());
    } catch (reason) {
      setFederationError(errorMessage(reason));
    } finally {
      setFederationBusy(false);
    }
  };
  const revokeFederationApproval = async (approvalId: string) => {
    setFederationBusy(true);
    setFederationError("");
    try {
      setFederationApprovals(
        await window.witch.analysis.revokeFederationApproval(approvalId),
      );
      setPendingRevokeApprovalId(null);
      if (federation)
        setFederation(await window.witch.analysis.federate(selectedSnapshots));
    } catch (reason) {
      setFederationError(errorMessage(reason));
    } finally {
      setFederationBusy(false);
    }
  };

  return (
    <section
      className="graph-intelligence-panel"
      aria-label="Graph Intelligence"
    >
      <header className="graph-intelligence-header">
        <div>
          <span className="eyebrow">
            <Sparkles size={12} /> derived reading ·{" "}
            {graph.revision.slice(0, 8)}
          </span>
          <strong>Graph Intelligence</strong>
          <small>Query, structure, and impact without mutating evidence.</small>
        </div>
        <nav aria-label="Graph Intelligence views">
          <button
            className={tab === "query" ? "active" : ""}
            onClick={() => setTab("query")}
          >
            <Search size={13} /> Query
          </button>
          <button
            className={tab === "brief" ? "active" : ""}
            onClick={() => setTab("brief")}
          >
            <Route size={13} /> Brief
          </button>
          <button
            className={tab === "map" ? "active" : ""}
            onClick={() => setTab("map")}
          >
            <Network size={13} /> Map
            <small>
              {
                metaGraph.nodes.filter((node) => node.level === "community")
                  .length
              }
            </small>
          </button>
          <button
            className={tab === "federation" ? "active" : ""}
            onClick={() => setTab("federation")}
          >
            <Share2 size={13} /> Federation
            {federation?.links.length ? (
              <small>{federation.links.length}</small>
            ) : null}
          </button>
          <button
            className={tab === "knowledge" ? "active" : ""}
            onClick={() => setTab("knowledge")}
          >
            <BookOpen size={13} /> Knowledge
            {graph.knowledge?.nodes.length ? (
              <small>{graph.knowledge.nodes.length}</small>
            ) : null}
          </button>
          <button
            className={tab === "communities" ? "active" : ""}
            onClick={() => setTab("communities")}
          >
            <Boxes size={13} /> Communities
          </button>
        </nav>
        <button
          className="graph-intelligence-close"
          onClick={onClose}
          aria-label="Close Graph Intelligence"
        >
          <X size={15} />
        </button>
      </header>

      {tab === "query" && (
        <div className="graph-query-workbench">
          <form className="graph-query-form" onSubmit={runQuery}>
            <label className="graph-query-input">
              <Search size={14} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Ask for a symbol, workflow, path, or responsibility…"
                aria-label="Graph query"
              />
            </label>
            <label>
              <span>Direction</span>
              <select
                value={direction}
                onChange={(event) =>
                  setDirection(event.target.value as typeof direction)
                }
              >
                <option value="both">Both</option>
                <option value="upstream">Upstream</option>
                <option value="downstream">Downstream</option>
              </select>
            </label>
            <label>
              <span>Depth</span>
              <select
                value={depth}
                onChange={(event) => setDepth(Number(event.target.value))}
              >
                {[1, 2, 3, 4].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Budget</span>
              <select
                value={tokenBudget}
                onChange={(event) => setTokenBudget(Number(event.target.value))}
              >
                <option value={512}>512</option>
                <option value={1000}>1,000</option>
                <option value={2000}>2,000</option>
                <option value={4000}>4,000</option>
              </select>
            </label>
            <button type="submit" disabled={!query.trim()}>
              Build context
            </button>
          </form>

          {!receipt ? (
            <div className="graph-intelligence-empty">
              <Network size={24} />
              <div>
                <strong>Evidence before explanation</strong>
                <p>
                  Search builds a bounded graph packet. It preserves typed
                  directions, source locations, confidence, and ambiguity for
                  Codex, Claude, or direct inspection.
                </p>
              </div>
            </div>
          ) : (
            <div className="graph-query-results">
              <div className="graph-query-receipt">
                <span>{receipt.seeds.length} seeds</span>
                <span>{receipt.nodes.length} nodes</span>
                <span>{receipt.relations.length} relations</span>
                <span>
                  {receipt.estimatedTokens}/{receipt.tokenBudget} tokens
                </span>
                <span>depth {receipt.depth}</span>
                {receipt.truncated && <strong>bounded · truncated</strong>}
              </div>
              {receipt.ambiguities.map((ambiguity) => (
                <p className="graph-query-warning" key={ambiguity.term}>
                  <CircleHelp size={13} /> {ambiguity.message}
                </p>
              ))}
              {receipt.notices.map((notice) => (
                <p className="graph-query-notice" key={notice}>
                  {notice}
                </p>
              ))}
              <div className="graph-query-columns">
                <div className="graph-query-node-list">
                  {receipt.nodes.map((node) => (
                    <article
                      key={node.id}
                      className={node.depth === 0 ? "is-seed" : ""}
                    >
                      <header>
                        <span>{node.kind}</span>
                        <small>
                          {node.trust} · {Math.round(node.confidence * 100)}% ·
                          hop {node.depth}
                        </small>
                      </header>
                      <strong>{node.label}</strong>
                      <code>{node.path || node.id}</code>
                      <p>{node.description || node.reasons.join(" · ")}</p>
                      <footer>
                        <button onClick={() => inspectImpact(node.id)}>
                          <GitBranch size={11} /> Impact
                        </button>
                        {sourcePaths(node).length > 0 && (
                          <button onClick={() => attach(node)}>
                            Add context
                          </button>
                        )}
                        {(node.path || node.evidence[0]) && (
                          <button onClick={() => openSource(node)}>
                            Source <ArrowUpRight size={11} />
                          </button>
                        )}
                      </footer>
                    </article>
                  ))}
                </div>
                <aside className="graph-query-evidence">
                  {impact ? (
                    <>
                      <header>
                        <span>Typed impact</span>
                        <strong className={`risk-${impact.risk.level}`}>
                          {impact.risk.level} · {impact.risk.score}/100
                        </strong>
                      </header>
                      <p>
                        {impact.affected.length} affected ·{" "}
                        {impact.workflows.length} workflows ·{" "}
                        {impact.components.length} components
                      </p>
                      {impact.workflows.slice(0, 6).map((node) => (
                        <button key={node.id} onClick={() => openSource(node)}>
                          <strong>{node.label}</strong>
                          <small>
                            workflow · hop {node.depth} ·{" "}
                            {node.relationPath.length} evidence links
                          </small>
                        </button>
                      ))}
                      {impact.components.slice(0, 6).map((node) => (
                        <button key={node.id} onClick={() => openSource(node)}>
                          <strong>{node.label}</strong>
                          <small>
                            component · hop {node.depth} ·{" "}
                            {node.relationPath.length} evidence links
                          </small>
                        </button>
                      ))}
                      {impact.suggestedTestPaths.length > 0 && (
                        <section>
                          <strong>Suggested tests</strong>
                          {impact.suggestedTestPaths.slice(0, 8).map((path) => (
                            <button key={path} onClick={() => onOpenFile(path)}>
                              {path}
                            </button>
                          ))}
                        </section>
                      )}
                    </>
                  ) : (
                    <>
                      <header>
                        <span>Evidence packet</span>
                        <strong>{receipt.direction}</strong>
                      </header>
                      {receipt.relations.slice(0, 24).map((relation) => (
                        <button
                          key={relation.id}
                          onClick={() => {
                            const evidence = relation.evidence[0];
                            if (evidence)
                              onOpenFile(evidence.path, evidence.line);
                          }}
                        >
                          <strong>
                            {nodes.get(relation.from)?.label || relation.from} →{" "}
                            {nodes.get(relation.to)?.label || relation.to}
                          </strong>
                          <small>
                            {relation.kind} · {relation.trust} ·{" "}
                            {Math.round(relation.confidence * 100)}%
                          </small>
                        </button>
                      ))}
                    </>
                  )}
                </aside>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "brief" && (
        <div className="architecture-brief">
          <div className="architecture-brief-metrics">
            {[
              ["Files", brief.summary.files],
              ["Graph nodes", brief.summary.nodes],
              ["Relations", brief.summary.relations],
              ["Verified", brief.summary.verifiedRelations],
              ["Inferred", brief.summary.inferredRelations],
              ["Communities", brief.communities.length],
              ["Cycles", brief.cycles.length],
              ["Questions", brief.questions.length],
              ["Decisions", brief.knowledge?.decisions || 0],
              ["Packages", brief.knowledge?.packages || 0],
            ].map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="architecture-brief-columns">
            <section>
              <h4>Structural hubs</h4>
              {brief.hubs.slice(0, 10).map((hub) => (
                <button
                  key={hub.nodeId}
                  onClick={() =>
                    nodes.get(hub.nodeId) && openSource(nodes.get(hub.nodeId)!)
                  }
                >
                  <strong>{hub.label}</strong>
                  <small>{hub.degree} typed relations</small>
                </button>
              ))}
            </section>
            <section>
              <h4>Community bridges</h4>
              {brief.bridges.length ? (
                brief.bridges.slice(0, 10).map((bridge) => (
                  <button
                    key={bridge.nodeId}
                    onClick={() =>
                      nodes.get(bridge.nodeId) &&
                      openSource(nodes.get(bridge.nodeId)!)
                    }
                  >
                    <strong>{bridge.label}</strong>
                    <small>
                      touches {bridge.communityIds.length} communities ·{" "}
                      {bridge.degree} relations
                    </small>
                  </button>
                ))
              ) : (
                <p>No cross-community bridge is present.</p>
              )}
            </section>
            <section>
              <h4>Cycles & questions</h4>
              {brief.cycles.slice(0, 5).map((cycle) => (
                <div
                  className="architecture-cycle"
                  key={cycle.nodeIds.join(":")}
                >
                  <ShieldAlert size={13} />
                  <span>
                    {cycle.nodeIds
                      .map((id) => nodes.get(id)?.label || id)
                      .join(" → ")}
                  </span>
                </div>
              ))}
              {brief.questions.slice(0, 8).map((question) => (
                <div className="architecture-question" key={question.id}>
                  <CircleHelp size={13} />
                  <span>{question.prompt}</span>
                </div>
              ))}
              {!brief.cycles.length && !brief.questions.length && (
                <p>No cycle or unresolved semantic question was found.</p>
              )}
            </section>
          </div>
        </div>
      )}

      {tab === "knowledge" && (
        <div className="architecture-knowledge-view">
          {!graph.knowledge?.nodes.length ? (
            <div className="graph-intelligence-empty">
              <BookOpen size={24} />
              <div>
                <strong>No architecture knowledge detected</strong>
                <p>
                  Add an ADR/RFC directory, package manifest, or recognized
                  project configuration and read the structure again.
                </p>
              </div>
            </div>
          ) : (
            <>
              <header className="architecture-knowledge-summary">
                <div>
                  <strong>
                    {graph.knowledge.validation.decisionCount} decisions ·{" "}
                    {graph.knowledge.validation.packageCount} packages ·{" "}
                    {graph.knowledge.validation.configurationCount} configs
                  </strong>
                  <span>
                    Authored documents and verified manifests remain separate
                    from inferred system links.
                  </span>
                </div>
                <small>{graph.knowledge.revision.slice(0, 12)}</small>
              </header>
              {graph.knowledge.diagnostics.map((diagnostic) => (
                <p
                  className="graph-query-warning"
                  key={`${diagnostic.code}:${diagnostic.subject}`}
                >
                  <CircleHelp size={13} /> {diagnostic.message}
                </p>
              ))}
              <div className="architecture-knowledge-columns">
                {[
                  {
                    title: "Decisions & RFCs",
                    kinds: new Set(["decision", "rfc"]),
                  },
                  {
                    title: "Packages & dependencies",
                    kinds: new Set(["package", "dependency"]),
                  },
                  {
                    title: "Configuration",
                    kinds: new Set(["manifest", "configuration"]),
                  },
                  {
                    title: "Federation mappings",
                    kinds: new Set([
                      "federation-repository",
                      "federation-mapping",
                    ]),
                  },
                ].map((group) => {
                  const items = graph.knowledge!.nodes.filter((node) =>
                    group.kinds.has(node.kind),
                  );
                  return (
                    <section key={group.title}>
                      <h4>
                        {group.title} <small>{items.length}</small>
                      </h4>
                      {items.slice(0, 80).map((node) => {
                        const dependencyCount =
                          graph.knowledge!.relations.filter(
                            (relation) =>
                              relation.from === node.id &&
                              relation.kind === "depends-on",
                          ).length;
                        return (
                          <article key={node.id}>
                            <header>
                              <span>{node.kind}</span>
                              <small>
                                {node.trust} · {node.status}
                              </small>
                            </header>
                            <strong>{node.label}</strong>
                            <code>
                              {node.path || node.ecosystem || node.id}
                            </code>
                            {node.rationale?.decision && (
                              <p>{node.rationale.decision}</p>
                            )}
                            {!node.rationale?.decision && node.description && (
                              <p>{node.description}</p>
                            )}
                            {node.repositoryKey && (
                              <em>repository key · {node.repositoryKey}</em>
                            )}
                            {node.providerRepositoryKey && (
                              <em>provider · {node.providerRepositoryKey}</em>
                            )}
                            {dependencyCount > 0 && (
                              <em>{dependencyCount} declared dependencies</em>
                            )}
                            <footer>
                              <button
                                onClick={() => {
                                  const indexed = nodes.get(node.id);
                                  if (indexed) inspectImpact(indexed.id);
                                  setTab("query");
                                }}
                              >
                                <GitBranch size={11} /> Impact
                              </button>
                              <button
                                onClick={() => {
                                  const indexed = nodes.get(node.id);
                                  if (indexed) attach(indexed);
                                }}
                              >
                                Add context
                              </button>
                              <button
                                onClick={() => {
                                  const indexed = nodes.get(node.id);
                                  if (indexed) openSource(indexed);
                                }}
                              >
                                Source <ArrowUpRight size={11} />
                              </button>
                            </footer>
                          </article>
                        );
                      })}
                      {!items.length && <p>No matching knowledge found.</p>}
                    </section>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "federation" && (
        <div className="architecture-federation-view">
          <aside className="architecture-federation-picker">
            <header>
              <div>
                <strong>Repository readings</strong>
                <span>Latest immutable snapshot per recent project</span>
              </div>
              <small>{selectedSnapshots.length}/11 selected</small>
            </header>
            <article className="federation-candidate is-active">
              <span className="federation-check" aria-hidden="true">
                ●
              </span>
              <div>
                <strong>
                  {graph.workspaceRoot.replaceAll("\\", "/").split("/").at(-1)}
                </strong>
                <code>{graph.workspaceRoot}</code>
                <small>{graph.revision.slice(0, 12)} · active reading</small>
              </div>
            </article>
            {federationCandidates.map((candidate) => (
              <label
                className="federation-candidate"
                key={candidate.snapshotId}
              >
                <input
                  type="checkbox"
                  checked={selectedSnapshots.includes(candidate.snapshotId)}
                  onChange={() =>
                    toggleFederationCandidate(candidate.snapshotId)
                  }
                />
                <div>
                  <strong>{candidate.workspaceName}</strong>
                  <code>{candidate.workspaceRoot}</code>
                  <small>
                    {candidate.nodeCount} nodes · {candidate.edgeCount} edges ·{" "}
                    {candidate.sourceRevision.slice(0, 12)}
                  </small>
                </div>
              </label>
            ))}
            {!federationCandidates.length && !federationBusy && (
              <p>
                No other analyzed project is available. Open another repository,
                run Read structure, then return here.
              </p>
            )}
            <button
              className="federation-build"
              disabled={federationBusy || !selectedSnapshots.length}
              onClick={() => void buildFederation()}
            >
              {federationBusy ? (
                <LoaderCircle className="is-spinning" size={13} />
              ) : (
                <Share2 size={13} />
              )}
              Build federation
            </button>
          </aside>

          <section className="architecture-federation-result">
            {federationError && (
              <p className="graph-query-warning">
                <ShieldAlert size={13} /> {federationError}
              </p>
            )}
            {!federation && !federationError && (
              <div className="graph-intelligence-empty">
                <Share2 size={24} />
                <div>
                  <strong>
                    System boundaries without a synthetic monolith
                  </strong>
                  <p>
                    Select analyzed repositories to match exact package
                    identities. Every local graph and evidence ledger keeps its
                    own revision and root of trust.
                  </p>
                </div>
              </div>
            )}
            {federation && (
              <>
                <header className="architecture-federation-summary">
                  <div>
                    <strong>Multi-repository system map</strong>
                    <span>
                      {federation.repositories.length} repositories ·{" "}
                      {federation.links.length} exact package links ·{" "}
                      {federation.questions.length} unresolved questions ·{" "}
                      {federation.approvals.length} applied approvals
                    </span>
                  </div>
                  <small>
                    {federation.algorithm} · {federation.revision.slice(0, 15)}
                  </small>
                </header>
                <div className="architecture-federation-map">
                  <div className="federation-repository-grid">
                    {federation.repositories.map((repository) => (
                      <article
                        className={
                          repository.role === "active" ? "is-active" : ""
                        }
                        key={repository.id}
                      >
                        <header>
                          <span>{repository.role} repository</span>
                          <small>{repository.metaRevision.slice(0, 8)}</small>
                        </header>
                        <strong>{repository.workspaceName}</strong>
                        <code>{repository.workspaceRoot}</code>
                        {repository.repositoryKey && (
                          <em>key · {repository.repositoryKey}</em>
                        )}
                        <div>
                          <span>{repository.counts.components} components</span>
                          <span>{repository.counts.workflows} workflows</span>
                          <span>
                            {repository.counts.communities} communities
                          </span>
                        </div>
                        <footer>
                          <span>{repository.packageNames.length} packages</span>
                          <span>
                            {repository.dependencyNames.length} dependencies
                          </span>
                        </footer>
                      </article>
                    ))}
                  </div>
                  <div className="federation-link-ledger">
                    <header>
                      <strong>Cross-repository evidence</strong>
                      <span>dependency declaration → package declaration</span>
                    </header>
                    {federation.links.map((link) => {
                      const source = federation.repositories.find(
                        (repository) => repository.id === link.from,
                      );
                      const target = federation.repositories.find(
                        (repository) => repository.id === link.to,
                      );
                      const activeRepository = federation.repositories.find(
                        (repository) => repository.role === "active",
                      );
                      return (
                        <article data-status={link.status} key={link.id}>
                          <div className="federation-link-route">
                            <strong>
                              {source?.workspaceName || link.from}
                            </strong>
                            <span>— {link.packageName} →</span>
                            <strong>{target?.workspaceName || link.to}</strong>
                          </div>
                          <small>
                            {link.ecosystem} · {link.trust} · {link.status} ·{" "}
                            {Math.round(link.confidence * 100)}%
                            {link.resolutionSource
                              ? ` · ${link.resolutionSource.replaceAll("-", " ")}`
                              : ""}
                          </small>
                          <footer>
                            {link.evidence.map((evidence, index) =>
                              evidence.repositoryId === activeRepository?.id ? (
                                <button
                                  key={`${evidence.repositoryId}:${evidence.path}:${evidence.line}:${index}`}
                                  onClick={() =>
                                    onOpenFile(evidence.path, evidence.line)
                                  }
                                >
                                  {evidence.role} · {evidence.path}:
                                  {evidence.line}
                                </button>
                              ) : (
                                <span
                                  key={`${evidence.repositoryId}:${evidence.path}:${evidence.line}:${index}`}
                                >
                                  {evidence.role} · {evidence.path}:
                                  {evidence.line}
                                </span>
                              ),
                            )}
                          </footer>
                        </article>
                      );
                    })}
                    {!federation.links.length && (
                      <p>
                        No exact package identity crossed the selected
                        repository boundaries. Witch did not invent a similarity
                        link.
                      </p>
                    )}
                  </div>
                </div>
                {federation.questions.length > 0 && (
                  <section className="federation-questions">
                    <h4>Grill-me ambiguity queue</h4>
                    {federation.questions.map((question) => (
                      <article key={question.id}>
                        <CircleHelp size={13} />
                        <div>
                          <strong>{question.prompt}</strong>
                          <p>{question.recommendation}</p>
                          {question.authoredProviderKeys?.length ? (
                            <code>
                              authored ·{" "}
                              {question.authoredProviderKeys.join(" / ")}
                            </code>
                          ) : null}
                          {question.kind === "ambiguous-provider" && (
                            <footer>
                              {question.candidateRepositoryIds.map(
                                (repositoryId) => {
                                  const repository =
                                    federation.repositories.find(
                                      (candidate) =>
                                        candidate.id === repositoryId,
                                    );
                                  return (
                                    <button
                                      disabled={federationBusy}
                                      key={repositoryId}
                                      onClick={() =>
                                        void approveFederationProvider(
                                          question.id,
                                          repositoryId,
                                        )
                                      }
                                    >
                                      Approve{" "}
                                      {repository?.workspaceName ||
                                        repositoryId}
                                    </button>
                                  );
                                },
                              )}
                            </footer>
                          )}
                        </div>
                      </article>
                    ))}
                  </section>
                )}
              </>
            )}
            <section className="federation-approval-history">
              <header>
                <div>
                  <History size={13} />
                  <strong>Provider approval history</strong>
                </div>
                <span>
                  {
                    federationApprovals.filter(
                      (entry) => entry.status === "active",
                    ).length
                  }{" "}
                  active ·{" "}
                  {
                    federationApprovals.filter(
                      (entry) => entry.status === "revoked",
                    ).length
                  }{" "}
                  revoked
                  {federationApprovals.length > 100
                    ? " · 100/" + federationApprovals.length + " shown"
                    : ""}
                </span>
              </header>
              {!federationApprovals.length && (
                <p>
                  No provider decision has been recorded. Source-authored
                  mappings do not require an approval receipt.
                </p>
              )}
              {federationApprovals.slice(0, 100).map((entry) => {
                const approval = entry.approval;
                const status = approvalMapStatus(entry, federation);
                const confirming = pendingRevokeApprovalId === approval.id;
                return (
                  <article data-status={status} key={approval.id}>
                    <div>
                      <strong>{approval.packageName}</strong>
                      <span>{status}</span>
                    </div>
                    <p>
                      {workspaceName(approval.subjectWorkspaceRoot)} →{" "}
                      {workspaceName(approval.providerWorkspaceRoot)}
                    </p>
                    <small>
                      {approval.ecosystem} ·{" "}
                      {approval.decidedAt.replace("T", " ").slice(0, 19)}Z ·{" "}
                      {approval.subjectSourceRevision.slice(0, 8)} /{" "}
                      {approval.providerSourceRevision.slice(0, 8)}
                    </small>
                    {entry.revokedAt && (
                      <small>
                        revoked ·{" "}
                        {entry.revokedAt.replace("T", " ").slice(0, 19)}Z
                      </small>
                    )}
                    {entry.status === "active" && (
                      <footer>
                        {confirming && (
                          <button
                            className="is-cancel"
                            disabled={federationBusy}
                            onClick={() => setPendingRevokeApprovalId(null)}
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          className={confirming ? "is-confirm" : ""}
                          disabled={federationBusy}
                          aria-label={
                            "Revoke approval for " + approval.packageName
                          }
                          onClick={() =>
                            confirming
                              ? void revokeFederationApproval(approval.id)
                              : setPendingRevokeApprovalId(approval.id)
                          }
                        >
                          <Ban size={11} />{" "}
                          {confirming ? "Confirm revoke" : "Revoke"}
                        </button>
                      </footer>
                    )}
                  </article>
                );
              })}
            </section>
          </section>
        </div>
      )}

      {tab === "map" && (
        <div className="architecture-meta-view">
          <header className="architecture-meta-summary">
            <div>
              <strong>Multi-resolution architecture map</strong>
              <span>
                System → community → component → workflow → symbol · derived
                navigation, source facts unchanged
              </span>
            </div>
            <div className="architecture-meta-metrics">
              {(["community", "component", "workflow", "symbol"] as const).map(
                (level) => (
                  <span key={level}>
                    <strong>
                      {
                        metaGraph.nodes.filter((node) => node.level === level)
                          .length
                      }
                    </strong>{" "}
                    {level}
                  </span>
                ),
              )}
            </div>
          </header>
          <nav
            className="architecture-meta-breadcrumbs"
            aria-label="Architecture map hierarchy"
          >
            {metaFrame.breadcrumbs.map((node, index) => (
              <span key={node.id}>
                {index > 0 && <small>›</small>}
                <button onClick={() => setMetaFocusId(node.id)}>
                  {node.label}
                </button>
              </span>
            ))}
          </nav>
          {metaGraph.diagnostics.map((item) => (
            <p
              className="architecture-meta-warning"
              key={`${item.code}:${item.subject}`}
            >
              <CircleHelp size={12} /> {item.message}
            </p>
          ))}
          <div className="architecture-meta-shell">
            <section
              className="architecture-meta-stage"
              aria-label="Architecture meta graph"
              style={{ width: metaStageWidth, height: metaStageHeight }}
            >
              <svg
                aria-hidden="true"
                viewBox={`0 0 ${metaStageWidth} ${metaStageHeight}`}
                preserveAspectRatio="none"
              >
                <defs>
                  <marker
                    id="witch-meta-arrow"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="5"
                    markerHeight="5"
                    orient="auto-start-reverse"
                  >
                    <path d="M 0 0 L 10 5 L 0 10 z" />
                  </marker>
                </defs>
                {metaFrame.nodes.map((node) => {
                  const position = metaPositions.get(node.id)!;
                  const startX = metaFocusPosition.x + META_CARD_WIDTH;
                  const startY = metaFocusPosition.y + META_CARD_HEIGHT / 2;
                  const endX = position.x;
                  const endY = position.y + META_CARD_HEIGHT / 2;
                  const middle = Math.round((startX + endX) / 2);
                  return (
                    <path
                      className="architecture-meta-hierarchy-edge"
                      d={`M ${startX} ${startY} C ${middle} ${startY}, ${middle} ${endY}, ${endX} ${endY}`}
                      key={`hierarchy:${node.id}`}
                    />
                  );
                })}
                {metaFrame.edges.slice(0, 120).map((edge) => {
                  const from = metaPositions.get(edge.from);
                  const to = metaPositions.get(edge.to);
                  if (!from || !to) return null;
                  const startX = from.x + META_CARD_WIDTH / 2;
                  const startY = from.y + META_CARD_HEIGHT;
                  const endX = to.x + META_CARD_WIDTH / 2;
                  const endY = to.y;
                  const bend = Math.max(startY, endY) + 12;
                  return (
                    <path
                      className="architecture-meta-relation-edge"
                      d={`M ${startX} ${startY} C ${startX} ${bend}, ${endX} ${bend}, ${endX} ${endY}`}
                      key={edge.id}
                      markerEnd="url(#witch-meta-arrow)"
                    />
                  );
                })}
              </svg>
              <article
                className="architecture-meta-node is-focus"
                data-level={metaFrame.focus.level}
                style={{
                  left: metaFocusPosition.x,
                  top: metaFocusPosition.y,
                  width: META_CARD_WIDTH,
                  height: META_CARD_HEIGHT,
                }}
              >
                <header>
                  <span>{metaFrame.focus.level} resolution</span>
                  <small>{metaFrame.focus.memberCount}</small>
                </header>
                <strong>{metaFrame.focus.label}</strong>
                <p>{metaNodeSummary(metaFrame.focus)}</p>
              </article>
              {metaFrame.nodes.map((node) => {
                const position = metaPositions.get(node.id)!;
                const source = metaSource(node);
                return (
                  <article
                    className="architecture-meta-node"
                    data-level={node.level}
                    key={node.id}
                    style={{
                      left: position.x,
                      top: position.y,
                      width: META_CARD_WIDTH,
                      height: META_CARD_HEIGHT,
                    }}
                  >
                    <button
                      className="architecture-meta-node-main"
                      onClick={() =>
                        node.childIds.length
                          ? setMetaFocusId(node.id)
                          : source && openSource(source)
                      }
                      aria-label={`Open ${node.level} ${node.label}`}
                    >
                      <header>
                        <span>{node.level}</span>
                        <small>{node.memberCount}</small>
                      </header>
                      <strong>{node.label}</strong>
                      <p>{metaNodeSummary(node)}</p>
                    </button>
                    <footer>
                      <span>{node.assignment.replaceAll("-", " ")}</span>
                      {source && (
                        <button
                          aria-label={`Attach ${node.label} context`}
                          onClick={() => attach(source)}
                        >
                          + context
                        </button>
                      )}
                    </footer>
                  </article>
                );
              })}
            </section>
            <aside className="architecture-meta-relations">
              <header>
                <strong>{metaFrame.focus.level} resolution</strong>
                <span>
                  {metaFrame.nodes.length} visible
                  {metaFrame.omittedNodes
                    ? ` · ${metaFrame.omittedNodes} omitted`
                    : ""}
                </span>
              </header>
              {metaFrame.edges.slice(0, 16).map((edge) => (
                <button
                  key={edge.id}
                  onClick={() => {
                    const target = metaNodeById.get(edge.to);
                    if (target?.childIds.length) setMetaFocusId(target.id);
                  }}
                >
                  <span>
                    {metaNodeById.get(edge.from)?.label || edge.from} →{" "}
                    {metaNodeById.get(edge.to)?.label || edge.to}
                  </span>
                  <small>
                    {edge.relationCount} ·{" "}
                    {edge.relationKinds.slice(0, 3).join(" / ")}
                  </small>
                </button>
              ))}
              {!metaFrame.edges.length && (
                <p>No cross-boundary relations at this resolution.</p>
              )}
              {!metaFrame.nodes.length && (
                <div className="architecture-meta-leaf">
                  <strong>Lowest available resolution</strong>
                  <p>
                    Open source or return through the breadcrumb to inspect a
                    neighboring branch.
                  </p>
                  {metaSource(metaFrame.focus) && (
                    <button
                      onClick={() => openSource(metaSource(metaFrame.focus)!)}
                    >
                      Source <ArrowUpRight size={11} />
                    </button>
                  )}
                </div>
              )}
            </aside>
          </div>
        </div>
      )}

      {tab === "communities" && (
        <div className="graph-community-view">
          <header>
            <div>
              <strong>{brief.communities.length} observed communities</strong>
              <span>
                deterministic modularity projection · authored boundaries remain
                authoritative
              </span>
            </div>
            <small>{brief.sourceRevision.slice(0, 12)}</small>
          </header>
          <div className="graph-community-grid">
            {brief.communities.slice(0, 40).map((community, index) => (
              <article key={community.id}>
                <header>
                  <span>Observed {index + 1}</span>
                  <small>
                    {Math.round(community.cohesion * 100)}% cohesion
                  </small>
                </header>
                <strong>{community.label}</strong>
                <p>
                  {community.memberIds.length} members ·{" "}
                  {community.internalRelations} internal ·{" "}
                  {community.externalRelations} external
                </p>
                <footer>
                  {community.hubIds.map((id) => (
                    <button
                      key={id}
                      onClick={() =>
                        nodes.get(id) && openSource(nodes.get(id)!)
                      }
                    >
                      {nodes.get(id)?.label || id}
                    </button>
                  ))}
                </footer>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
