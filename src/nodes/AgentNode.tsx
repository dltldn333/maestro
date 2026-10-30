import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Handle, Position, useReactFlow, useStore as useFlowStore, type NodeProps } from "@xyflow/react";
import { listen } from "@tauri-apps/api/event";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ipc } from "../ipc";
import { DRAG_MIME } from "../RightPanel";
import { StatusDot } from "../Sidebar";
import { XTerm } from "./XTerm";
import { AttachAgent } from "./AttachAgent";
import { AgentLogo, agentLabel } from "../NewAgentDialog";
import { ApprovalCards } from "./ApprovalCards";
import { BUILTIN_COMMANDS, MODEL_CHOICES, matchCommands, type SlashCmd } from "../slashCommands";
import { useStore, useWorktree } from "../store";
import type { AgentEventPayload, AgentView, ChatEvent, TerminalFlowNode, TerminalSize } from "../types";

const LOD_ZOOM = 0.6;
export const GRID = 24;
// All multiples of GRID so nodes stay on the grid.
export const TERM_SIZES: Record<TerminalSize, { width: number; height: number }> = {
  S: { width: 480, height: 408 },
  M: { width: 648, height: 552 },
  L: { width: 864, height: 720 },
};

/** An agent block on the worktree canvas: the agent panel plus a size picker and an input handle. */
export function AgentNode({ id, data }: NodeProps<TerminalFlowNode>) {
  const lod = useFlowStore((s) => s.transform[2] < LOD_ZOOM);
  const { updateNode } = useReactFlow();
  const size = data.size ?? "M";
  return (
    <AgentPanel
      className="node node-agent"
      path={data.worktreePath}
      view={data.view ?? "chat"}
      onView={(v) => updateNode(id, { data: { ...data, view: v } })}
      lod={lod}
      extra={
        <>
          <Handle type="target" position={Position.Left} />
          <span className="seg" title="블록 크기">
            {(Object.keys(TERM_SIZES) as TerminalSize[]).map((s) => (
              <button key={s} data-on={s === size || undefined} onClick={() => updateNode(id, { ...TERM_SIZES[s], data: { ...data, size: s } })}>
                {s}
              </button>
            ))}
          </span>
        </>
      }
    />
  );
}

/**
 * One agent in its own worktree, as a chat or as its real terminal (same process either way).
 * Used as a canvas block and as the full-screen agent view.
 */
export function AgentPanel({ path, view, onView, lod = false, lead, extra, className }: {
  path: string;
  view: AgentView;
  onView: (v: AgentView) => void;
  lod?: boolean;
  lead?: React.ReactNode; // header, before the status
  extra?: React.ReactNode; // header, before the discard button
  className: string;
}) {
  const wt = useWorktree(path);
  const { remove, setError } = useStore();
  const events = useTranscript(wt?.root ?? "", path);
  const items = useMemo(() => fold(events), [events]);
  if (!wt) return null;
  const running = wt.status === "RUNNING";

  const discard = async () => {
    const ask = wt.isMaestro
      ? "마에스트로를 없앱니다. 프로젝트 폴더와 브랜치는 그대로 두고, 에이전트와 워커 연결만 지워요."
      : wt.external
        ? "이 워크트리에서 에이전트만 뗍니다. Maestro 밖에서 만든 워크트리라 폴더와 브랜치는 그대로 둬요."
        : `워크트리와 브랜치 '${wt.branch}'를 삭제합니다.\n커밋하지 않은 작업, 이 브랜치의 커밋, 대화 기록이 사라집니다.`;
    if (!confirm(ask)) return;
    try {
      await ipc.discardWorktree(wt.root, wt.path, wt.branch);
      remove(wt.path);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <div className={className} data-view={view}>
      <header>
        {lead}
        <StatusDot w={wt} />
        <b className="ellipsis" title={`브랜치 ${wt.branch}`}>{wt.name}</b>
        <span className="agent-tag muted small"><AgentLogo id={wt.adapterId} size={14} />{agentLabel(wt.adapterId)}</span>
        <span className="spacer" />
        <span className="seg" title="보기 방식">
          {(["chat", "cli"] as AgentView[]).map((v) => (
            <button key={v} data-on={v === view || undefined} onClick={() => onView(v)}>
              {v === "chat" ? "Chat" : "CLI"}
            </button>
          ))}
        </span>
        {extra}
        <button className="icon danger trash" title="워크트리 폐기" aria-label="워크트리 폐기" onClick={discard}>
          {/* trash outline (Lucide "trash-2", ISC) */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" />
          </svg>
        </button>
      </header>
      {!wt.adapterId ? (
        <AttachAgent wt={wt} />
      ) : lod ? (
        <div className="lod">{lastText(items) || <span className="muted">아직 대화가 없어요</span>}</div>
      ) : (
        <>
          {view === "cli" ? (
            <>
              <ApprovalCards path={wt.path} />
              <XTerm root={wt.root} path={wt.path} />
            </>
          ) : (
            <ChatBody root={wt.root} path={wt.path} items={items} running={running} onOpenCli={() => onView("cli")} />
          )}
        </>
      )}
    </div>
  );
}

export function useTranscript(root: string, path: string) {
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
  | { kind: "note"; text: string; error?: boolean };

export function fold(events: ChatEvent[]): Item[] {
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
    } else if (ev.type === "local_command") items.push({ kind: "note", text: ev.text });
    else if (ev.type === "interrupted") items.push({ kind: "note", text: "중단됨" });
  }
  return items;
}

export function lastText(items: Item[]) {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "text" || it.kind === "user") return it.text.split("\n").slice(-3).join("\n");
  }
  return "";
}

const toolTarget = (input: any) =>
  input?.file_path ?? input?.command ?? input?.pattern ?? input?.path ?? input?.url ?? input?.description ?? "";

// ---------- views ----------

export type Boot = "starting" | "trust" | "ready" | { error: string };

/** Starts the agent's TUI (if needed) and tracks it until it takes input. Every agent view waits on this. */
export function useAgentBoot(root: string, path: string, enabled = true) {
  const [boot, setBoot] = useState<Boot>("starting");
  const check = () => {
    setBoot("starting");
    ipc.agentReady(root, path)
      .then((r) => setBoot(r.trustPrompt ? "trust" : "ready"))
      .catch((e) => setBoot({ error: String(e) }));
  };
  // no agent on this worktree yet (found in the repo): nothing to start until one is attached
  useEffect(() => void (enabled && root && check()), [root, path, enabled]);
  const trust = () => ipc.acceptTrust(path).then(check, (e) => setBoot({ error: String(e) }));
  return { boot, retry: check, trust };
}

/** Chat view, shown only once the agent's TUI is up: input pasted earlier would be lost. */
function ChatBody({ root, path, items, running, onOpenCli }: { root: string; path: string; items: Item[]; running: boolean; onOpenCli: () => void }) {
  const { boot, retry: check, trust } = useAgentBoot(root, path);

  if (boot === "ready")
    return (
      <>
        <Messages items={items} running={running} />
        <ApprovalCards path={path} />
        <Composer root={root} path={path} running={running} />
      </>
    );
  return (
    <div className="boot">
      {boot === "starting" ? (
        <>
          <span className="spinner" />
          <span className="muted">Claude Code 준비 중…</span>
        </>
      ) : boot === "trust" ? (
        <>
          <b>이 폴더를 신뢰할까요?</b>
          <span className="muted small">Claude Code가 이 워크트리를 처음 열어서, 폴더 안의 파일과 설정을 믿어도 되는지 물어요.</span>
          <div className="boot-actions">
            <button className="primary" onClick={trust}>신뢰하고 시작</button>
            <button onClick={onOpenCli}>CLI에서 보기</button>
          </div>
        </>
      ) : (
        <>
          <span className="err wrap">{boot.error}</span>
          <button onClick={check}>다시 시도</button>
        </>
      )}
    </div>
  );
}

// Follow new output while the user is at the bottom; leave them alone once they scroll up.
function useStickyScroll(items: Item[], running: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    if (stick.current && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [items, running]);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };
  return { ref, onScroll };
}

function Messages({ items, running }: { items: Item[]; running: boolean }) {
  return (
    <div className="messages nodrag nowheel" {...useStickyScroll(items, running)}>
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
          case "note":
            return <div key={i} className={`msg-note small${it.error ? " err" : " muted"}`}>{it.text}</div>;
        }
      })}
      {running && (
        <div className="thinking muted small">
          <span className="spinner" /> 작업 중…
        </div>
      )}
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

// Links can't navigate: a click would replace the whole app in the webview. Show the URL instead.
const MD_COMPONENTS: Components = {
  a: ({ href, children }) => <span className="md-link" title={href}>{children}</span>,
};

/** Agent replies are Markdown (GitHub flavor: tables, task lists, strikethrough). */
function RichText({ text }: { text: string }) {
  return (
    <div className="msg-text md">
      <Markdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>{text}</Markdown>
    </div>
  );
}

function Composer({ root, path, running }: { root: string; path: string; running: boolean }) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const setError = useStore((s) => s.setError);
  // Claude Code's built-ins and model list only apply to Claude; other agents get just the project's commands
  const claude = useWorktree(path)?.adapterId === "claude-code";
  const builtins = claude ? BUILTIN_COMMANDS : [];
  const [cmds, setCmds] = useState<SlashCmd[]>(builtins);
  const [hi, setHi] = useState(0);
  const [menuClosed, setMenuClosed] = useState(false); // Esc hides the menu until the text changes

  useEffect(() => {
    ipc.slashCommands(path).then((c) => setCmds([...builtins, ...c])).catch(() => {});
  }, [path, claude]);

  // Like the TUI: `/` at the start opens the command menu, `!` runs a shell command.
  // `/model ` lists models here, since the TUI's own model picker isn't visible from chat.
  const slash = /^\/(\S*)$/.exec(text);
  const modelArg = claude ? /^\/model\s+(\S*)$/.exec(text) : null;
  const matches = menuClosed
    ? []
    : modelArg
      ? matchCommands(MODEL_CHOICES, modelArg[1])
      : slash
        ? matchCommands(cmds, slash[1]).slice(0, 8)
        : [];
  const bash = text.startsWith("!");
  const pick = (c: SlashCmd) => {
    setHi(0);
    if (modelArg) return send(`/model ${c.name}`);
    setText(`/${c.name} `);
  };

  const send = async (t = text) => {
    if (!t.trim()) return;
    if (claude && t.trim() === "/model") return setText("/model "); // open the model list instead of the TUI picker
    try {
      await ipc.send(root, path, t, files);
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
      data-mode={bash ? "bash" : undefined}
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
      {!!matches.length && (
        <div className="slash-menu nowheel" role="listbox">
          {matches.map((c, i) => (
            <div
              key={c.name}
              role="option"
              aria-selected={i === hi}
              className="slash-item"
              onMouseEnter={() => setHi(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the textarea
                pick(c);
              }}
            >
              <b>{modelArg ? c.name : `/${c.name}`}</b>
              <span className="ellipsis muted">{c.description}</span>
              <span className="spacer" />
              {c.note ? <span className="slash-note">{c.note}</span> : <span className="muted small">{c.source}</span>}
            </div>
          ))}
        </div>
      )}
      {bash && <div className="bash-hint small">! Bash 모드 · 에이전트 터미널에서 이 명령을 바로 실행해요</div>}
      <textarea
        className="nodrag nowheel"
        rows={2}
        value={text}
        placeholder="메시지 입력 · Enter 전송 · / 명령어 · ! 셸 명령"
        onChange={(e) => {
          setText(e.target.value);
          setHi(0);
          setMenuClosed(false);
        }}
        onKeyDown={(e) => {
          // isComposing: don't act while a Korean syllable is still being composed
          if (e.nativeEvent.isComposing) return;
          if (matches.length) {
            const n = matches.length;
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setHi((hi + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
              return;
            }
            if (e.key === "Escape") return setMenuClosed(true);
            const cur = matches[Math.min(hi, n - 1)];
            // Tab completes; Enter completes (or, for a model, sends), or sends when the command is already fully typed
            if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey && (modelArg || text !== `/${cur.name}`))) {
              e.preventDefault();
              return pick(cur);
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="composer-actions">
        <span className="muted small">파일을 끌어와 첨부</span>
        <span className="spacer" />
        {running && <button title="지금 작업을 멈춰요 (터미널의 Esc)" onClick={() => ipc.stop(path).catch(setError)}>중단</button>}
        <button className="primary" disabled={!text.trim()} onClick={() => send()}>보내기</button>
      </div>
    </div>
  );
}
