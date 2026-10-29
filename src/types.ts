// Subset of PRD 6.3 implemented by the MVP.
import type { Edge, Node } from "@xyflow/react";

export type AgentStatus = "SPAWNING" | "RUNNING" | "NEEDS_INPUT" | "IDLE" | "ERROR" | "TERMINATED";

export type PromptInputBlockData = {
  label: string;
  lastSentPrompt?: string;
};

export type PtyTerminalNodeData = {
  sessionId: string;
  adapterId: string;
  worktreePath: string;
  branchName: string;
  allocatedPort?: number;
  status: AgentStatus;
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
export type AgentStateEvent = { sessionId: string; state: { kind: AgentStatus; exitCode?: number | null } };
