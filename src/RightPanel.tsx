import { useEffect, useState } from "react";
import { ipc } from "./ipc";
import { useStore } from "./store";
import { MD_MIME } from "./LibraryPanel";

export const DRAG_MIME = "application/x-maestro-path";

export function RightPanel() {
  const { repos, activeRoot, worktrees, selectedPath } = useStore();
  const wt = worktrees.find((w) => w.path === selectedPath && w.root === activeRoot);
  const repo = repos.find((r) => r.root === activeRoot);
  const [tab, setTab] = useState<"files" | "changes">("files");
  if (!repo) return <aside className="rightpanel" />;
  const base = wt?.path ?? repo.root;

  return (
    <aside className="rightpanel">
      <div className="rp-head">
        <div className="tabs">
          <button data-on={tab === "files" || undefined} onClick={() => setTab("files")}>파일</button>
          <button data-on={tab === "changes" || undefined} onClick={() => setTab("changes")}>변경사항</button>
        </div>
        <div className="muted small ellipsis" title={base}>{wt ? wt.branch : `${repo.name} (원본)`}</div>
      </div>
      <div className="rp-body">
        {tab === "files" ? <Tree key={base} base={base} rel="" depth={0} /> : <Changes key={base} path={base} status={wt?.status} />}
      </div>
    </aside>
  );
}

function Tree({ base, rel, depth }: { base: string; rel: string; depth: number }) {
  const [items, setItems] = useState<Array<{ name: string; isDir: boolean }> | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    ipc.listDir(rel ? `${base}/${rel}` : base).then(setItems).catch((e) => setErr(String(e)));
  }, [base, rel]);
  if (err) return <div className="err small" style={{ paddingLeft: 8 + depth * 12 }}>{err}</div>;
  if (!items) return null;
  return (
    <>
      {items.map((it) => (
        <TreeItem key={it.name} base={base} rel={rel ? `${rel}/${it.name}` : it.name} name={it.name} isDir={it.isDir} depth={depth} />
      ))}
    </>
  );
}

function TreeItem({ base, rel, name, isDir, depth }: { base: string; rel: string; name: string; isDir: boolean; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div
        className="tree-row"
        style={{ paddingLeft: 8 + depth * 12 }}
        draggable
        title={`${rel} — 프롬프트 블록으로 끌어서 첨부`}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_MIME, rel);
          // a Markdown file can also become a canvas block (title is read on drop)
          if (/\.md$/i.test(rel)) e.dataTransfer.setData(MD_MIME, JSON.stringify({ path: `${base.replace(/\\/g, "/")}/${rel}`, title: "" }));
          e.dataTransfer.effectAllowed = "copy";
        }}
        onClick={() => isDir && setOpen(!open)}
      >
        <span className="tree-caret">{isDir ? (open ? "▾" : "▸") : ""}</span>
        <span className={isDir ? "tree-dir" : ""}>{name}</span>
      </div>
      {isDir && open && <Tree base={base} rel={rel} depth={depth + 1} />}
    </>
  );
}

function Changes({ path, status }: { path: string; status?: string }) {
  const [files, setFiles] = useState<Array<{ code: string; path: string }>>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [diff, setDiff] = useState("");
  const [err, setErr] = useState("");

  const refresh = () =>
    ipc.gitStatus(path).then((f) => {
      setFiles(f);
      setErr("");
    }).catch((e) => setErr(String(e)));

  // re-read whenever the agent goes quiet, i.e. probably finished an edit
  useEffect(() => {
    refresh();
  }, [path, status]);

  useEffect(() => {
    if (sel) ipc.gitDiff(path, sel).then(setDiff).catch((e) => setDiff(String(e)));
  }, [path, sel, files]);

  return (
    <div className="changes">
      <div className="changes-head">
        <span className="muted small">{files.length}개 파일 변경</span>
        <span className="spacer" />
        <button className="icon" title="새로고침" onClick={refresh}>↻</button>
      </div>
      {err && <div className="err small wrap">{err}</div>}
      {files.map((f) => (
        <div key={f.path} className="change-row" data-selected={f.path === sel || undefined} onClick={() => setSel(f.path === sel ? null : f.path)}>
          <span className="code" data-code={f.code.trim()[0]}>{f.code.trim() || "?"}</span>
          <span className="ellipsis" title={f.path}>{f.path}</span>
        </div>
      ))}
      {sel && (
        <pre className="diff">
          {diff.split("\n").map((l, i) => (
            <div key={i} className={l.startsWith("+") && !l.startsWith("+++") ? "add" : l.startsWith("-") && !l.startsWith("---") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
              {l || " "}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}
