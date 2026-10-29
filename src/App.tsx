import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Canvas } from "./Canvas";
import { NewAgentDialog } from "./NewAgentDialog";
import { RightPanel } from "./RightPanel";
import { SettingsDialog } from "./SettingsDialog";
import { Sidebar } from "./Sidebar";
import { useStore } from "./store";
import type { AgentStatePayload, Repo } from "./types";

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

// Orca-style shell: repos/agents sidebar | CLI canvas | files & changes panel.
export default function App() {
  const { repos, activeRoot, error, loadRepos, onAgentState, setError } = useStore();
  const [dialogRepo, setDialogRepo] = useState<Repo | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLeft, setShowLeft] = usePanelPref("maestro.showLeft");
  const [showRight, setShowRight] = usePanelPref("maestro.showRight");
  const activeRepo = repos.find((r) => r.root === activeRoot);

  useEffect(() => {
    loadRepos().catch(setError);
    const un = listen<AgentStatePayload>("agent://state", (e) => onAgentState(e.payload.worktreePath, e.payload.state.kind));
    return () => void un.then((f) => f());
  }, []);

  return (
    <div className="app" data-hide-left={!showLeft || undefined} data-hide-right={!showRight || undefined}>
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
        {activeRepo && <span className="muted" data-tauri-drag-region>{activeRepo.name}</span>}
        <span className="spacer" data-tauri-drag-region />
        <button className="icon" title="설정" onClick={() => setSettingsOpen(true)}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <circle cx="10" cy="10" r="2.5" />
            <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" strokeLinecap="round" />
          </svg>
        </button>
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
        <Sidebar onNewWorktree={setDialogRepo} />
        <main className="stage">
          {activeRoot ? (
            <Canvas key={activeRoot} root={activeRoot} onNewAgent={() => activeRepo && setDialogRepo(activeRepo)} />
          ) : (
            <div className="empty">
              <p>왼쪽에서 Git 저장소를 추가하세요.</p>
              <p className="muted">에이전트마다 ~/.maestro/projects/ 아래에 격리된 워크트리가 만들어지고, 원본 폴더에는 파일이 생기지 않아요.</p>
            </div>
          )}
        </main>
        <RightPanel />
      </div>
      {dialogRepo && <NewAgentDialog repo={dialogRepo} onClose={() => setDialogRepo(null)} />}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
      {error && (
        <div className="toast" onClick={() => setError("")} title="닫기">
          {error}
        </div>
      )}
    </div>
  );
}
