import { open } from "@tauri-apps/plugin-dialog";
import { useStore, type Worktree } from "./store";
import type { Repo } from "./types";

const ADAPTER_LABEL: Record<string, string> = { "claude-code": "Claude Code" };
const STATUS_LABEL: Record<string, string> = { RUNNING: "작업 중", IDLE: "대기", TERMINATED: "꺼짐" };

export function StatusDot({ w }: { w: Worktree }) {
  return <span className="dot" data-status={w.status} data-unread={w.unread || undefined} />;
}

export function Sidebar({ onNewWorktree }: { onNewWorktree: (repo: Repo) => void }) {
  const { repos, activeRoot, worktrees, selectedPath, addRepo, removeRepo, setActive, select, setError } = useStore();

  const pickRepo = async () => {
    try {
      const dir = await open({ directory: true, title: "Git 저장소 선택" });
      if (typeof dir === "string") await addRepo(dir);
    } catch (e) {
      setError(e);
    }
  };

  return (
    <aside className="sidebar">
      <div className="sb-head">
        <span>저장소</span>
        <button className="icon" title="저장소 추가" onClick={pickRepo}>+</button>
      </div>
      <div className="sb-body">
        {repos.map((r) => {
          const wts = worktrees.filter((w) => w.root === r.root);
          return (
            <section key={r.root} className="repo" data-active={r.root === activeRoot || undefined}>
              <div className="repo-row" onClick={() => setActive(r.root)} title={r.root}>
                <span className="repo-name">{r.name}</span>
                <span className="muted">{r.defaultBranch}</span>
                <span className="spacer" />
                <button
                  className="icon hover-only"
                  title="저장소 목록에서 제거 (파일은 그대로)"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(`'${r.name}'을 목록에서 제거할까요? 디스크의 파일과 워크트리는 지우지 않습니다.`)) removeRepo(r.root).catch(setError);
                  }}
                >
                  ×
                </button>
                <button
                  className="icon"
                  title="새 CLI 블록"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(r.root);
                    onNewWorktree(r);
                  }}
                >
                  +
                </button>
              </div>
              {wts.map((w) => (
                <div
                  key={w.path}
                  className="wt-row"
                  data-selected={w.path === selectedPath || undefined}
                  title={w.path}
                  onClick={() => {
                    if (r.root !== activeRoot) setActive(r.root);
                    select(w.path);
                  }}
                >
                  <StatusDot w={w} />
                  <span className="wt-branch">{w.branch}</span>
                  <span className="spacer" />
                  <span className="muted small">
                    {[ADAPTER_LABEL[w.adapterId ?? ""], STATUS_LABEL[w.status]].filter(Boolean).join(" · ")}
                  </span>
                </div>
              ))}
              {!wts.length && (
                <div className="wt-empty muted small" onClick={() => onNewWorktree(r)}>
                  + CLI 블록 만들기
                </div>
              )}
            </section>
          );
        })}
        {!repos.length && (
          <div className="sb-empty">
            <p className="muted">로컬 Git 저장소를 추가하면 CLI 블록마다 격리된 워크트리에서 에이전트를 실행할 수 있어요.</p>
            <button onClick={pickRepo}>저장소 추가</button>
          </div>
        )}
      </div>
    </aside>
  );
}
