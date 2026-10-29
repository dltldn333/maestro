import { create } from "zustand";
import { ipc } from "./ipc";
import type { AgentStatus, Repo, WorktreeInfo } from "./types";

export type Worktree = {
  root: string;
  path: string;
  branch: string;
  sessionId?: string;
  adapterId?: string;
  port?: number;
  status: AgentStatus;
  unread: boolean; // went idle/finished while not selected (Orca-style attention dot)
};

type Store = {
  repos: Repo[];
  activeRoot: string | null;
  worktrees: Worktree[];
  selectedPath: string | null;
  error: string;
  setError: (e: unknown) => void;
  loadRepos: () => Promise<void>;
  addRepo: (path: string) => Promise<void>;
  removeRepo: (root: string) => Promise<void>;
  refreshWorktrees: (root: string) => Promise<void>;
  setActive: (root: string) => void;
  select: (path: string | null) => void;
  upsert: (root: string, info: WorktreeInfo) => void;
  patch: (path: string, p: Partial<Worktree>) => void;
  onAgentState: (sessionId: string, status: AgentStatus) => void;
  remove: (path: string) => void;
};

const fromInfo = (root: string, w: WorktreeInfo, prev?: Worktree): Worktree => ({
  root,
  path: w.path,
  branch: w.branch,
  sessionId: w.session?.sessionId,
  adapterId: w.session?.adapterId ?? prev?.adapterId,
  port: w.session?.allocatedPort ?? undefined,
  status: w.session?.state.kind ?? "TERMINATED",
  unread: prev?.unread ?? false,
});

export const useStore = create<Store>((set, get) => ({
  repos: [],
  activeRoot: null,
  worktrees: [],
  selectedPath: null,
  error: "",
  setError: (e) => set({ error: e ? String(e) : "" }),

  loadRepos: async () => {
    const repos = await ipc.listRepos();
    set({ repos, activeRoot: get().activeRoot ?? repos[0]?.root ?? null });
    await Promise.all(repos.map((r) => get().refreshWorktrees(r.root)));
  },
  addRepo: async (path) => {
    const repo = await ipc.addRepo(path);
    set((s) => ({ repos: s.repos.some((r) => r.root === repo.root) ? s.repos : [...s.repos, repo], activeRoot: repo.root, selectedPath: null }));
    await get().refreshWorktrees(repo.root);
  },
  removeRepo: async (root) => {
    await ipc.removeRepo(root);
    set((s) => {
      const repos = s.repos.filter((r) => r.root !== root);
      return {
        repos,
        worktrees: s.worktrees.filter((w) => w.root !== root),
        activeRoot: s.activeRoot === root ? (repos[0]?.root ?? null) : s.activeRoot,
      };
    });
  },
  refreshWorktrees: async (root) => {
    const list = await ipc.listWorktrees(root);
    set((s) => {
      const prev = new Map(s.worktrees.map((w) => [w.path, w]));
      return { worktrees: [...s.worktrees.filter((w) => w.root !== root), ...list.map((w) => fromInfo(root, w, prev.get(w.path)))] };
    });
  },
  setActive: (root) => set({ activeRoot: root, selectedPath: null }),
  select: (path) => set((s) => ({ selectedPath: path, worktrees: s.worktrees.map((w) => (w.path === path ? { ...w, unread: false } : w)) })),
  upsert: (root, info) =>
    set((s) => {
      const prev = s.worktrees.find((w) => w.path === info.path);
      const next = fromInfo(root, info, prev);
      return { worktrees: prev ? s.worktrees.map((w) => (w.path === info.path ? next : w)) : [...s.worktrees, next] };
    }),
  patch: (path, p) => set((s) => ({ worktrees: s.worktrees.map((w) => (w.path === path ? { ...w, ...p } : w)) })),
  onAgentState: (sessionId, status) =>
    set((s) => ({
      worktrees: s.worktrees.map((w) =>
        w.sessionId !== sessionId
          ? w
          : { ...w, status, unread: w.unread || (status !== "RUNNING" && w.path !== s.selectedPath) },
      ),
    })),
  remove: (path) => set((s) => ({ worktrees: s.worktrees.filter((w) => w.path !== path), selectedPath: s.selectedPath === path ? null : s.selectedPath })),
}));

export const useWorktree = (path: string) => useStore((s) => s.worktrees.find((w) => w.path === path));
