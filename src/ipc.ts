import { invoke } from "@tauri-apps/api/core";
import type { Repo, SessionInfo, WorktreeInfo } from "./types";

export const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function textToB64(text: string) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const ipc = {
  listRepos: () => invoke<Repo[]>("list_repos"),
  addRepo: (path: string) => invoke<Repo>("add_repo", { path }),
  removeRepo: (root: string) => invoke<void>("remove_repo", { root }),
  listWorktrees: (projectRoot: string) => invoke<WorktreeInfo[]>("list_worktrees", { projectRoot }),
  createWorktree: (req: { projectRoot: string; adapterId: string; branchName: string; baseBranch: string; cols: number; rows: number }) =>
    invoke<WorktreeInfo>("spawn_worktree_agent", { req }),
  startSession: (req: { worktreePath: string; adapterId: string; cols: number; rows: number }) => invoke<SessionInfo>("start_session", { req }),
  discardWorktree: (projectRoot: string, worktreePath: string, branch: string) => invoke<void>("discard_worktree", { projectRoot, worktreePath, branch }),
  kill: (sessionId: string) => invoke<void>("kill_session", { sessionId }),
  dispatchPrompt: (sessionIds: string[], prompt: string, contextFiles: string[] = []) =>
    invoke<void>("dispatch_prompt_to_sessions", { sessionIds, prompt, contextFiles }),
  writeRaw: (sessionId: string, text: string) => invoke<void>("write_raw_stdin", { sessionId, dataB64: textToB64(text) }),
  resize: (sessionId: string, cols: number, rows: number) => invoke<void>("resize_pty", { sessionId, cols, rows }),
  scrollback: (sessionId: string) => invoke<{ dataB64: string; seq: number }>("get_session_scrollback", { sessionId }),
  listDir: (path: string) => invoke<Array<{ name: string; isDir: boolean }>>("list_dir", { path }),
  gitStatus: (worktreePath: string) => invoke<Array<{ code: string; path: string }>>("git_status", { worktreePath }),
  gitDiff: (worktreePath: string, file: string) => invoke<string>("git_diff_file", { worktreePath, file }),
  loadCanvas: (projectRoot: string) => invoke<string | null>("load_canvas_state", { projectRoot }),
  saveCanvas: (projectRoot: string, stateJson: string) => invoke<void>("save_canvas_state", { projectRoot, stateJson }),
};
