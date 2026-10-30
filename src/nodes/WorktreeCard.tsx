import { useEffect, useMemo, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { ipc } from "../ipc";
import { StatusDot } from "../Sidebar";
import { useApprovals, useStore, useWorktree } from "../store";
import type { WorktreeCardNode } from "../types";
import { fold, lastText, useAgentBoot, useTranscript } from "./AgentNode";
import { AgentLogo, agentLabel } from "../NewAgentDialog";
import { useSettings } from "../settings";
import { AttachAgent } from "./AttachAgent";

// 13 × 11 grid cells
export const CARD_SIZE = { width: 312, height: 264 };

const SIDES = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };

const STATUS: Record<string, string> ={ RUNNING: "작업 중", IDLE: "대기", TERMINATED: "꺼짐" };

/** Project canvas: what one worktree is up to, with a quick prompt box. Double-click opens it. */
export function WorktreeCard({ data }: NodeProps<WorktreeCardNode>) {
  const wt = useWorktree(data.worktreePath);
  const waiting = useApprovals(data.worktreePath).length > 0;
  const events = useTranscript(wt?.root ?? "", data.worktreePath);
  const last = useMemo(() => lastText(fold(events)), [events]);
  const [changed, setChanged] = useState<number | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const running = wt?.status === "RUNNING";
  // a card stands for a live agent: start its CLI and wait for it, like the chat view does
  const { boot, retry, trust } = useAgentBoot(wt?.root ?? "", data.worktreePath, !!wt?.adapterId);
  const ready = boot === "ready";

  // refresh the change count whenever a turn starts or ends
  useEffect(() => {
    ipc.gitStatus(data.worktreePath).then((f) => setChanged(f.length)).catch(() => setChanged(null));
  }, [data.worktreePath, wt?.status]);

  // Haiku summary of the latest answer. The backend keeps one per answer, so a visit shows the cached one
  // at once and Haiku runs only when an answer has no summary yet (right after a turn ends).
  const [summarizing, setSummarizing] = useState(false);
  const { assistantAgent, assistantModel } = useSettings();
  useEffect(() => {
    if (!wt || running || !events.length || assistantAgent === "off") return setSummary(null);
    let live = true;
    setSummarizing(true);
    ipc.summarize(wt.root, wt.path, assistantAgent, assistantModel)
      .then((s) => live && setSummary(s))
      .catch(() => {})
      .finally(() => live && setSummarizing(false));
    return () => {
      live = false;
    };
  }, [wt?.root, running, events.length, assistantAgent, assistantModel]);

  if (!wt) return null;
  return (
    <div className="node wt-card" data-waiting={waiting || undefined} data-maestro={wt.isMaestro || undefined}>
      {/* connection points on every side: lines go Maestro ↔ worker (Canvas uses loose connection mode) */}
      {(["top", "right", "bottom", "left"] as const).map((side) => (
        <Handle key={side} id={side} type="source" position={SIDES[side]} className="wt-handle" />
      ))}
      <header>
        <StatusDot w={wt} />
        {wt.isMaestro && <span className="maestro-crown" title="이 프로젝트의 마에스트로 (조율자)">♛</span>}
        <b className="ellipsis" title={wt.isMaestro ? `프로젝트 폴더 · ${wt.branch}` : `브랜치 ${wt.branch}`}>{wt.name}</b>
        {wt.isMaestro && <span className="muted small">워커 {wt.workers.length}</span>}
        <span className="spacer" />
        {wt.external && <span className="ext-badge" title="Maestro 밖에서 만든 워크트리 (폐기해도 폴더는 그대로)">외부</span>}
        <span className="agent-tag muted small"><AgentLogo id={wt.adapterId} size={14} />{agentLabel(wt.adapterId)}</span>
      </header>
      <div className="wt-card-body">
        {wt.description && <div className="wt-card-desc muted small">{wt.description}</div>}
        {!!wt.personas.length && (
          <div className="wt-card-personas">
            {wt.personas.map((p) => <span key={p} className="persona-badge" title="연결된 페르소나">♟ {p}</span>)}
          </div>
        )}
        <div className="wt-card-meta small">
          <span className={waiting ? "wt-card-waiting" : "muted"}>{waiting ? "승인 대기" : STATUS[wt.status]}</span>
          <span className="muted">· {changed === null ? "변경 확인 중" : changed ? `변경 ${changed}개 파일` : "변경 없음"}</span>
        </div>
        <div className="wt-card-last">
          {!wt.adapterId ? (
            <AttachAgent wt={wt} compact />
          ) : boot === "starting" ? (
            <span className="muted"><span className="spinner" /> {agentLabel(wt.adapterId)} 준비 중…</span>
          ) : boot === "trust" ? (
            <span>
              처음 여는 폴더라 신뢰 확인이 필요해요.{" "}
              <button className="nodrag" onClick={trust}>신뢰하고 시작</button>
            </span>
          ) : typeof boot === "object" ? (
            <span className="err">
              {boot.error} <button className="nodrag" onClick={retry}>다시 시도</button>
            </span>
          ) : running ? (
            <span className="muted">{last || "작업 중…"}</span>
          ) : summary ? (
            <span title={last}>{summary}</span>
          ) : summarizing ? (
            <span className="muted"><span className="spinner" /> 답변 요약 중…</span>
          ) : (
            last || <span className="muted">아직 대화가 없어요</span>
          )}
        </div>
      </div>
      {wt.adapterId && <QuickPrompt root={wt.root} path={wt.path} ready={ready} />}
    </div>
  );
}

/** One-line prompt straight to this worktree's agent, without opening it. */
function QuickPrompt({ root, path, ready }: { root: string; path: string; ready: boolean }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const setError = useStore((s) => s.setError);
  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await ipc.send(root, path, text);
      setText("");
    } catch (e) {
      setError(e);
    }
    setBusy(false);
  };
  return (
    <div className="wt-card-prompt nodrag" onDoubleClick={(e) => e.stopPropagation()}>
      <input
        value={text}
        disabled={busy || !ready}
        placeholder={!ready ? "CLI 준비 중…" : busy ? "보내는 중…" : "바로 지시하기 · Enter"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) send();
        }}
      />
      <button className="primary" disabled={!text.trim() || busy || !ready} onClick={send}>↑</button>
    </div>
  );
}
