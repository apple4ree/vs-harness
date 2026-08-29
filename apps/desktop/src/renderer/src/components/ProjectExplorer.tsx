import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
} from "lucide-react";

type Tree = {
  path: string;
  name: string;
  kind: "file" | "directory";
  children: Tree[];
};
export function ProjectExplorer({
  entries,
  selected,
  onSelect,
  onOpen,
  onAction,
}: {
  entries: WorkspaceEntry[];
  selected: string | null;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
  onAction: (
    kind: "create-file" | "create-folder" | "rename" | "move" | "delete",
    source?: string,
  ) => void;
}) {
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const viewportRef = useRef<HTMLDivElement>(null);
  const requestedFocus = useRef<string | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 300 });
  const rowHeight = 26;
  const tree = useMemo(() => {
    const root: Tree = { path: "", name: "", kind: "directory", children: [] };
    const nodes = new Map<string, Tree>([["", root]]);
    for (const entry of entries) {
      const segments = entry.path.split("/");
      let parent = root;
      segments.forEach((segment, index) => {
        const path = segments.slice(0, index + 1).join("/");
        let child = nodes.get(path);
        if (!child) {
          child = {
            path,
            name: segment,
            kind: index === segments.length - 1 ? entry.kind : "directory",
            children: [],
          };
          nodes.set(path, child);
          parent.children.push(child);
        }
        parent = child;
      });
    }
    const sort = (item: Tree) => {
      item.children.sort(
        (a, b) =>
          Number(b.kind === "directory") - Number(a.kind === "directory") ||
          a.name.localeCompare(b.name),
      );
      item.children.forEach(sort);
    };
    sort(root);
    return root;
  }, [entries]);
  function reveal(node: Tree) {
    const container = viewportRef.current;
    const index = visible.indexOf(node);
    if (!container || index < 0 || !virtualized) return;
    const top = index * rowHeight;
    const next =
      top < container.scrollTop
        ? top
        : top + rowHeight > container.scrollTop + container.clientHeight
          ? top + rowHeight - container.clientHeight
          : container.scrollTop;
    if (next !== container.scrollTop) {
      container.scrollTop = Math.max(0, next);
      setViewport({ top: container.scrollTop, height: container.clientHeight });
    }
  }
  function focusNode(target: Tree | undefined) {
    if (!target) return;
    requestedFocus.current = target.path;
    onSelect(target.path);
    reveal(target);
    rowRefs.current.get(target.path)?.focus({ preventScroll: virtualized });
  }
  function renderBranch(node: Tree, depth: number, flatIndex?: number) {
    // Expansion state is held by the top-level map so a file refresh does not collapse the tree.
    const expanded = expandedPaths.has(node.path);
    return (
      <div
        key={node.path}
        role="treeitem"
        aria-level={depth + 1}
        aria-posinset={
          virtualized ? rowMetadata.get(node.path)?.position : undefined
        }
        aria-setsize={
          virtualized ? rowMetadata.get(node.path)?.siblings : undefined
        }
        aria-expanded={node.kind === "directory" ? expanded : undefined}
        aria-selected={selected === node.path}
        style={
          flatIndex === undefined
            ? undefined
            : {
                position: "absolute",
                top: flatIndex * rowHeight,
                height: rowHeight,
                width: "100%",
              }
        }
      >
        <button
          ref={(element) => {
            if (element) rowRefs.current.set(node.path, element);
            else rowRefs.current.delete(node.path);
          }}
          tabIndex={tabStop === node.path ? 0 : -1}
          className={`project-tree-row ${selected === node.path ? "selected" : ""}`}
          style={{
            paddingLeft: 6 + depth * 12,
            height: flatIndex === undefined ? undefined : rowHeight,
          }}
          title={node.path}
          onKeyDown={(event) => {
            const index = visible.findIndex((item) => item.path === node.path);
            const expand = (value: boolean) => {
              requestedFocus.current = node.path;
              setExpandedPaths((previous) => {
                const next = new Set(previous);
                if (value) next.add(node.path);
                else next.delete(node.path);
                return next;
              });
            };
            if (event.key === "ArrowDown") focusNode(visible[index + 1]);
            else if (event.key === "ArrowUp") focusNode(visible[index - 1]);
            else if (event.key === "Home") focusNode(visible[0]);
            else if (event.key === "End") focusNode(visible.at(-1));
            else if (event.key === "ArrowRight") {
              if (node.kind === "directory") {
                if (expanded) focusNode(node.children[0]);
                else expand(true);
              }
            } else if (event.key === "ArrowLeft") {
              if (node.kind === "directory" && expanded) expand(false);
              else if (node.path.includes("/"))
                focusNode(
                  visible.find(
                    (item) =>
                      item.path ===
                      node.path.slice(0, node.path.lastIndexOf("/")),
                  ),
                );
            } else if (event.key === "F2") onAction("rename", node.path);
            else if (event.key === "Delete") onAction("delete", node.path);
            else if (event.key === "F10" && event.shiftKey) {
              onSelect(node.path);
              setMenu(node.path);
            } else return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={() => {
            requestedFocus.current = node.path;
            onSelect(node.path);
            if (node.kind === "directory")
              setExpandedPaths((previous) => {
                const next = new Set(previous);
                if (next.has(node.path)) next.delete(node.path);
                else next.add(node.path);
                return next;
              });
            else onOpen(node.path);
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            onSelect(node.path);
            setMenu(node.path);
          }}
        >
          {node.kind === "directory" ? (
            <>
              {expanded ? (
                <ChevronDown size={11} />
              ) : (
                <ChevronRight size={11} />
              )}{" "}
              {expanded ? <FolderOpen size={13} /> : <Folder size={13} />}
            </>
          ) : (
            <>
              <span style={{ width: 11 }} />
              <File size={12} />
            </>
          )}
          <span>
            {node.name}
            {flatIndex !== undefined &&
            expanded &&
            node.kind === "directory" &&
            !node.children.length
              ? " · Empty folder"
              : ""}
          </span>
        </button>
        {flatIndex === undefined && expanded && node.kind === "directory" && (
          <div role="group">
            {node.children.length ? (
              node.children.map((child) => renderBranch(child, depth + 1))
            ) : (
              <span className="empty-folder">Empty folder</span>
            )}
          </div>
        )}
      </div>
    );
  }
  const [expandedPaths, setExpandedPaths] = useState(
    () => new Set(["src", "apps", "packages"]),
  );
  const [menu, setMenu] = useState<string | null>(null);
  useEffect(() => {
    if (!selected) return;
    const parents = selected.split("/").slice(0, -1);
    setExpandedPaths((previous) => {
      const next = new Set(previous);
      parents.forEach((_part, index) =>
        next.add(parents.slice(0, index + 1).join("/")),
      );
      return next.size === previous.size ? previous : next;
    });
  }, [selected]);
  const { visible, rowMetadata } = useMemo(() => {
    const visible: Tree[] = [];
    const rowMetadata = new Map<
      string,
      { depth: number; position: number; siblings: number }
    >();
    function visit(nodes: Tree[], depth: number) {
      nodes.forEach((node, index) => {
        visible.push(node);
        rowMetadata.set(node.path, {
          depth,
          position: index + 1,
          siblings: nodes.length,
        });
        if (expandedPaths.has(node.path)) visit(node.children, depth + 1);
      });
    }
    visit(tree.children, 0);
    return { visible, rowMetadata };
  }, [tree, expandedPaths]);
  const virtualized = visible.length > 400;
  const start = Math.max(
    0,
    Math.min(visible.length - 1, Math.floor(viewport.top / rowHeight) - 8),
  );
  const end = Math.min(
    visible.length,
    Math.ceil((viewport.top + viewport.height) / rowHeight) + 8,
  );
  const tabStop = visible.some((item) => item.path === selected)
    ? selected
    : visible[0]?.path;
  useEffect(() => {
    const container = viewportRef.current;
    if (!container) return;
    const update = () =>
      setViewport({
        top: container.scrollTop,
        height: container.clientHeight || 300,
      });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    update();
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const item = visible.find((node) => node.path === selected);
    if (item) reveal(item);
  }, [selected, visible, virtualized]);
  useLayoutEffect(() => {
    if (!requestedFocus.current) return;
    const element = rowRefs.current.get(requestedFocus.current);
    if (element) {
      requestedFocus.current = null;
      element.focus({ preventScroll: virtualized });
    }
  });
  return (
    <div className="project-explorer">
      {menu && (
        <div
          className="explorer-context"
          role="menu"
          aria-label={`Actions for ${menu}`}
        >
          <small>{menu}</small>
          {(
            [
              "create-file",
              "create-folder",
              "rename",
              "move",
              "delete",
            ] as const
          ).map((kind) => (
            <button
              role="menuitem"
              key={kind}
              onClick={() => {
                onAction(kind, menu);
                setMenu(null);
              }}
            >
              {kind.replace("-", " ")}
            </button>
          ))}
          <button onClick={() => setMenu(null)}>Cancel</button>
        </div>
      )}
      <div
        ref={viewportRef}
        className="project-tree-viewport"
        role="tree"
        aria-label="Project files"
        tabIndex={
          virtualized &&
          !visible.slice(start, end).some((node) => node.path === tabStop)
            ? 0
            : undefined
        }
        onFocus={(event) => {
          if (event.target === event.currentTarget)
            focusNode(visible.find((node) => node.path === tabStop));
        }}
        onScroll={(event) =>
          setViewport({
            top: event.currentTarget.scrollTop,
            height: event.currentTarget.clientHeight,
          })
        }
      >
        {virtualized ? (
          <div
            role="presentation"
            style={{ position: "relative", height: visible.length * rowHeight }}
          >
            {visible
              .slice(start, end)
              .map((node, offset) =>
                renderBranch(
                  node,
                  rowMetadata.get(node.path)!.depth,
                  start + offset,
                ),
              )}
          </div>
        ) : (
          tree.children.map((child) => renderBranch(child, 0))
        )}
      </div>
    </div>
  );
}
