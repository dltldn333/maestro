import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Canvas } from "./Canvas";
import { NewAgentDialog } from "./NewAgentDialog";
import { RightPanel } from "./RightPanel";
import { Sidebar } from "./Sidebar";
import { useStore } from "./store";
import type { AgentStatePayload, Repo } from "./types";

// Orca-style shell: repos/agents sidebar | CLI canvas | files & changes panel.
export default function App() {
  const { repos, activeRoot, error, loadRepos, onAgentState, setError } = useStore();
  const [dialogRepo, setDialogRepo] = useState<Repo | null>(null);
  const activeRepo = repos.find((r) => r.root === activeRoot);

  useEffect(() => {
    loadRepos().catch(setError);
    const un = listen<AgentStatePayload>("agent://state", (e) => onAgentState(e.payload.worktreePath, e.payload.state.kind));
    return () => void un.then((f) => f());
  }, []);

  return (
    <div className="app">
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
      {dialogRepo && <NewAgentDialog repo={dialogRepo} onClose={() => setDialogRepo(null)} />}
      {error && (
        <div className="toast" onClick={() => setError("")} title="닫기">
          {error}
        </div>
      )}
    </div>
  );
}
