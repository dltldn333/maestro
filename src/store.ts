import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "./ipc";
import type { AgentStatus, Approval, CliStatus, Repo, WorktreeInfo } from "./types";

export type Worktree = {
  root: string;
  path: string;
  branch: string;
  /** user-given name, falling back to the branch */
  name: string;
  description?: string;
  adapterId?: string;
  isMaestro: boolean;
  workers: string[];
  refs: string[];
  external: boolean;
  personas: string[];
  status: AgentStatus;
  unread: boolean; // finished a turn while not selected (Orca-style attention dot)
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
  onAgentState: (path: string, status: AgentStatus) => void;
  remove: (path: string) => void;
  cli: CliStatus | null; // which agent CLIs are installed
  loadCli: () => Promise<CliStatus>;
  approvals: Approval[]; // permission prompts waiting for an answer, from the agents' hooks
  addApproval: (a: Approval) => void;
  dropApproval: (id: number) => void;
};

const fromInfo = (root: string, w: WorktreeInfo, prev?: Worktree): Worktree => ({
  root,
  path: w.path,
  branch: w.branch,
  name: w.name || w.branch,
  description: w.description ?? undefined,
  adapterId: w.adapterId ?? undefined,
  isMaestro: w.isMaestro,
  workers: w.workers,
  refs: w.refs,
  external: w.external,
  personas: w.personas,
  status: w.state.kind,
  unread: prev?.unread ?? false,
});

const same = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();

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
    // one unreadable repo (moved, not a git repo anymore) must not keep the others from loading
    const failed = (await Promise.allSettled(repos.map((r) => get().refreshWorktrees(r.root))))
      .map((res, i) => (res.status === "rejected" ? `${repos[i].name}: ${res.reason}` : ""))
      .filter(Boolean);
    if (failed.length) get().setError(`워크트리를 읽지 못한 저장소가 있어요\n${failed.join("\n")}`);
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
  onAgentState: (path, status) =>
    set((s) => ({
      worktrees: s.worktrees.map((w) =>
        !same(w.path, path) ? w : { ...w, status, unread: w.unread || (status !== "RUNNING" && w.path !== s.selectedPath) },
      ),
    })),
  remove: (path) => set((s) => ({ worktrees: s.worktrees.filter((w) => w.path !== path), selectedPath: s.selectedPath === path ? null : s.selectedPath })),
  cli: null,
  loadCli: async () => {
    const cli = await ipc.cliStatus();
    set({ cli });
    return cli;
  },
  approvals: [],
  addApproval: (a) => set((s) => ({ approvals: s.approvals.some((x) => x.id === a.id) ? s.approvals : [...s.approvals, a] })),
  dropApproval: (id) => set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),
}));

export const useWorktree = (path: string) => useStore((s) => s.worktrees.find((w) => w.path === path));
export const useApprovals = (path: string) => useStore(useShallow((s) => s.approvals.filter((a) => same(a.worktreePath, path))));
