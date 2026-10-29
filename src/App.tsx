import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "./ipc";
import { PromptNode } from "./nodes/PromptNode";
import { TerminalNode } from "./nodes/TerminalNode";
import type { AgentStateEvent, CanvasEdge, CanvasNode, CanvasStateSchema, TerminalFlowNode } from "./types";

const nodeTypes = { prompt_input_primitive: PromptNode, pty_terminal_node: TerminalNode };

export default function App() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { getViewport, setViewport, screenToFlowPosition } = useReactFlow();
  const [root, setRoot] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [adapter, setAdapter] = useState("claude-code");
  const [branch, setBranch] = useState("agent-1");
  const [base, setBase] = useState("HEAD");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const loaded = useRef(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr("");
    try {
      await fn();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const openProject = () =>
    run(async () => {
      loaded.current = false;
      const top = await ipc.openProject(pathInput.trim());
      const [saved, live] = await Promise.all([ipc.loadCanvas(top), ipc.listSessions(top)]);
      const state: CanvasStateSchema | null = saved ? JSON.parse(saved) : null;
      setNodes(
        (state?.nodes ?? []).map((n) =>
          n.type === "pty_terminal_node" && !live.includes((n.data as TerminalFlowNode["data"]).sessionId)
            ? { ...n, data: { ...n.data, status: "TERMINATED" } }
            : n,
        ) as CanvasNode[],
      );
      setEdges((state?.edges ?? []).map((e) => ({ ...e, animated: true })));
      if (state) setViewport(state.viewport);
      setRoot(top);
      loaded.current = true;
    });

  // New nodes land near the middle of the current view, nudged so they don't stack.
  const dropPoint = () => {
    const p = screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: window.innerHeight / 2 - 150 });
    const k = nodes.length % 6;
    return { x: p.x + k * 40, y: p.y + k * 40 };
  };

  const addAgent = () =>
    run(async () => {
      const res = await ipc.spawn({ projectRoot: root, adapterId: adapter, branchName: branch.trim(), baseBranch: base.trim() || "HEAD", cols: 100, rows: 28 });
      const node: TerminalFlowNode = {
        id: `term_${res.sessionId}_${Date.now()}`,
        type: "pty_terminal_node",
        position: dropPoint(),
        width: 640,
        height: 380,
        data: {
          sessionId: res.sessionId,
          adapterId: adapter,
          worktreePath: res.worktreePath,
          branchName: res.branchName,
          allocatedPort: res.allocatedPort ?? undefined,
          status: "RUNNING",
        },
      };
      setNodes((ns) => [...ns, node]);
      setBranch((b) => b.replace(/(\d+)$/, (d) => String(Number(d) + 1)));
    });

  const addPrompt = () =>
    setNodes((ns) => [
      ...ns,
      { id: `prompt_${Date.now()}`, type: "prompt_input_primitive", position: dropPoint(), data: { label: `프롬프트 ${ns.filter((n) => n.type === "prompt_input_primitive").length + 1}` } },
    ]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((es) => addEdge({ ...c, animated: true, data: { kind: "command_pipe" as const } }, es)),
    [setEdges],
  );

  // only prompt → terminal pipes exist in the MVP
  const isValidConnection: IsValidConnection = (c) =>
    nodes.find((n) => n.id === c.source)?.type === "prompt_input_primitive" && nodes.find((n) => n.id === c.target)?.type === "pty_terminal_node";

  useEffect(() => {
    const un = listen<AgentStateEvent>("agent://state", (e) => {
      setNodes((ns) =>
        ns.map((n) => (n.type === "pty_terminal_node" && n.data.sessionId === e.payload.sessionId ? { ...n, data: { ...n.data, status: e.payload.state.kind } } : n)),
      );
    });
    return () => void un.then((f) => f());
  }, [setNodes]);

  // Debounced autosave of canvas_state.json (backend writes atomically).
  useEffect(() => {
    if (!root || !loaded.current) return;
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
      ipc.saveCanvas(root, JSON.stringify(state, null, 2)).catch((e) => setErr(String(e)));
    }, 500);
    return () => clearTimeout(t);
  }, [nodes, edges, root, getViewport]);

  return (
    <div className="app">
      <div className="toolbar">
        <b className="brand">Maestro</b>
        <input className="path" placeholder="Git 저장소 경로 (예: C:\dev\my-project)" value={pathInput} onChange={(e) => setPathInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && openProject()} />
        <button disabled={busy || !pathInput.trim()} onClick={openProject}>열기</button>
        {root && (
          <>
            <span className="sep" />
            <select value={adapter} onChange={(e) => setAdapter(e.target.value)}>
              <option value="claude-code">Claude Code</option>
              <option value="shell">Shell</option>
            </select>
            <input className="short" title="새 브랜치" value={branch} onChange={(e) => setBranch(e.target.value)} />
            <input className="short" title="기준 브랜치" value={base} onChange={(e) => setBase(e.target.value)} />
            <button disabled={busy || !branch.trim()} onClick={addAgent}>+ 에이전트</button>
            <button onClick={addPrompt}>+ 프롬프트 블록</button>
          </>
        )}
        <span className="spacer" />
        {busy && <span className="muted">작업 중…</span>}
        {err && <span className="err" title={err}>{err}</span>}
        {root && <span className="muted root">{root}</span>}
      </div>
      <div className="stage">
        {root ? (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onMoveEnd={() => setNodes((ns) => [...ns])} // re-trigger autosave so the viewport is persisted
            minZoom={0.2}
            deleteKeyCode={["Delete"]}
            colorMode="dark"
            fitView={false}
          >
            <Background gap={24} />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        ) : (
          <div className="empty">
            <p>Git 저장소 경로를 입력하고 <b>열기</b>를 누르세요.</p>
            <p className="muted">에이전트마다 ~/.maestro/projects/ 아래에 격리된 워크트리가 만들어지고, 원본 폴더에는 파일이 생기지 않습니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
