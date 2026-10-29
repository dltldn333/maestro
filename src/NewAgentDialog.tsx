import { useState } from "react";
import { ipc } from "./ipc";
import { useSettings } from "./settings";
import { useStore } from "./store";
import type { Repo } from "./types";

export const AGENTS: Array<{ id: string; label: string; disabled?: boolean }> = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex (준비 중)", disabled: true },
];

const PERMISSIONS = [
  { id: "acceptEdits", label: "파일 수정만 자동 허용", hint: "명령 실행 등 나머지 권한이 필요한 도구는 거부돼요." },
  { id: "auto", label: "자동 판단", hint: "Claude가 안전하다고 판단한 작업을 자동으로 허용해요." },
  { id: "bypassPermissions", label: "모두 허용 (주의)", hint: "확인 없이 모든 명령을 실행해요. 격리된 워크트리라도 컴퓨터 전체에 영향을 줄 수 있어요." },
  { id: "plan", label: "계획만", hint: "파일을 바꾸지 않고 계획만 세워요." },
];

/** New CLI block: pick an agent; Maestro makes its worktree and starts it. */
export function NewAgentDialog({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const count = useStore((s) => s.worktrees.filter((w) => w.root === repo.root).length);
  const { upsert, select } = useStore();
  const [agent, setAgent] = useState(useSettings.getState().defaultAgent);
  const [perm, setPerm] = useState("acceptEdits");
  const [branch, setBranch] = useState(`agent-${count + 1}`);
  const [base, setBase] = useState(repo.defaultBranch);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const info = await ipc.createAgent({ projectRoot: repo.root, adapterId: agent, permissionMode: perm, branchName: branch.trim(), baseBranch: base.trim() || "HEAD" });
      upsert(repo.root, info);
      select(info.path);
      onClose();
    } catch (e) {
      setErr(String(e));
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <form className="modal" onSubmit={submit} onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}>
        <h3>새 CLI 블록 · {repo.name}</h3>
        <div className="agent-pick">
          {AGENTS.map((a) => (
            <button type="button" key={a.id} disabled={a.disabled} data-on={a.id === agent || undefined} onClick={() => setAgent(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        <label>
          권한
          <select value={perm} onChange={(e) => setPerm(e.target.value)}>
            {PERMISSIONS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <span className="muted small">{PERMISSIONS.find((p) => p.id === perm)?.hint}</span>
        </label>
        {more ? (
          <>
            <label>
              브랜치
              <input value={branch} onChange={(e) => setBranch(e.target.value)} />
            </label>
            <label>
              기준 브랜치
              <input value={base} onChange={(e) => setBase(e.target.value)} />
            </label>
          </>
        ) : (
          <button type="button" className="link muted small" onClick={() => setMore(true)}>
            브랜치 {branch} · 기준 {base} — 변경
          </button>
        )}
        {err && <p className="err wrap">{err}</p>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>취소</button>
          <button type="submit" className="primary" autoFocus disabled={busy || !branch.trim()}>{busy ? "시작하는 중…" : "만들고 실행"}</button>
        </div>
      </form>
    </div>
  );
}
