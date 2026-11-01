import { lazy, Suspense, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Canvas } from "./Canvas";
import { ProjectMap } from "./ProjectMap";
import { NewAgentDialog } from "./NewAgentDialog";
import { RightPanel } from "./RightPanel";
import { SettingsDialog } from "./SettingsDialog";
import { AgentFull, LayoutToggle } from "./AgentFull";
import { useSettings } from "./settings";
import { Sidebar } from "./Sidebar";
import { activeTab, fileKey, useStore, type StageTab } from "./store";
import { StageTabs } from "./StageTabs";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "./ipc";
import type { AgentStatePayload, Approval, Repo } from "./types";

// Per-viewer panel visibility; storage may be unavailable, so default to shown.
function usePanelPref(key: string) {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(key) !== "0";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {}
  };
  return [on, set] as const;
}

// Per-viewer side panel width (px), clamped; same storage caveats as above.
function usePanelWidth(key: string, def: number, min: number, max: number) {
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const [w, setW] = useState(() => {
    try {
      const v = Number(localStorage.getItem(key));
      return v ? clamp(v) : def;
    } catch {
      return def;
    }
  });
  const set = (v: number) => {
    setW(clamp(v));
    try {
      localStorage.setItem(key, String(clamp(v)));
    } catch {}
  };
  return [w, set, def] as const;
}

/** Drag handle between a side panel and the stage; double-click restores the default width. */
function Resizer({ side, width, set, def, onDrag }: { side: "left" | "right"; width: number; set: (v: number) => void; def: number; onDrag: (on: boolean) => void }) {
  const dir = side === "left" ? 1 : -1;
  return (
    <div
      className="resizer"
      data-side={side}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      title="드래그해서 너비 조절 · 더블클릭하면 기본값"
      onDoubleClick={() => set(def)}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const el = e.currentTarget;
        const x0 = e.clientX;
        el.setPointerCapture(e.pointerId);
        onDrag(true);
        el.onpointermove = (m) => set(width + dir * (m.clientX - x0));
        el.onpointerup = el.onpointercancel = () => {
          el.onpointermove = el.onpointerup = el.onpointercancel = null;
          onDrag(false);
        };
      }}
    />
  );
}

// Monaco is several MB: loaded on the first file opened, not at startup
const CodeView = lazy(() => import("./CodeView"));

const win = getCurrentWindow();

function PanelIcon({ side }: { side: "left" | "right" }) {
  const x = side === "left" ? 6.5 : 13.5;
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <rect x="2.5" y="3.5" width="15" height="13" rx="3" />
      <line x1={x} y1="3.5" x2={x} y2="16.5" />
    </svg>
  );
}

// Orca-style shell: repos/agents sidebar | agent canvas | files & changes panel.
export default function App() {
  const { repos, activeRoot, error, loadRepos, onAgentState, setError } = useStore();
  // new worktree / worker / Maestro dialog
  const [dialog, setDialog] = useState<{ repo: Repo; maestro?: boolean; parentPath?: string } | null>(null);
  const setDialogRepo = (repo: Repo | null) => setDialog(repo && { repo });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLeft, setShowLeft] = usePanelPref("maestro.showLeft");
  const [showRight, setShowRight] = usePanelPref("maestro.showRight");
  const [leftW, setLeftW, leftDef] = usePanelWidth("maestro.leftWidth", 260, 180, 480);
  const [rightW, setRightW, rightDef] = usePanelWidth("maestro.rightWidth", 300, 220, 560);
  const [resizing, setResizing] = useState(false);
  const activeRepo = repos.find((r) => r.root === activeRoot);
  // nothing selected → the project map; an agent (the Maestro too) → its full view or its canvas
  const agentLayout = useSettings((s) => s.agentLayout);
  const awayMinutes = useSettings((s) => s.awayMinutes);
  useEffect(() => void ipc.setAway(activeRoot, awayMinutes).catch(() => {}), [activeRoot, awayMinutes]);
  const scope = useStore((s) => s.worktrees.find((w) => w.path === s.selectedPath && w.root === activeRoot)?.path);
  const editor = useStore((s) => s.editor);
  const fileTabs = useStore(useShallow((s) => Object.values(s.tabs).flat().filter((t): t is Extract<StageTab, { kind: "file" }> => t.kind === "file")));
  // until the repos and this project's worktrees are read, "add a repo" or an empty map would be wrong
  const loading = useStore((s) => !s.ready || (!!s.activeRoot && !s.scanned.includes(s.activeRoot)));
  // the sidebar's settings button is out of reach while it's hidden → show one by the zoom bar
  const openSettingsHere = showLeft ? undefined : () => setSettingsOpen(true);

  useEffect(() => {
    loadRepos().catch(setError);
    // no agent CLI at all → nothing works yet; open settings, where they can be installed
    useStore.getState().loadCli().then((c) => !c.agents.some((a) => a.installed) && setSettingsOpen(true)).catch(() => {});
    const { addApproval, dropApproval } = useStore.getState();
    ipc.listApprovals().then((list) => list.forEach(addApproval)).catch(() => {});
    const uns = [
      listen<AgentStatePayload>("agent://state", (e) => onAgentState(e.payload.worktreePath, e.payload.state.kind)),
      listen<Approval>("agent://approval", (e) => addApproval(e.payload)),
      listen<{ id: number }>("agent://approval-done", (e) => dropApproval(e.payload.id)),
      // an agent ran `maestro worktree create`
      listen<string>("maestro://worktrees", (e) => useStore.getState().refreshWorktrees(e.payload).catch(setError)),
    ];
    return () => uns.forEach((un) => void un.then((f) => f()));
  }, []);

  return (
    <div
      className="app"
      data-hide-left={!showLeft || undefined}
      data-hide-right={!showRight || undefined}
      data-resizing={resizing || undefined}
      style={{ "--mae-sidebar-w": `${leftW}px`, "--mae-right-w": `${rightW}px` } as React.CSSProperties}
    >
      {/* replaces the native title bar (decorations: false); drag regions don't inherit, so tag the blank parts too */}
      <header className="topbar" data-tauri-drag-region>
        <span className="brand" data-tauri-drag-region>
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <rect width="20" height="20" rx="5" fill="var(--mae-accent)" />
            <path d="M5.5 14.5v-9l4.5 6 4.5-6v9" fill="none" stroke="var(--mae-on-accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Maestro
        </span>
        <button className="icon" data-on={showLeft || undefined} title={showLeft ? "왼쪽 패널 숨기기" : "왼쪽 패널 보이기"} onClick={() => setShowLeft(!showLeft)}>
          <PanelIcon side="left" />
        </button>
        <span className="spacer" data-tauri-drag-region />
        <button className="icon" data-on={showRight || undefined} title={showRight ? "오른쪽 패널 숨기기" : "오른쪽 패널 보이기"} onClick={() => setShowRight(!showRight)}>
          <PanelIcon side="right" />
        </button>
        <div className="win-controls">
          <button title="최소화" onClick={() => win.minimize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M0 5h10" stroke="currentColor" /></svg>
          </button>
          <button title="최대화" onClick={() => win.toggleMaximize()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
          </button>
          <button className="win-close" title="닫기" onClick={() => win.close()}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
          </button>
        </div>
      </header>
      <div className="shell">
        <Sidebar onNewWorktree={setDialogRepo} onOpenSettings={() => setSettingsOpen(true)} />
        <Resizer side="left" width={leftW} set={setLeftW} def={leftDef} onDrag={setResizing} />
        <main className="stage">
          {!loading && <StageTabs />}
          {/* a double click anywhere in what a preview tab shows keeps that tab (like double-clicking the tab) */}
          <div
            className="stage-body"
            onDoubleClick={() => {
              const s = useStore.getState();
              const t = activeTab(s);
              if (t) s.pinTab(t);
            }}
          >
          {loading ? (
            <div className="empty">
              <p className="muted"><span className="spinner" /> 저장소와 워크트리를 읽는 중…</p>
            </div>
          ) : activeRoot && scope && agentLayout === "full" ? (
            <AgentFull key={scope} path={scope} />
          ) : activeRoot && scope ? (
            <Canvas
              key={`${activeRoot}|${scope}`}
              root={activeRoot}
              scope={scope}
              onNewAgent={(o) => activeRepo && setDialog({ repo: activeRepo, ...o })}
              onOpenSettings={openSettingsHere}
            />
          ) : activeRoot ? (
            <ProjectMap
              key={activeRoot}
              root={activeRoot}
              onNewAgent={() => activeRepo && setDialog({ repo: activeRepo })}
              onNewMaestro={() => activeRepo && setDialog({ repo: activeRepo, maestro: true })}
              onOpenSettings={openSettingsHere}
            />
          ) : (
            <div className="empty">
              <p>왼쪽에서 Git 저장소를 추가하세요.</p>
              <p className="muted">에이전트마다 ~/.maestro/projects/ 아래에 격리된 워크트리가 만들어지고, 원본 폴더에는 파일이 생기지 않아요.</p>
            </div>
          )}
          {/* full view has it in its header; on an agent canvas it sits in the corner */}
          {!loading && scope && agentLayout === "canvas" && (
            <div className="stage-corner">
              <LayoutToggle />
            </div>
          )}
          {/* over the stage, so the canvas or agent underneath keeps running and keeps its state;
              every open file stays mounted (hidden when not on screen) so its unsaved edits survive tab switches */}
          {fileTabs.length > 0 && (
            <Suspense fallback={editor && <div className="code-view empty"><p className="muted"><span className="spinner" /> 편집기 불러오는 중…</p></div>}>
              {fileTabs.map((t) => (
                <CodeView key={fileKey(t.base, t.rel)} base={t.base} rel={t.rel} diff={t.diff} active={!!editor && editor.base === t.base && editor.rel === t.rel} />
              ))}
            </Suspense>
          )}
          </div>
        </main>
        <Resizer side="right" width={rightW} set={setRightW} def={rightDef} onDrag={setResizing} />
        <RightPanel />
      </div>
      {dialog && <NewAgentDialog {...dialog} onClose={() => setDialog(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {error && (
        <div className="toast" onClick={() => setError("")} title="닫기">
          {error}
        </div>
      )}
    </div>
  );
}
