import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Panel,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "./ipc";
import { PromptNode } from "./nodes/PromptNode";
import { AgentNode, GRID, TERM_SIZES } from "./nodes/AgentNode";
import { useStore } from "./store";
import { ViewMap } from "./ViewMap";
import { motionMs, useSettings } from "./settings";
import type { CanvasEdge, CanvasNode, CanvasStateSchema, TerminalFlowNode } from "./types";

const nodeTypes = { prompt_input_primitive: PromptNode, pty_terminal_node: AgentNode };
const { width: TERM_W, height: TERM_H } = TERM_SIZES.M;
const snap = (v: number) => Math.round(v / GRID) * GRID;

// Older canvases may hold free-form sizes/positions; pull them onto the grid and size presets.
const normalize = (n: CanvasNode): CanvasNode => {
  const position = { x: snap(n.position.x), y: snap(n.position.y) };
  return n.type === "pty_terminal_node"
    ? { ...n, position, ...TERM_SIZES[n.data.size ?? "M"], deletable: false }
    : { ...n, position, width: undefined, height: undefined };
};

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Bottom-left zoom bar: − zoom% + | fit. Clicking the percentage resets to 100%. */
function CanvasControls() {
  const zoom = useFlowStore((s) => s.transform[2]);
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const duration = motionMs(useSettings.getState());
  return (
    <Panel position="bottom-left">
      <div className="cc">
        <button title="축소" onClick={() => zoomOut({ duration })}><Icon d="M3.5 8h9" /></button>
        <button className="cc-zoom" title="100%로" onClick={() => zoomTo(1, { duration })}>{Math.round(zoom * 100)}%</button>
        <button title="확대" onClick={() => zoomIn({ duration })}><Icon d="M3.5 8h9M8 3.5v9" /></button>
        <span className="cc-sep" />
        <button title="전체 보기" onClick={() => fitView({ padding: 0.15, maxZoom: 1, duration })}>
          <Icon d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
        </button>
      </div>
    </Panel>
  );
}

/** The CLI area: one canvas per repo. CLI blocks mirror the repo's agent worktrees; prompt blocks are free. */
export function Canvas({ root, onNewAgent }: { root: string; onNewAgent: () => void }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { getViewport, setViewport, setCenter, getZoom, screenToFlowPosition, fitView } = useReactFlow();
  const needsFit = useRef(false); // no saved viewport yet → frame the terminals once they exist
  const worktrees = useStore(useShallow((s) => s.worktrees.filter((w) => w.root === root)));
  const selectedPath = useStore((s) => s.selectedPath);
  const select = useStore((s) => s.select);
  const setError = useStore((s) => s.setError);
  const theme = useSettings((s) => s.theme);
  const [loaded, setLoaded] = useState(false);
  const [viewTick, setViewTick] = useState(0);
  const wtKey = worktrees.map((w) => `${w.path}|${w.branch}`).join("\n");

  useEffect(() => {
    ipc.loadCanvas(root).then((saved) => {
      const state: CanvasStateSchema | null = saved ? JSON.parse(saved) : null;
      if (state) {
        setNodes((state.nodes as CanvasNode[]).map(normalize));
        setEdges(state.edges.map((e) => ({ ...e, animated: true })));
        setViewport(state.viewport);
      }
      needsFit.current = !state;
      setLoaded(true);
    }).catch(setError);
  }, [root]);

  // Keep exactly one terminal node per worktree.
  useEffect(() => {
    if (!loaded) return;
    const paths = new Set(worktrees.map((w) => w.path));
    setNodes((ns) => {
      const kept = ns.filter((n) => n.type !== "pty_terminal_node" || paths.has(n.data.worktreePath));
      const have = new Set(kept.flatMap((n) => (n.type === "pty_terminal_node" ? [n.data.worktreePath] : [])));
      let slot = kept.filter((n) => n.type === "pty_terminal_node").length;
      const added: TerminalFlowNode[] = worktrees
        .filter((w) => !have.has(w.path))
        .map((w) => {
          const i = slot++;
          return {
            id: `term_${w.path}`,
            type: "pty_terminal_node",
            position: { x: 360 + (i % 2) * (TERM_W + 2 * GRID), y: Math.floor(i / 2) * (TERM_H + 2 * GRID) },
            width: TERM_W,
            height: TERM_H,
            deletable: false, // removed only by discarding the worktree
            data: { worktreePath: w.path, branchName: w.branch },
          };
        });
      return kept.length === ns.length && !added.length ? ns : [...kept, ...added];
    });
    setEdges((es) => es.filter((e) => !e.target.startsWith("term_") || paths.has(e.target.slice(5))));
    if (needsFit.current && worktrees.length) {
      needsFit.current = false;
      requestAnimationFrame(() => fitView({ padding: 0.15, maxZoom: 1 }));
    }
  }, [loaded, wtKey]);

  // Sidebar selection → fly to that terminal.
  useEffect(() => {
    const n = nodes.find((n) => n.type === "pty_terminal_node" && n.data.worktreePath === selectedPath);
    if (n) setCenter(n.position.x + (n.width ?? TERM_W) / 2, n.position.y + (n.height ?? TERM_H) / 2, { zoom: Math.max(getZoom(), 0.9), duration: motionMs(useSettings.getState()) * 1.5 });
  }, [selectedPath]);

  // Debounced autosave (backend writes atomically).
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const state: CanvasStateSchema = {
        version: "1.0.0",
        rootPath: root,
        activeSkillId: "",
        activeThemeId: "theme_default_dark",
        viewport: getViewport(),
        nodes: nodes.map(({ id, type, position, width, height, data }) => ({ id, type, position, width, height, data }) as CanvasStateSchema["nodes"][number]),
        edges: edges.map(({ id, source, target, data }) => ({ id, source, target, data })),
      };
      ipc.saveCanvas(root, JSON.stringify(state, null, 2)).catch(setError);
    }, 500);
    return () => clearTimeout(t);
  }, [loaded, nodes, edges, viewTick]);

  const promptCount = useRef(0);
  const addPrompt = () => {
    const s = screenToFlowPosition({ x: 420, y: 160 });
    const p = { x: snap(s.x), y: snap(s.y) };
    promptCount.current = nodes.filter((n) => n.type === "prompt_input_primitive").length + 1;
    setNodes((ns) => [
      ...ns,
      { id: `prompt_${Date.now()}`, type: "prompt_input_primitive", position: p, data: { label: `프롬프트 ${promptCount.current}`, attachedContextPaths: [] } },
    ]);
  };

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, animated: true, data: { kind: "command_pipe" as const } }, es)),
    [setEdges],
  );

  // only prompt → terminal pipes for now
  const isValidConnection: IsValidConnection = (c) =>
    nodes.find((n) => n.id === c.source)?.type === "prompt_input_primitive" && nodes.find((n) => n.id === c.target)?.type === "pty_terminal_node";

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onNodeClick={(_, n) => n.type === "pty_terminal_node" && select(n.data.worktreePath)}
      onMoveEnd={() => setViewTick((t) => t + 1)}
      snapToGrid
      snapGrid={[GRID, GRID]}
      minZoom={0.15}
      deleteKeyCode={["Delete"]}
      colorMode={theme === "light" ? "light" : "dark"}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={GRID} />
      <CanvasControls />
      <ViewMap nodes={nodes} />
      <Panel position="top-left">
        <div className="canvas-tools">
          <button className="primary" onClick={onNewAgent}>+ CLI 블록</button>
          <button onClick={addPrompt}>+ 프롬프트 블록</button>
          <span className="muted small">프롬프트 블록의 오른쪽 점을 CLI 블록으로 끌어 연결 · 여러 개 연결하면 동시 전송</span>
        </div>
      </Panel>
      {!worktrees.length && (
        <div className="canvas-empty-center">
          <div className="canvas-empty muted">
            <b>+ CLI 블록</b>으로 에이전트를 고르면 격리된 워크트리에서 바로 실행돼요.
          </div>
        </div>
      )}
    </ReactFlow>
  );
}
