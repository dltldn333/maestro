import { invoke } from "@tauri-apps/api/core";
import type { Approval, ApprovalChoice, ChatEvent, CliStatus, Repo, WorktreeInfo } from "./types";

export const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export const ipc = {
  listRepos: () => invoke<Repo[]>("list_repos"),
  addRepo: (path: string) => invoke<Repo>("add_repo", { path }),
  removeRepo: (root: string) => invoke<void>("remove_repo", { root }),
  listWorktrees: (projectRoot: string) => invoke<WorktreeInfo[]>("list_worktrees", { projectRoot }),
  createAgent: (req: { projectRoot: string; adapterId: string; permissionMode: string; branchName: string; baseBranch: string; name: string; description: string; model: string }) =>
    invoke<WorktreeInfo>("create_agent", { req }),
  libraryList: (projectRoot: string) =>
    invoke<Array<{ folder: string; persona: boolean; files: Array<{ path: string; title: string }> }>>("library_list", { projectRoot }),
  personaCreate: (name: string) => invoke<string>("persona_create", { name }),
  librarySet: (projectRoot: string, folders: string[]) => invoke<void>("library_set", { projectRoot, folders }),
  mdTitle: (path: string) => invoke<string>("md_title", { path }),
  createMaestro: (req: { projectRoot: string; adapterId: string; permissionMode: string; model: string }) => invoke<WorktreeInfo>("create_maestro", { req }),
  attachAgent: (req: { projectRoot: string; worktreePath: string; adapterId: string; permissionMode: string; model: string }) => invoke<void>("attach_agent", { req }),
  linkWorktrees: (projectRoot: string, parent: string, child: string) => invoke<void>("link_worktrees", { projectRoot, parent, child }),
  unlinkWorktrees: (projectRoot: string, parent: string, child: string) => invoke<void>("unlink_worktrees", { projectRoot, parent, child }),
  /** worktree "" with on=false: drop the reference everywhere */
  setRef: (projectRoot: string, worktree: string, md: string, on: boolean) => invoke<void>("set_ref", { projectRoot, worktree, md, on }),
  send: (projectRoot: string, worktreePath: string, text: string, filesAttached: string[] = []) =>
    invoke<void>("send_message", { projectRoot, worktreePath, text, filesAttached }),
  stop: (worktreePath: string) => invoke<void>("stop_agent", { worktreePath }),
  slashCommands: (worktreePath: string) =>
    invoke<Array<{ name: string; description: string; source: string }>>("list_slash_commands", { worktreePath }),
  cliStatus: () => invoke<CliStatus>("cli_status"),
  antigravityModels: () => invoke<Array<[string, string]>>("antigravity_models"),
  setupStart: (id: string) => invoke<string>("setup_start", { id }),
  setupStop: (id: string) => invoke<void>("setup_stop", { id }),
  listApprovals: () => invoke<Approval[]>("list_approvals"),
  answerApproval: (id: number, choice: ApprovalChoice) => invoke<void>("answer_approval", { id, choice }),
  summarize: (projectRoot: string, worktreePath: string, assistantAgent: string, assistantModel: string) =>
    invoke<string | null>("summarize_agent", { projectRoot, worktreePath, assistantAgent, assistantModel }),
  agentReady: (projectRoot: string, worktreePath: string) => invoke<{ trustPrompt: boolean }>("agent_ready", { projectRoot, worktreePath }),
  acceptTrust: (worktreePath: string) => invoke<void>("accept_trust", { worktreePath }),
  ensureAgent: (projectRoot: string, worktreePath: string) => invoke<void>("ensure_agent", { projectRoot, worktreePath }),
  ptySnapshot: (worktreePath: string) => invoke<{ dataB64: string; seq: number }>("pty_snapshot", { worktreePath }),
  ptyWrite: (worktreePath: string, data: string) => invoke<void>("pty_write", { worktreePath, data }),
  ptyResize: (worktreePath: string, cols: number, rows: number) => invoke<void>("pty_resize", { worktreePath, cols, rows }),
  transcript: (projectRoot: string, worktreePath: string) => invoke<{ events: ChatEvent[]; seq: number }>("get_transcript", { projectRoot, worktreePath }),
  discardWorktree: (projectRoot: string, worktreePath: string, branch: string) => invoke<void>("discard_worktree", { projectRoot, worktreePath, branch }),
  listDir: (path: string) => invoke<Array<{ name: string; isDir: boolean }>>("list_dir", { path }),
  gitStatus: (worktreePath: string) => invoke<Array<{ code: string; path: string }>>("git_status", { worktreePath }),
  gitDiff: (worktreePath: string, file: string) => invoke<string>("git_diff_file", { worktreePath, file }),
  loadCanvas: (projectRoot: string, key: string) => invoke<string | null>("load_canvas_state", { projectRoot, key }),
  saveCanvas: (projectRoot: string, key: string, stateJson: string) => invoke<void>("save_canvas_state", { projectRoot, key, stateJson }),
};
