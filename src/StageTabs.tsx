import { AgentLogo } from "./NewAgentDialog";
import { StatusDot } from "./Sidebar";
import { activeTab, fileKey, isActiveTab, navTarget, useStore, type StageTab } from "./store";

const NO_TABS: StageTab[] = [];
// outlines after Lucide (ISC): "file", "folder" (the project), "chevron-left/right"
const FILE_ICON = "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6";
const PROJECT_ICON = "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z";

function Icon({ d, size = 13 }: { d: string; size?: number }) {
  return (
    <svg className="tree-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d} />
    </svg>
  );
}

/**
 * Tabs above the stage, per project: the project's own canvas first (always there), then each worktree
 * gone into and each file opened. A single click opens the preview tab (italic, reused by the next one);
 * editing, sending or a double click keeps it. Back / forward on the right walk the places visited.
 */
export function StageTabs() {
  const root = useStore((s) => s.activeRoot);
  const repo = useStore((s) => s.repos.find((r) => r.root === s.activeRoot));
  const tabs = useStore((s) => (s.activeRoot && s.tabs[s.activeRoot]) || NO_TABS);
  const worktrees = useStore((s) => s.worktrees);
  const dirtyFiles = useStore((s) => s.dirtyFiles);
  // selected separately: a selector building a new object each call would re-render forever
  const editor = useStore((s) => s.editor);
  const selectedPath = useStore((s) => s.selectedPath);
  const canBack = useStore((s) => navTarget(s, -1) >= 0);
  const canForward = useStore((s) => navTarget(s, 1) >= 0);
  const state = { editor, selectedPath };
  const onScreen = activeTab(state);
  const { select, openEditor, closeTab, pinTab, goNav } = useStore.getState();
  if (!root || !repo) return null;

  const go = (t: StageTab | null) => {
    if (t?.kind === "file") return openEditor({ base: t.base, rel: t.rel, diff: t.diff }, !t.preview);
    select(t?.path ?? null, !t?.preview);
  };
  const close = (t: StageTab) => {
    if (t.kind === "file" && dirtyFiles.includes(fileKey(t.base, t.rel)) && !confirm("저장하지 않은 변경이 있어요. 닫을까요?")) return;
    closeTab(t);
  };

  return (
    <div className="stage-tabs">
      <div className="stage-tab-list" role="tablist">
        <button className="stage-tab home" role="tab" aria-selected={!onScreen} data-on={!onScreen || undefined} title={repo.root} onClick={() => go(null)}>
          <Icon d={PROJECT_ICON} />
          <span className="ellipsis">{repo.name}</span>
        </button>
        {tabs.map((t) => {
          const on = isActiveTab(t, state);
          const wt = t.kind === "wt" ? worktrees.find((w) => w.path.toLowerCase() === t.path.toLowerCase()) : undefined;
          if (t.kind === "wt" && !wt) return null; // its worktree is gone (or not read yet)
          const name = t.kind === "wt" ? wt!.name : t.rel.split("/").pop()!;
          const dirty = t.kind === "file" && dirtyFiles.includes(fileKey(t.base, t.rel));
          return (
            <div
              key={t.kind === "wt" ? t.path : fileKey(t.base, t.rel)}
              className="stage-tab"
              role="tab"
              aria-selected={on}
              data-on={on || undefined}
              data-preview={t.preview || undefined}
              title={`${t.kind === "wt" ? `${wt!.name}\n브랜치 ${wt!.branch}` : `${t.rel}${t.diff ? " (변경 비교)" : ""}`}${t.preview ? "\n미리보기: 더블클릭하면 탭을 고정해요" : ""}`}
              onClick={() => go(t)}
              onDoubleClick={() => pinTab(t)}
              // middle click closes, as in browsers and editors
              onAuxClick={(e) => e.button === 1 && close(t)}
            >
              {wt ? (
                <>
                  <StatusDot w={wt} />
                  <AgentLogo id={wt.adapterId} size={13} />
                </>
              ) : (
                <Icon d={FILE_ICON} />
              )}
              <span className="ellipsis">{name}</span>
              {t.kind === "file" && t.diff && <span className="muted small">비교</span>}
              <button
                className="stage-tab-x"
                data-dirty={dirty || undefined}
                title={dirty ? "저장하지 않음 · 닫기" : "닫기"}
                aria-label={`${name} 닫기`}
                onClick={(e) => {
                  e.stopPropagation();
                  close(t);
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="stage-nav">
        <button className="icon" title="뒤로" aria-label="뒤로" disabled={!canBack} onClick={() => goNav(-1)}>
          <Icon d="m15 18-6-6 6-6" size={15} />
        </button>
        <button className="icon" title="앞으로" aria-label="앞으로" disabled={!canForward} onClick={() => goNav(1)}>
          <Icon d="m9 18 6-6-6-6" size={15} />
        </button>
      </div>
    </div>
  );
}
