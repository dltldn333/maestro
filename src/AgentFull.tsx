import { AgentPanel } from "./nodes/AgentNode";
import { useSettings } from "./settings";

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
export function AgentFull({ path }: { path: string }) {
  const { fullView, set } = useSettings();
  return <AgentPanel className="agent-full" path={path} view={fullView} onView={(v) => set({ fullView: v })} extra={<LayoutToggle />} />;
}
