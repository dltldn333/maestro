import { invoke } from "@tauri-apps/api/core";

export const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function textToB64(text: string) {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export type SpawnRes = { sessionId: string; worktreePath: string; branchName: string; allocatedPort: number | null };

export const ipc = {
  openProject: (path: string) => invoke<string>("open_project", { path }),
  spawn: (req: { projectRoot: string; adapterId: string; branchName: string; baseBranch: string; cols: number; rows: number }) =>
    invoke<SpawnRes>("spawn_worktree_agent", { req }),
  dispatchPrompt: (sessionIds: string[], prompt: string, contextFiles: string[] = []) =>
    invoke<void>("dispatch_prompt_to_sessions", { sessionIds, prompt, contextFiles }),
  writeRaw: (sessionId: string, text: string) => invoke<void>("write_raw_stdin", { sessionId, dataB64: textToB64(text) }),
  resize: (sessionId: string, cols: number, rows: number) => invoke<void>("resize_pty", { sessionId, cols, rows }),
  scrollback: (sessionId: string) => invoke<{ dataB64: string; seq: number }>("get_session_scrollback", { sessionId }),
  kill: (sessionId: string) => invoke<void>("kill_session", { sessionId }),
  discard: (sessionId: string) => invoke<void>("discard_session", { sessionId }),
  listSessions: (projectRoot: string) => invoke<string[]>("list_sessions", { projectRoot }),
  loadCanvas: (projectRoot: string) => invoke<string | null>("load_canvas_state", { projectRoot }),
  saveCanvas: (projectRoot: string, stateJson: string) => invoke<void>("save_canvas_state", { projectRoot, stateJson }),
};
