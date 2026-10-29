import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore as useFlowStore, type NodeProps } from "@xyflow/react";
import { listen } from "@tauri-apps/api/event";
import { ipc } from "../ipc";
import { DRAG_MIME } from "../RightPanel";
import { StatusDot } from "../Sidebar";
import { useStore, useWorktree } from "../store";
import type { AgentEventPayload, ChatEvent, TerminalFlowNode, TerminalSize } from "../types";

const LOD_ZOOM = 0.6;
export const GRID = 24;
// All multiples of GRID so nodes stay on the grid.
export const TERM_SIZES: Record<TerminalSize, { width: number; height: number }> = {
  S: { width: 480, height: 408 },
  M: { width: 648, height: 552 },
  L: { width: 864, height: 720 },
};

/** A CLI block: one agent in its own worktree, shown as a chat (messages above, input below). */
export function AgentNode({ id, data }: NodeProps<TerminalFlowNode>) {
  const lod = useFlowStore((s) => s.transform[2] < LOD_ZOOM);
  const { updateNode } = useReactFlow();
  const wt = useWorktree(data.worktreePath);
  const focused = useStore((s) => s.selectedPath === data.worktreePath);
  const { remove, setError } = useStore();
  const events = useTranscript(wt?.root ?? "", data.worktreePath);
  const items = useMemo(() => fold(events), [events]);
  const size = data.size ?? "M";
  if (!wt) return null;
  const running = wt.status === "RUNNING";

  const discard = async () => {
    if (!confirm(`워크트리와 브랜치 '${wt.branch}'를 삭제합니다.\n커밋하지 않은 작업, 이 브랜치의 커밋, 대화 기록이 사라집니다.`)) return;
    try {
      await ipc.discardWorktree(wt.root, wt.path, wt.branch);
      remove(wt.path);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className="node node-agent" data-focused={focused || undefined}>
      <Handle type="target" position={Position.Left} />
      <header>
        <StatusDot w={wt} />
        <b className="ellipsis">{wt.branch}</b>
        <span className="muted small">{wt.adapterId === "claude-code" ? "Claude Code" : wt.adapterId}</span>
        <span className="spacer" />
        <span className="seg" title="블록 크기">
          {(Object.keys(TERM_SIZES) as TerminalSize[]).map((s) => (
            <button key={s} data-on={s === size || undefined} onClick={() => updateNode(id, { ...TERM_SIZES[s], data: { ...data, size: s } })}>
              {s}
            </button>
          ))}
        </span>
        <button className="danger" onClick={discard}>폐기</button>
      </header>
      {lod ? (
        <div className="lod">{lastText(items) || <span className="muted">아직 대화가 없어요</span>}</div>
      ) : (
        <>
          <Messages items={items} running={running} />
          <Composer root={wt.root} path={wt.path} running={running} />
        </>
      )}
    </div>
  );
}

function useTranscript(root: string, path: string) {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  useEffect(() => {
    if (!root) return;
    // Load history, then append live events; seq skips ones the history already had.
    let seq = -1;
    const queued: AgentEventPayload[] = [];
    let disposed = false;
    const add = (p: AgentEventPayload) => {
      if (p.seq <= seq) return;
      seq = p.seq;
      setEvents((es) => [...es, p.event]);
    };
    const un = listen<AgentEventPayload>("agent://event", (e) => {
      if (e.payload.worktreePath.toLowerCase() !== path.toLowerCase()) return;
      seq < 0 ? queued.push(e.payload) : add(e.payload);
    });
    un.then(() => ipc.transcript(root, path))
      .then((t) => {
        if (disposed) return;
        setEvents(t.events);
        seq = t.seq;
        queued.forEach(add);
      })
      .catch(() => {});
    return () => {
      disposed = true;
      un.then((f) => f());
    };
  }, [root, path]);
  return events;
}

// ---------- events → chat items ----------

type Item =
  | { kind: "user"; text: string; files: string[] }
  | { kind: "text"; text: string }
  | { kind: "tool"; id: string; name: string; input: any; result?: string; isError?: boolean }
  | { kind: "done"; text: string; error: boolean }
  | { kind: "note"; text: string; error?: boolean };

function fold(events: ChatEvent[]): Item[] {
  const items: Item[] = [];
  const tools = new Map<string, Extract<Item, { kind: "tool" }>>();
  for (const ev of events) {
    if (ev.type === "user_input") items.push({ kind: "user", text: ev.text, files: ev.files ?? [] });
    else if (ev.type === "assistant") {
      for (const b of ev.message?.content ?? []) {
        if (b.type === "text" && b.text?.trim()) items.push({ kind: "text", text: b.text });
        if (b.type === "tool_use") {
          const t = { kind: "tool" as const, id: b.id, name: b.name, input: b.input };
          tools.set(b.id, t);
          items.push(t);
        }
      }
    } else if (ev.type === "user") {
      for (const b of Array.isArray(ev.message?.content) ? ev.message.content : []) {
        const t = b.type === "tool_result" && tools.get(b.tool_use_id);
        if (t) {
          t.result = typeof b.content === "string" ? b.content : (b.content ?? []).map((c: any) => c.text ?? "").join("\n");
          t.isError = !!b.is_error;
        }
      }
    } else if (ev.type === "result") {
      const secs = ev.duration_ms ? `${(ev.duration_ms / 1000).toFixed(1)}초` : "";
      const cost = ev.total_cost_usd ? `$${ev.total_cost_usd.toFixed(3)}` : "";
      const denied = (ev.permission_denials ?? []).map((d: any) => d.tool_name).join(", ");
      items.push({
        kind: "done",
        error: !!ev.is_error,
        text: [ev.is_error ? `오류: ${ev.result ?? ev.subtype}` : "완료", secs, cost, denied && `권한 거부: ${denied}`].filter(Boolean).join(" · "),
      });
    } else if (ev.type === "stderr") items.push({ kind: "note", text: ev.text, error: true });
    else if (ev.type === "exit") items.push({ kind: "note", text: "에이전트가 종료됐어요. 다음 메시지를 보내면 대화를 이어서 다시 시작해요." });
  }
  return items;
}

function lastText(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "text" || it.kind === "user") return it.text.split("\n").slice(-3).join("\n");
  }
  return "";
}

const toolTarget = (input: any) =>
  input?.file_path ?? input?.command ?? input?.pattern ?? input?.path ?? input?.url ?? input?.description ?? "";

// ---------- views ----------

function Messages({ items, running }: { items: Item[]; running: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [items, running]);

  return (
    <div
      ref={box}
      className="messages nodrag nowheel"
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {!items.length && <div className="muted empty-chat">무엇을 할지 아래에 입력하세요.</div>}
      {items.map((it, i) => {
        switch (it.kind) {
          case "user":
            return (
              <div key={i} className="msg-user">
                <div className="bubble">{it.text}</div>
                {!!it.files.length && <div className="muted small">첨부: {it.files.join(", ")}</div>}
              </div>
            );
          case "text":
            return <RichText key={i} text={it.text} />;
          case "tool":
            return <ToolRow key={i} it={it} />;
          case "done":
            return <div key={i} className={`msg-done small${it.error ? " err" : " muted"}`}>{it.text}</div>;
          case "note":
            return <div key={i} className={`msg-note small${it.error ? " err" : " muted"}`}>{it.text}</div>;
        }
      })}
      {running && <div className="thinking muted small"><span className="spinner" /> 작업 중…</div>}
    </div>
  );
}

function ToolRow({ it }: { it: Extract<Item, { kind: "tool" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool" data-error={it.isError || undefined}>
      <div className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-caret">{open ? "▾" : "▸"}</span>
        <b>{it.name}</b>
        <span className="muted ellipsis">{String(toolTarget(it.input))}</span>
        {it.result === undefined && <span className="spinner" />}
      </div>
      {open && (
        <pre className="tool-body">
          {JSON.stringify(it.input, null, 2)}
          {it.result !== undefined && `\n\n— 결과 —\n${it.result.length > 4000 ? it.result.slice(0, 4000) + "\n…" : it.result}`}
        </pre>
      )}
    </div>
  );
}

// Plain text with ``` fences rendered as code blocks.
function RichText({ text }: { text: string }) {
  return (
    <div className="msg-text">
      {text.split(/```/).map((part, i) =>
        i % 2 ? (
          <pre key={i} className="code-block">{part.replace(/^[\w-]*\n/, "")}</pre>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}

function Composer({ root, path, running }: { root: string; path: string; running: boolean }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const setError = useStore((s) => s.setError);

  const send = async () => {
    if (!text.trim()) return;
    try {
      await ipc.send(root, path, text, files);
      setText("");
      setFiles([]);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div
      className="composer"
      data-over={over || undefined}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const rel = e.dataTransfer.getData(DRAG_MIME);
        if (rel && !files.includes(rel)) setFiles([...files, rel]);
      }}
    >
      {!!files.length && (
        <div className="chips">
          {files.map((p) => (
            <span key={p} className="chip" title={p}>
              {p.split("/").pop()}
              <button onClick={() => setFiles(files.filter((x) => x !== p))}>×</button>
            </span>
          ))}
        </div>
      )}
      <textarea
        className="nodrag nowheel"
        rows={2}
        value={text}
        placeholder="메시지 입력 · Enter 전송 · Shift+Enter 줄바꿈"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // isComposing: don't send while a Korean syllable is still being composed
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-actions">
        <span className="muted small">파일을 끌어와 첨부</span>
        <span className="spacer" />
        {running && <button onClick={() => ipc.stop(path).catch(setError)}>중지</button>}
        <button className="primary" disabled={!text.trim()} onClick={send}>보내기</button>
      </div>
    </div>
  );
}
