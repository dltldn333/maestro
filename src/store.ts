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
  baseBranch: string | null;
  docs: string[];
  status: AgentStatus;
  unread: boolean; // finished a turn while not selected (Orca-style attention dot)
};

/**
 * A tab above the stage (besides the project's own, always first): a worktree went into, or a file opened.
 * `preview` (VS Code's preview tab): opened by a single click, replaced by the next one; editing, sending,
 * double-clicking it or what it shows makes it stay.
 */
export type StageTab = ({ kind: "wt"; path: string } | { kind: "file"; base: string; rel: string; diff: boolean }) & { preview?: boolean };
type Editor = { base: string; rel: string; diff: boolean };
/** A place in the tab history (back / forward): the project, the agent under the stage, the file over it. */
type Nav = { root: string | null; path: string | null; editor: Editor | null };
export const fileKey = (base: string, rel: string) => `${base}|${rel}`;

type Store = {
  /** the repo list has been read once (before that, "no repos" would be a lie) */
  ready: boolean;
  /** repos whose worktrees have been read at least once (or failed to read) */
  scanned: string[];
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
  /** goes to a worktree (null = the project); pin = a lasting tab instead of the preview one */
  select: (path: string | null, pin?: boolean) => void;
  upsert: (root: string, info: WorktreeInfo) => void;
  onAgentState: (path: string, status: AgentStatus) => void;
  remove: (path: string) => void;
  cli: CliStatus | null; // which agent CLIs are installed
  loadCli: () => Promise<CliStatus>;
  /** file open in the code editor over the stage; diff = compared with HEAD. Opening one also gives it a tab. */
  editor: Editor | null;
  openEditor: (e: Editor | null, pin?: boolean) => void;
  /** the stage's tabs, per project root */
  tabs: Record<string, StageTab[]>;
  /** a preview tab of the active project becomes a lasting one */
  pinTab: (tab: StageTab) => void;
  /** places visited, for the tab bar's back / forward */
  nav: { list: Nav[]; i: number };
  goNav: (dir: -1 | 1) => void;
  /** closes a tab of the active project; closing the one on screen moves to its neighbour (or the project) */
  closeTab: (tab: StageTab) => void;
  /** files with unsaved edits (fileKey), so their tab shows ● and asks before closing */
  dirtyFiles: string[];
  setFileDirty: (key: string, dirty: boolean) => void;
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
  baseBranch: w.baseBranch,
  docs: w.docs,
  status: w.state.kind,
  unread: prev?.unread ?? false,
});

const same = (a: string, b: string | null) => !!b && a.toLowerCase() === b.toLowerCase();

const sameTab = (a: StageTab, b: StageTab) =>
  a.kind === "wt" ? b.kind === "wt" && same(a.path, b.path) : b.kind === "file" && same(a.base, b.base) && a.rel === b.rel;

/**
 * `tabs` after opening `tab` in `root`. Already open: it stays where it is (a file's edit/diff mode is updated),
 * and stays a preview only if this open is one too. New: pinned at the end, or as the preview, which takes the
 * old preview's place.
 */
const withTab = (tabs: Record<string, StageTab[]>, root: string | null, tab: StageTab, pin: boolean) => {
  if (!root) return tabs;
  const list = tabs[root] ?? [];
  const i = list.findIndex((t) => sameTab(t, tab));
  if (i >= 0) return { ...tabs, [root]: list.map((t, j) => (j === i ? { ...tab, preview: !!t.preview && !pin } : t)) };
  const next = { ...tab, preview: !pin };
  const p = pin ? -1 : list.findIndex((t) => t.preview);
  return { ...tabs, [root]: p < 0 ? [...list, next] : list.map((t, j) => (j === p ? next : t)) };
};

/** The tab on screen: the open file's, else the selected worktree's; null = the project's own. */
export const activeTab = (s: { editor: Editor | null; selectedPath: string | null }): StageTab | null =>
  s.editor ? { kind: "file", ...s.editor } : s.selectedPath ? { kind: "wt", path: s.selectedPath } : null;
export const isActiveTab = (t: StageTab, s: { editor: Editor | null; selectedPath: string | null }) => {
  const a = activeTab(s);
  return !!a && sameTab(t, a);
};

const navKey = (n: Nav) => `${n.root}|${n.path}|${n.editor ? fileKey(n.editor.base, n.editor.rel) : ""}`;
/** A history entry can be gone back to while its project, worktree and file's worktree still exist (a closed tab reopens). */
const navValid = (n: Nav, s: Pick<Store, "repos" | "worktrees">) => {
  const known = (p: string) => same(p, n.root) || s.worktrees.some((w) => same(w.path, p));
  return s.repos.some((r) => r.root === n.root) && (!n.path || known(n.path)) && (!n.editor || known(n.editor.base));
};
/** The nearest entry back (-1) or forward (1) that can still be gone to, or -1. */
export const navTarget = (s: Pick<Store, "repos" | "worktrees" | "nav">, dir: -1 | 1) => {
  for (let j = s.nav.i + dir; j >= 0 && j < s.nav.list.length; j += dir) if (navValid(s.nav.list[j], s)) return j;
  return -1;
};

// where you were (project, agent), so a reload (Ctrl+R, HMR) comes back to it; storage may be unavailable
const LOCATION_KEY = "maestro.location";
const savedLocation = (): { root?: string; path?: string | null } => {
  try {
    return JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "{}");
  } catch {
    return {};
  }
};

export const useStore = create<Store>((set, get) => ({
  ready: false,
  scanned: [],
  repos: [],
  activeRoot: null,
  worktrees: [],
  selectedPath: null,
  error: "",
  setError: (e) => set({ error: e ? String(e) : "" }),

  loadRepos: async () => {
    // unreadable repos.json → show the (empty) app with the error rather than loading forever
    const repos = await ipc.listRepos().catch((e) => (set({ ready: true }), Promise.reject(e)));
    const last = savedLocation();
    const back = repos.some((r) => r.root === last.root);
    set({
      ready: true,
      repos,
      activeRoot: get().activeRoot ?? (back ? last.root! : (repos[0]?.root ?? null)),
      // the agent is shown once its worktree has loaded (App looks it up among them)
      selectedPath: get().selectedPath ?? (back ? (last.path ?? null) : null),
    });
    const { activeRoot, selectedPath } = get();
    if (selectedPath) set((s) => ({ tabs: withTab(s.tabs, activeRoot, { kind: "wt", path: selectedPath }, true) }));
    // one unreadable repo (moved, not a git repo anymore) must not keep the others from loading
    const failed = (await Promise.allSettled(repos.map((r) => get().refreshWorktrees(r.root))))
      .map((res, i) => (res.status === "rejected" ? `${repos[i].name}: ${res.reason}` : ""))
      .filter(Boolean);
    if (failed.length) get().setError(`워크트리를 읽지 못한 저장소가 있어요\n${failed.join("\n")}`);
  },
  addRepo: async (path) => {
    const repo = await ipc.addRepo(path);
    set((s) => ({ repos: s.repos.some((r) => r.root === repo.root) ? s.repos : [...s.repos, repo], activeRoot: repo.root, selectedPath: null, editor: null }));
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
    try {
      const list = await ipc.listWorktrees(root);
      set((s) => {
        const prev = new Map(s.worktrees.map((w) => [w.path, w]));
        return { worktrees: [...s.worktrees.filter((w) => w.root !== root), ...list.map((w) => fromInfo(root, w, prev.get(w.path)))] };
      });
    } finally {
      if (!get().scanned.includes(root)) set((s) => ({ scanned: [...s.scanned, root] }));
    }
  },
  // the open file belongs to the worktree on screen, so going elsewhere takes it off the stage (its tab stays)
  setActive: (root) => set({ activeRoot: root, selectedPath: null, editor: null }),
  select: (path, pin = false) =>
    set((s) => ({
      selectedPath: path,
      editor: null,
      worktrees: s.worktrees.map((w) => (w.path === path ? { ...w, unread: false } : w)),
      tabs: path ? withTab(s.tabs, s.activeRoot, { kind: "wt", path }, pin) : s.tabs,
    })),
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
  remove: (path) =>
    set((s) => ({
      worktrees: s.worktrees.filter((w) => w.path !== path),
      selectedPath: s.selectedPath === path ? null : s.selectedPath,
      editor: s.editor && same(s.editor.base, path) ? null : s.editor,
      // the discarded worktree's tab and its files' tabs go with it
      tabs: Object.fromEntries(Object.entries(s.tabs).map(([r, ts]) => [r, ts.filter((t) => !same(t.kind === "wt" ? t.path : t.base, path))])),
    })),
  cli: null,
  loadCli: async () => {
    const cli = await ipc.cliStatus();
    set({ cli });
    return cli;
  },
  editor: null,
  openEditor: (editor, pin = false) => set((s) => ({ editor, tabs: editor ? withTab(s.tabs, s.activeRoot, { kind: "file", ...editor }, pin) : s.tabs })),
  tabs: {},
  pinTab: (tab) =>
    set((s) => {
      const list = (s.activeRoot && s.tabs[s.activeRoot]) || [];
      if (!list.some((t) => t.preview && sameTab(t, tab))) return s;
      return { tabs: { ...s.tabs, [s.activeRoot!]: list.map((t) => (sameTab(t, tab) ? { ...t, preview: false } : t)) } };
    }),
  nav: { list: [], i: -1 },
  goNav: (dir) => {
    const s = get();
    const j = navTarget(s, dir);
    if (j < 0) return;
    const n = s.nav.list[j];
    // its tab may have been closed or replaced by a newer preview since: it comes back as the preview
    const tab = activeTab({ editor: n.editor, selectedPath: n.path });
    const tabs = tab ? withTab(s.tabs, n.root, tab, false) : s.tabs;
    set({ activeRoot: n.root, selectedPath: n.path, editor: n.editor, tabs, nav: { list: s.nav.list, i: j } });
  },
  closeTab: (tab) => {
    const s = get();
    const list = (s.activeRoot && s.tabs[s.activeRoot]) || [];
    const i = list.findIndex((t) => sameTab(t, tab));
    if (i < 0) return;
    const rest = list.filter((_, j) => j !== i);
    set({
      tabs: { ...s.tabs, [s.activeRoot!]: rest },
      dirtyFiles: tab.kind === "file" ? s.dirtyFiles.filter((k) => k !== fileKey(tab.base, tab.rel)) : s.dirtyFiles,
    });
    if (!isActiveTab(tab, s)) return;
    const next = rest[i - 1] ?? rest[i];
    if (next?.kind === "file") return set({ editor: { base: next.base, rel: next.rel, diff: next.diff } });
    get().select(next?.kind === "wt" ? next.path : null, !next?.preview); // also clears the editor, in one step
  },
  dirtyFiles: [],
  setFileDirty: (key, dirty) =>
    set((s) => (dirty === s.dirtyFiles.includes(key) ? s : { dirtyFiles: dirty ? [...s.dirtyFiles, key] : s.dirtyFiles.filter((k) => k !== key) })),
  approvals: [],
  addApproval: (a) => set((s) => ({ approvals: s.approvals.some((x) => x.id === a.id) ? s.approvals : [...s.approvals, a] })),
  dropApproval: (id) => set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) })),
}));

// every new place goes into the back / forward history (going back itself lands on an entry, so adds nothing)
useStore.subscribe((s) => {
  if (!s.ready) return;
  const cur: Nav = { root: s.activeRoot, path: s.selectedPath, editor: s.editor };
  const at = s.nav.list[s.nav.i];
  if (at && navKey(at) === navKey(cur)) return;
  const list = [...s.nav.list.slice(0, s.nav.i + 1), cur].slice(-50);
  useStore.setState({ nav: { list, i: list.length - 1 } });
});

useStore.subscribe((s, prev) => {
  if (!s.ready || (s.activeRoot === prev.activeRoot && s.selectedPath === prev.selectedPath)) return;
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ root: s.activeRoot, path: s.selectedPath }));
  } catch {}
});

export const useWorktree =(path: string) => useStore((s) => s.worktrees.find((w) => w.path === path));
export const useApprovals = (path: string) => useStore(useShallow((s) => s.approvals.filter((a) => same(a.worktreePath, path))));
