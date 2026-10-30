import { open } from "@tauri-apps/plugin-dialog";
import { GearIcon } from "./SettingsDialog";
import { AgentLogo } from "./NewAgentDialog";
import { useApprovals, useStore, type Worktree } from "./store";
import type { Repo } from "./types";

const STATUS_LABEL: Record<string, string> = { RUNNING: "작업 중", IDLE: "대기", TERMINATED: "꺼짐" };

export function StatusDot({ w }: { w: Worktree }) {
  const waiting = useApprovals(w.path).length > 0;
  return <span className="dot" data-status={w.status} data-unread={w.unread || undefined} data-waiting={waiting || undefined} title={waiting ? "승인 대기" : undefined} />;
}

/**
 * A repo's worktrees in hierarchy order, as the canvas arrows draw it: the Maestro first with its workers
 * nested below, then the worktrees nobody leads (`loose`, only marked when there is a Maestro).
 */
function treeRows(wts: Worktree[]) {
  const key = (p: string) => p.toLowerCase();
  const byPath = new Map(wts.map((w) => [key(w.path), w]));
  const led = new Set(wts.flatMap((w) => w.workers.map(key)));
  const rows: Array<{ w: Worktree; depth: number; loose: boolean }> = [];
  const seen = new Set<string>();
  let loose = false;
  const walk = (w: Worktree, depth: number) => {
    if (seen.has(key(w.path))) return;
    seen.add(key(w.path));
    rows.push({ w, depth, loose });
    for (const p of w.workers) {
      const c = byPath.get(key(p));
      if (c) walk(c, depth + 1);
    }
  };
  wts.filter((w) => w.isMaestro).forEach((w) => walk(w, 0));
  loose = rows.length > 0;
  wts.filter((w) => !led.has(key(w.path))).forEach((w) => walk(w, 0));
  wts.forEach((w) => walk(w, 0)); // only reachable through a broken (cyclic) link file
  return rows;
}

export function Sidebar({ onNewWorktree, onOpenSettings }: { onNewWorktree: (repo: Repo) => void; onOpenSettings: () => void }) {
  const { ready, repos, activeRoot, worktrees, selectedPath, addRepo, removeRepo, setActive, select, setError, approvals } = useStore();
  const waitingPaths = new Set(approvals.map((a) => a.worktreePath.toLowerCase()));

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
                  title="새 에이전트 블록"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(r.root);
                    onNewWorktree(r);
                  }}
                >
                  +
                </button>
              </div>
              {treeRows(wts).map(({ w, depth, loose }, i, rows) => (
                <div key={w.path}>
                  {loose && !rows[i - 1]?.loose && <div className="wt-group muted small">상위 없는 워크트리</div>}
                  <div
                    className="wt-row"
                    data-maestro={w.isMaestro || undefined}
                    data-selected={w.path === selectedPath || undefined}
                    style={{ paddingLeft: 22 + depth * 16 }}
                    title={w.path}
                    onClick={() => {
                      if (r.root !== activeRoot) setActive(r.root);
                      select(w.path);
                    }}
                  >
                    {depth > 0 && <span className="wt-elbow" aria-hidden />}
                    <StatusDot w={w} />
                    <AgentLogo id={w.adapterId} size={14} />
                    {w.isMaestro && <span className="maestro-crown" title="이 프로젝트의 마에스트로">♛</span>}
                    <span className="wt-branch" title={w.name !== w.branch ? `브랜치 ${w.branch}` : undefined}>{w.name}</span>
                    <span className="spacer" />
                    <span className="muted small">
                      {waitingPaths.has(w.path.toLowerCase()) ? "승인 대기" : STATUS_LABEL[w.status]}
                    </span>
                  </div>
                </div>
              ))}
              {!wts.length && (
                <div className="wt-empty muted small" onClick={() => onNewWorktree(r)}>
                  + 에이전트 블록 만들기
                </div>
              )}
            </section>
          );
        })}
        {ready && !repos.length && (
          <div className="sb-empty">
            <p className="muted">로컬 Git 저장소를 추가하면 에이전트 블록마다 격리된 워크트리에서 에이전트를 실행할 수 있어요.</p>
            <button onClick={pickRepo}>저장소 추가</button>
          </div>
        )}
      </div>
      <div className="sb-foot">
        <button className="sb-settings" onClick={onOpenSettings}>
          <GearIcon />
          설정
        </button>
      </div>
    </aside>
  );
}
