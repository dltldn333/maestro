// Subset of PRD 6.3 implemented so far.
import type { Edge, Node } from "@xyflow/react";

export type AgentStatus = "RUNNING" | "IDLE" | "TERMINATED";

export type Repo = { root: string; name: string; defaultBranch: string };
export type WorktreeInfo = {
  path: string;
  branch: string;
  adapterId: string | null;
  permissionMode: string | null;
  name: string | null;
  description: string | null;
  state: { kind: AgentStatus };
  /** the project's Maestro (coordinator) on the project folder itself */
  isMaestro: boolean;
  /** child worktree paths: its workers in the project hierarchy */
  workers: string[];
  /** Markdown files it refers to */
  refs: string[];
  /** made outside Maestro (found in the repo); may have no agent yet */
  external: boolean;
  /** titles of the personas linked to it */
  personas: string[];
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
  view?: AgentView; // same conversation, two renderings
};

export type AgentView = "chat" | "cli";

export type PromptFlowNode = Node<PromptInputBlockData, "prompt_input_primitive">;
export type TerminalFlowNode = Node<PtyTerminalNodeData, "pty_terminal_node">;
/** Project canvas: one summary card per worktree; clicking it opens that worktree's canvas. */
export type WorktreeCardNode = Node<{ worktreePath: string }, "worktree_card">;
/** A Markdown file placed on a canvas; shows only its top `#` heading for now. */
export type MarkdownNode = Node<{ path: string; title: string }, "markdown_block">;
export type CanvasNode = PromptFlowNode | TerminalFlowNode | WorktreeCardNode | MarkdownNode;
/**
 * command_pipe: prompt block → agent block (saved with the canvas)
 * orchestrates: parent → worker worktree, reference: Markdown block → worktree (both drawn from agent settings)
 */
export type CanvasEdge = Edge<{ kind: "command_pipe" | "orchestrates" | "reference" }>;

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
export type CliStatus = { agents: Array<{ id: string; installed: boolean; installCmd: string }>; npm: boolean };
export type Approval = { id: number; worktreePath: string; toolName: string; toolInput: any; canAlways: boolean };
export type ApprovalChoice = "allow" | "always" | "deny" | "cli";
export type PtyDataPayload = { worktreePath: string; dataB64: string; seq: number };
