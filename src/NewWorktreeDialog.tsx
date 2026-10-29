import { useState } from "react";
import { ipc } from "./ipc";
import { useStore } from "./store";
import type { Repo } from "./types";

export function NewWorktreeDialog({ repo, onClose }: { repo: Repo; onClose: () => void }) {
  const count = useStore((s) => s.worktrees.filter((w) => w.root === repo.root).length);
  const { upsert, select } = useStore();
  const [branch, setBranch] = useState(`agent-${count + 1}`);
  const [base, setBase] = useState(repo.defaultBranch);
  const [adapter, setAdapter] = useState("claude-code");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const info = await ipc.createWorktree({ projectRoot: repo.root, adapterId: adapter, branchName: branch.trim(), baseBranch: base.trim() || "HEAD", cols: 100, rows: 28 });
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
        <h3>새 워크트리 · {repo.name}</h3>
        <label>
          브랜치
          <input autoFocus value={branch} onChange={(e) => setBranch(e.target.value)} />
        </label>
        <label>
          기준 브랜치
          <input value={base} onChange={(e) => setBase(e.target.value)} />
        </label>
        <label>
          에이전트
          <select value={adapter} onChange={(e) => setAdapter(e.target.value)}>
            <option value="claude-code">Claude Code</option>
            <option value="shell">Shell</option>
          </select>
        </label>
        {err && <p className="err wrap">{err}</p>}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>취소</button>
          <button type="submit" className="primary" disabled={busy || !branch.trim()}>{busy ? "만드는 중…" : "만들기"}</button>
        </div>
      </form>
    </div>
  );
}
