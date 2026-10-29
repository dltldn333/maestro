import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Canvas } from "./Canvas";
import { NewWorktreeDialog } from "./NewWorktreeDialog";
import { RightPanel } from "./RightPanel";
import { Sidebar } from "./Sidebar";
import { useStore } from "./store";
import type { AgentStateEvent, Repo } from "./types";

// Orca-style shell: repos/worktrees sidebar | CLI canvas | files & changes panel.
export default function App() {
  const { activeRoot, error, loadRepos, onAgentState, setError } = useStore();
  const [dialogRepo, setDialogRepo] = useState<Repo | null>(null);

  useEffect(() => {
    loadRepos().catch(setError);
    const un = listen<AgentStateEvent>("agent://state", (e) => onAgentState(e.payload.sessionId, e.payload.state.kind));
    return () => void un.then((f) => f());
  }, []);

  return (
    <div className="app">
      <Sidebar onNewWorktree={setDialogRepo} />
      <main className="stage">
        {activeRoot ? (
          <Canvas key={activeRoot} root={activeRoot} />
        ) : (
          <div className="empty">
            <p>왼쪽에서 Git 저장소를 추가하세요.</p>
            <p className="muted">에이전트마다 ~/.maestro/projects/ 아래에 격리된 워크트리가 만들어지고, 원본 폴더에는 파일이 생기지 않아요.</p>
          </div>
        )}
      </main>
      <RightPanel />
      {dialogRepo && <NewWorktreeDialog repo={dialogRepo} onClose={() => setDialogRepo(null)} />}
      {error && (
        <div className="toast" onClick={() => setError("")} title="닫기">
          {error}
        </div>
      )}
    </div>
  );
}
