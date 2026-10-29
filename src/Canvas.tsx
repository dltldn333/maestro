import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "./ipc";
import { PromptNode } from "./nodes/PromptNode";
import { TerminalNode } from "./nodes/TerminalNode";
import { useStore } from "./store";
import type { CanvasEdge, CanvasNode, CanvasStateSchema, TerminalFlowNode } from "./types";

const nodeTypes = { prompt_input_primitive: PromptNode, pty_terminal_node: TerminalNode };
const TERM_W = 640;
const TERM_H = 400;

/** The CLI area: one canvas per repo. Terminal nodes mirror the repo's worktrees; prompt blocks are free. */
export function Canvas({ root }: { root: string }) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { getViewport, setViewport, setCenter, getZoom, screenToFlowPosition, fitView } = useReactFlow();
  const needsFit = useRef(false); // no saved viewport yet → frame the terminals once they exist
  const worktrees = useStore(useShallow((s) => s.worktrees.filter((w) => w.root === root)));
  const selectedPath = useStore((s) => s.selectedPath);
  const select = useStore((s) => s.select);
  const setError = useStore((s) => s.setError);
  const [loaded, setLoaded] = useState(false);
  const [viewTick, setViewTick] = useState(0);
  const wtKey = worktrees.map((w) => `${w.path}|${w.branch}`).join("\n");

  useEffect(() => {
    ipc.loadCanvas(root).then((saved) => {
      const state: CanvasStateSchema | null = saved ? JSON.parse(saved) : null;
      if (state) {
        setNodes(state.nodes as CanvasNode[]);
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
            position: { x: 360 + (i % 2) * (TERM_W + 40), y: Math.floor(i / 2) * (TERM_H + 40) },
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
    if (n) setCenter(n.position.x + (n.width ?? TERM_W) / 2, n.position.y + (n.height ?? TERM_H) / 2, { zoom: Math.max(getZoom(), 0.9), duration: 300 });
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
    const p = screenToFlowPosition({ x: 420, y: 160 });
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
      minZoom={0.15}
      deleteKeyCode={["Delete"]}
      colorMode="dark"
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={24} />
      <Controls position="bottom-left" />
      <MiniMap pannable zoomable position="bottom-right" />
      <Panel position="top-left">
        <div className="canvas-tools">
          <button onClick={addPrompt}>+ 프롬프트 블록</button>
          <span className="muted small">블록 오른쪽 점을 터미널로 끌어 연결 · 여러 개 연결하면 동시 전송</span>
        </div>
      </Panel>
      {!worktrees.length && (
        <Panel position="top-center">
          <div className="canvas-empty muted">왼쪽 사이드바의 + 로 워크트리를 만들면 여기에 터미널이 생겨요.</div>
        </Panel>
      )}
    </ReactFlow>
  );
}
