// Subset of PRD 6.3 implemented so far.
import type { Edge, Node } from "@xyflow/react";

export type AgentStatus = "RUNNING" | "IDLE" | "TERMINATED";

export type Repo = { root: string; name: string; defaultBranch: string };
export type WorktreeInfo = {
  path: string;
  branch: string;
  adapterId: string | null;
  permissionMode: string | null;
  state: { kind: AgentStatus };
};

export type PromptInputBlockData = {
  label: string;
  attachedContextPaths: string[]; // relative to each worktree root
  lastSentPrompt?: string;
};

export type TerminalSize = "S" | "M" | "L";

// Agent status lives in the store, keyed by worktreePath.
export type PtyTerminalNodeData = {
  worktreePath: string;
  branchName: string;
  size?: TerminalSize; // only presets, no free resizing
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

/** One transcript line: Claude stream-json events plus Maestro's own user_input / stderr / exit. */
export type ChatEvent = { type: string; [k: string]: any };
export type AgentEventPayload = { worktreePath: string; seq: number; event: ChatEvent };
export type AgentStatePayload = { worktreePath: string; state: { kind: AgentStatus } };
