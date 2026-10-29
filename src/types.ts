// Subset of PRD 6.3 implemented so far.
import type { Edge, Node } from "@xyflow/react";

export type AgentStatus = "SPAWNING" | "RUNNING" | "NEEDS_INPUT" | "IDLE" | "ERROR" | "TERMINATED";
export type AgentState = { kind: AgentStatus; exitCode?: number | null };

export type Repo = { root: string; name: string; defaultBranch: string };
export type SessionInfo = { sessionId: string; adapterId: string; state: AgentState; allocatedPort: number | null };
export type WorktreeInfo = { path: string; branch: string; session: SessionInfo | null };

export type PromptInputBlockData = {
  label: string;
  attachedContextPaths: string[]; // relative to each worktree root
  lastSentPrompt?: string;
};

// Session and status live in the store, keyed by worktreePath, so a saved canvas never holds stale session ids.
export type PtyTerminalNodeData = {
  worktreePath: string;
  branchName: string;
};

export type PromptFlowNode = Node<PromptInputBlockData, "prompt_input_primitive">;
export type TerminalFlowNode = Node<PtyTerminalNodeData, "pty_terminal_node">;
export type CanvasNode = PromptFlowNode | TerminalFlowNode;
export type CanvasEdge = Edge<{ kind: "command_pipe" }>;

export interface CanvasStateSchema {
  version: "1.0.0";
  rootPath: string;
  activeSkillId: string;
  activeThemeId: string;
  viewport: { x: number; y: number; zoom: number };
  nodes: Array<Pick<CanvasNode, "id" | "type" | "position" | "width" | "height" | "data">>;
  edges: Array<Pick<CanvasEdge, "id" | "source" | "target" | "data">>;
}

export type PtyStdoutBatchEvent = { sessionId: string; dataB64: string; strippedTail: string[]; seq: number };
export type AgentStateEvent = { sessionId: string; state: AgentState };
