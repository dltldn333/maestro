import { AgentPanel } from "./nodes/AgentNode";
import { useSettings } from "./settings";
import { useStore } from "./store";

/** Full screen ↔ canvas, inside a worktree. */
export function LayoutToggle() {
  const { agentLayout, set } = useSettings();
  return (
    <span className="seg layout-toggle" title="보기 방식">
      <button data-on={agentLayout === "full" || undefined} onClick={() => set({ agentLayout: "full" })}>전체 화면</button>
      <button data-on={agentLayout === "canvas" || undefined} onClick={() => set({ agentLayout: "canvas" })}>캔버스</button>
    </span>
  );
}

/** The default worktree view: its agent filling the stage, like the Claude Code app. */
export function AgentFull({ root, path }: { root: string; path: string }) {
  const repoName = useStore((s) => s.repos.find((r) => r.root === root)?.name ?? "");
  const setActive = useStore((s) => s.setActive);
  const { fullView, set } = useSettings();
  return (
    <AgentPanel
      className="agent-full"
      path={path}
      view={fullView}
      onView={(v) => set({ fullView: v })}
      lead={<button title="프로젝트 캔버스로" onClick={() => setActive(root)}>← {repoName}</button>}
      extra={<LayoutToggle />}
    />
  );
}
