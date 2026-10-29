import { invoke } from "@tauri-apps/api/core";
import type { ChatEvent, Repo, WorktreeInfo } from "./types";

export const ipc = {
  listRepos: () => invoke<Repo[]>("list_repos"),
  addRepo: (path: string) => invoke<Repo>("add_repo", { path }),
  removeRepo: (root: string) => invoke<void>("remove_repo", { root }),
  listWorktrees: (projectRoot: string) => invoke<WorktreeInfo[]>("list_worktrees", { projectRoot }),
  createAgent: (req: { projectRoot: string; adapterId: string; permissionMode: string; branchName: string; baseBranch: string }) =>
    invoke<WorktreeInfo>("create_agent", { req }),
  send: (projectRoot: string, worktreePath: string, text: string, filesAttached: string[] = []) =>
    invoke<void>("send_message", { projectRoot, worktreePath, text, filesAttached }),
  stop: (worktreePath: string) => invoke<void>("stop_agent", { worktreePath }),
  transcript: (projectRoot: string, worktreePath: string) => invoke<{ events: ChatEvent[]; seq: number }>("get_transcript", { projectRoot, worktreePath }),
  discardWorktree: (projectRoot: string, worktreePath: string, branch: string) => invoke<void>("discard_worktree", { projectRoot, worktreePath, branch }),
  listDir: (path: string) => invoke<Array<{ name: string; isDir: boolean }>>("list_dir", { path }),
  gitStatus: (worktreePath: string) => invoke<Array<{ code: string; path: string }>>("git_status", { worktreePath }),
  gitDiff: (worktreePath: string, file: string) => invoke<string>("git_diff_file", { worktreePath, file }),
  loadCanvas: (projectRoot: string) => invoke<string | null>("load_canvas_state", { projectRoot }),
  saveCanvas: (projectRoot: string, stateJson: string) => invoke<void>("save_canvas_state", { projectRoot, stateJson }),
};
