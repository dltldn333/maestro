import { useState } from "react";
import { Handle, Position, useEdges, useReactFlow, type NodeProps } from "@xyflow/react";
import { ipc } from "../ipc";
import type { CanvasNode, PromptFlowNode } from "../types";

export function PromptNode({ id, data }: NodeProps<PromptFlowNode>) {
  const { getNode, updateNodeData } = useReactFlow<CanvasNode>();
  const edges = useEdges();
  const [text, setText] = useState("");
  const [err, setErr] = useState("");

  // command_pipe edges are the source of truth for bindings (PRD 4.2)
  const targets = edges
    .filter((e) => e.source === id)
    .map((e) => getNode(e.target))
    .flatMap((n) => (n?.type === "pty_terminal_node" && n.data.status !== "TERMINATED" ? [n.data.sessionId] : []));

  const send = async () => {
    if (!text.trim()) return;
    if (!targets.length) return setErr("실행 중인 터미널 노드에 선을 연결하세요");
    try {
      await ipc.dispatchPrompt(targets, text);
      updateNodeData(id, { lastSentPrompt: text });
      setText("");
      setErr("");
    } catch (e) {
      setErr(String(e));
    }
  };

  return (
    <div className="node node-prompt">
      <header>
        <b>{data.label}</b>
        <span className="muted">{targets.length > 1 ? `Tutti · ${targets.length}` : targets.length ? "Solo" : "연결 없음"}</span>
      </header>
      <textarea
        className="nodrag nowheel"
        rows={4}
        value={text}
        placeholder="지시사항 입력 · Ctrl+Enter 전송"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            send();
          }
        }}
      />
      <footer>
        {err ? <span className="err">{err}</span> : <span className="muted">{data.lastSentPrompt ? `최근: ${data.lastSentPrompt.slice(0, 40)}` : ""}</span>}
        <button onClick={send}>전송</button>
      </footer>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
