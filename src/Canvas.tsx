import { useCallback, useEffect, useRef, useState } from "react";
import {
  Background,
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
  Panel,
  ReactFlow,
  ConnectionMode,
  MarkerType,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore as useFlowStore,
  type Connection,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useShallow } from "zustand/react/shallow";
import { ipc } from "./ipc";
import { PromptNode } from "./nodes/PromptNode";
import { AgentNode, GRID, TERM_SIZES, clampAgentSize } from "./nodes/AgentNode";
import { CARD_SIZE, WorktreeCard } from "./nodes/WorktreeCard";
import { MD_SIZE, MarkdownBlock } from "./nodes/MarkdownBlock";
import { LibraryPanel, MD_MIME } from "./LibraryPanel";
import { useStore, type Worktree } from "./store";
import { ViewMap } from "./ViewMap";
import { isLightTheme, motionMs, useSettings } from "./settings";
import { GearIcon } from "./SettingsDialog";
import type { CanvasEdge, CanvasNode, CanvasStateSchema } from "./types";

const nodeTypes = { prompt_input_primitive: PromptNode, pty_terminal_node: AgentNode, worktree_card: WorktreeCard, markdown_block: MarkdownBlock };

/** A hierarchy or reference line. Selecting it shows × to cut the link (same path as the Delete key). */
function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, selected }: EdgeProps) {
  const [path, x, y] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const { deleteElements } = useReactFlow();
  return (
    <>
      {/* wide invisible hit area: a thin line is hard to click */}
      <BaseEdge path={path} markerEnd={markerEnd} style={style} interactionWidth={36} />
      {selected && (
        <EdgeLabelRenderer>
          <button
            className="edge-cut nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            title="연결 끊기"
            onClick={() => deleteElements({ edges: [{ id }] })}
          >
            ×
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
const edgeTypes = { link: LinkEdge };
// every line points from its source to its target
export const ARROW = { type: MarkerType.ArrowClosed, width: 16, height: 16 };
export const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;
const snap = (v: number) => Math.round(v / GRID) * GRID;

// Older canvases may hold free-form sizes/positions; pull them onto the grid and size presets.
const normalize = (n: CanvasNode): CanvasNode => {
  const position = { x: snap(n.position.x), y: snap(n.position.y) };
  if (n.type === "pty_terminal_node") {
    // a dragged size is kept (within limits); older canvases only have a preset
    const preset = TERM_SIZES[n.data.size ?? "M"];
    return { ...n, position, ...clampAgentSize(n.width ?? preset.width, n.height ?? preset.height), deletable: false };
  }
  if (n.type === "worktree_card") return { ...n, position, ...CARD_SIZE, deletable: false };
  if (n.type === "markdown_block") return { ...n, position, ...MD_SIZE };
  return { ...n, position, width: undefined, height: undefined };
};

const folderName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** A "?" that shows how to use this canvas: pops up for a few seconds on arrival, then on demand. */
export function Guide({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setOpen(false), 6000);
    return () => clearTimeout(t);
  }, []);
  return (
    <span className="guide">
      <button className="icon" title="사용법" data-on={open || undefined} onClick={() => setOpen(!open)}>?</button>
      {open && <span className="guide-bubble small" onClick={() => setOpen(false)}>{text}</span>}
    </span>
  );
}

type Size = { width: number; height: number };

/**
 * Block positions as a tree: the Maestro on top, every worker below its parent, siblings side by side.
 * Worktrees nobody leads hang under the Maestro too (without a line), so the canvas reads top-down.
 */
export function treeLayout(worktrees: Worktree[], size: (w: Worktree) => Size = () => CARD_SIZE): Map<string, { x: number; y: number }> {
  const GAP_X = 2 * GRID, GAP_Y = 4 * GRID;
  const key = (p: string) => p.toLowerCase();
  const byPath = new Map(worktrees.map((w) => [key(w.path), w]));
  const led = new Set(worktrees.flatMap((w) => w.workers.map(key)));
  const maestro = worktrees.find((w) => w.isMaestro);
  const loose = worktrees.filter((w) => !w.isMaestro && !led.has(key(w.path)));

  type T = { w: Worktree; kids: T[]; kidsWidth: number; width: number };
  const seen = new Set<string>();
  const build = (w: Worktree): T => {
    seen.add(key(w.path));
    const own = w.workers.map((p) => byPath.get(key(p))).filter((c): c is Worktree => !!c);
    const kids: T[] = [];
    for (const c of w === maestro ? [...own, ...loose] : own) if (!seen.has(key(c.path))) kids.push(build(c));
    const kidsWidth = kids.reduce((s, k) => s + k.width, 0) + GAP_X * Math.max(0, kids.length - 1);
    return { w, kids, kidsWidth, width: Math.max(size(w).width, kidsWidth) };
  };
  const trees: T[] = [];
  // the backend keeps links a tree; the second loop only catches what a broken file would leave unreachable
  for (const w of maestro ? [maestro, ...worktrees] : [...loose, ...worktrees]) if (!seen.has(key(w.path))) trees.push(build(w));

  const out = new Map<string, { x: number; y: number }>();
  const place = (t: T, x: number, y: number) => {
    const s = size(t.w);
    out.set(t.w.path, { x: snap(x + (t.width - s.width) / 2), y });
    let cx = x + (t.width - t.kidsWidth) / 2;
    for (const k of t.kids) {
      place(k, cx, y + s.height + GAP_Y);
      cx += k.width + GAP_X;
    }
  };
  let x = 0;
  for (const t of trees) {
    place(t, x, 0);
    x += t.width + GAP_X;
  }
  return out;
}

/** Which sides of two cards face each other, so a line leaves and enters on the near sides. */
function facingSides(a?: { position: { x: number; y: number } }, b?: { position: { x: number; y: number } }): [string, string] {
  if (!a || !b) return ["bottom", "top"];
  const dx = b.position.x - a.position.x, dy = b.position.y - a.position.y;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? ["bottom", "top"] : ["top", "bottom"];
  return dx >= 0 ? ["right", "left"] : ["left", "right"];
}

const Icon = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

/** Bottom-left zoom bar: − zoom% + | fit. Clicking the percentage resets to 100%. */
export function CanvasControls({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const zoom = useFlowStore((s) => s.transform[2]);
  const { zoomIn, zoomOut, zoomTo, fitView } = useReactFlow();
  const duration = motionMs(useSettings.getState());
  return (
    <Panel position="bottom-left" className="cc-row">
      {onOpenSettings && (
        <div className="cc">
          <button title="설정" onClick={onOpenSettings}><GearIcon /></button>
        </div>
      )}
      <div className="cc">
        <button title="축소" onClick={() => zoomOut({ duration })}><Icon d="M3.5 8h9" /></button>
        <button className="cc-zoom" title="100%로" onClick={() => zoomTo(1, { duration })}>{Math.round(zoom * 100)}%</button>
        <button title="확대" onClick={() => zoomIn({ duration })}><Icon d="M3.5 8h9M8 3.5v9" /></button>
        <span className="cc-sep" />
        <button title="전체 보기" onClick={() => fitView({ padding: 0.15, maxZoom: 1, duration })}>
          <Icon d="M2.5 6V3.5a1 1 0 0 1 1-1H6M10 2.5h2.5a1 1 0 0 1 1 1V6M13.5 10v2.5a1 1 0 0 1-1 1H10M6 13.5H3.5a1 1 0 0 1-1-1V10" />
        </button>
      </div>
    </Panel>
  );
}

/**
 * The working canvases (the project map, ProjectMap.tsx, only shows the structure):
 * - Maestro canvas (`scope` = the Maestro): its agent block on top, a summary card per worktree below,
 *   hierarchy and reference lines, Markdown blocks. Links are made and cut here.
 * - worktree canvas (`scope` = a worktree): that worktree's agent block plus free prompt blocks
 * Each saves its own layout.
 */
export function Canvas({ root, scope, onNewAgent, onOpenSettings }: {
  root: string;
  scope: string;
  onNewAgent: (opts?: { parentPath?: string }) => void;
  onOpenSettings?: () => void;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<CanvasEdge>([]);
  const { getViewport, setViewport, screenToFlowPosition, fitView } = useReactFlow();
  const needsFit = useRef(false); // no saved viewport yet → frame the blocks once they exist
  const untreed = useRef(false); // no saved layout, or one from before the tree layout
  const hub = useStore((s) => s.worktrees.some((w) => w.root === root && w.isMaestro && w.path === scope));
  const worktrees = useStore(useShallow((s) => s.worktrees.filter((w) => w.root === root && (hub || w.path === scope))));
  const select = useStore((s) => s.select);
  const setError = useStore((s) => s.setError);
  const theme = useSettings((s) => s.theme);
  // bumped on every layout load, so the worktree sync below runs after *each* load. Otherwise a reload
  // that lands after the sync (HMR, a slow read) would overwrite freshly added cards with the old layout.
  const [loadGen, setLoadGen] = useState(0);
  const loaded = loadGen > 0;
  const [viewTick, setViewTick] = useState(0);
  const { setCenter, getZoom, getNode } = useReactFlow<CanvasNode, CanvasEdge>();
  const justAdded = useRef<{ x: number; y: number } | null>(null);
  const wtKey = worktrees.map((w) => `${w.path}|${w.branch}`).join("\n");
  const canvasKey = hub ? "overview" : folderName(scope); // "overview": the old project canvas, now the Maestro's
  // the Maestro (and a worktree on its own canvas) is a full agent block; workers are summary cards
  const kind = (w: Worktree) => (!hub || w.isMaestro ? "pty_terminal_node" : "worktree_card");
  const mirrors = (n: CanvasNode) => n.type === "worktree_card" || n.type === "pty_terminal_node";
  const pathOf = (n: CanvasNode) => (n.data as { worktreePath: string }).worktreePath;

  useEffect(() => {
    ipc.loadCanvas(root, canvasKey).then((saved) => {
      const state: CanvasStateSchema | null = saved ? JSON.parse(saved) : null;
      if (state) {
        setNodes((state.nodes as CanvasNode[]).map(normalize));
        setEdges(state.edges.map((e) => ({ ...e, animated: true, markerEnd: ARROW })));
        setViewport(state.viewport);
      }
      needsFit.current = !state;
      untreed.current = !state?.tree;
      setLoadGen((g) => g + 1);
    }).catch(setError);
  }, [root, canvasKey]);

  // Keep exactly one mirrored node per worktree (a card here, or the agent block inside a worktree).
  useEffect(() => {
    if (!loaded) return;
    const paths = new Set(worktrees.map((w) => w.path));
    setNodes((ns) => {
      // free blocks (prompt, markdown) stay; a mirrored block stays while its worktree exists and it's the
      // right kind (a canvas saved before the Maestro became an agent block has a card for it)
      const kept = ns.filter((n) => !mirrors(n) || worktrees.some((w) => w.path === pathOf(n) && kind(w) === n.type));
      const have = new Set(kept.filter(mirrors).map(pathOf));
      // first grid slot no block already covers (cards get moved around, so "the next index" may be taken)
      const taken = [...kept];
      const freeSlot = () => {
        for (let i = 0; ; i++) {
          const p = { x: (i % 3) * (CARD_SIZE.width + 2 * GRID), y: Math.floor(i / 3) * (CARD_SIZE.height + 2 * GRID) };
          const hit = taken.some((n) => {
            const w = n.width ?? CARD_SIZE.width, h = n.height ?? CARD_SIZE.height;
            return p.x < n.position.x + w && n.position.x < p.x + CARD_SIZE.width && p.y < n.position.y + h && n.position.y < p.y + CARD_SIZE.height;
          });
          if (!hit) return p;
        }
      };
      const added = worktrees
        .filter((w) => !have.has(w.path))
        .map((w): CanvasNode => {
          if (kind(w) === "pty_terminal_node") {
            // on the Maestro canvas it keeps the card_ id, so lines and links treat it like any card
            const block: CanvasNode = { id: hub ? `card_${w.path}` : `term_${w.path}`, type: "pty_terminal_node", position: hub ? freeSlot() : { x: 360, y: 0 }, ...TERM_SIZES.M, deletable: false, data: { worktreePath: w.path, branchName: w.branch } };
            taken.push(block);
            return block;
          }
          const card: CanvasNode = {
            id: `card_${w.path}`,
            type: "worktree_card",
            position: freeSlot(),
            ...CARD_SIZE,
            deletable: false, // removed only by discarding the worktree
            data: { worktreePath: w.path },
          };
          taken.push(card);
          return card;
        });
      if (hub && added.length) justAdded.current = added[added.length - 1].position;
      return kept.length === ns.length && !added.length ? ns : [...kept, ...added];
    });
    setEdges((es) => es.filter((e) => !e.target.startsWith("term_") || paths.has(e.target.slice(5))));
    if (needsFit.current && worktrees.length) {
      needsFit.current = false;
      justAdded.current = null;
      requestAnimationFrame(() => fitView({ padding: 0.15, maxZoom: 1 }));
    } else {
      // a worktree created while you're here: bring its new card into view
      requestAnimationFrame(() => {
        const p = justAdded.current;
        justAdded.current = null;
        if (p) setCenter(p.x + CARD_SIZE.width / 2, p.y + CARD_SIZE.height / 2, { zoom: getZoom(), duration: motionMs(useSettings.getState()) * 1.5 });
      });
    }
  }, [loadGen, wtKey]);

  // Debounced autosave (backend writes atomically).
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => {
      const state: CanvasStateSchema = {
        version: "1.0.0",
        rootPath: root,
        activeSkillId: "",
        activeThemeId: "theme_default_dark",
        viewport: getViewport(),
        tree: 1,
        nodes: nodes.map(({ id, type, position, width, height, data }) => ({ id, type, position, width, height, data }) as CanvasStateSchema["nodes"][number]),
        // Maestro lines aren't saved here: they're drawn from the Maestro's workers
        edges: edges.filter((e) => e.data?.kind !== "orchestrates").map(({ id, source, target, data }) => ({ id, source, target, data })),
      };
      ipc.saveCanvas(root, canvasKey, JSON.stringify(state, null, 2)).catch(setError);
    }, 500);
    return () => clearTimeout(t);
  }, [loaded, nodes, edges, viewTick]);

  // Ctrl+wheel (and trackpad pinch, which arrives as ctrl+wheel) zooms anywhere, even over a block's
  // scrolling chat; plain wheel scrolls blocks / pans the canvas. Capture phase beats the block and
  // React Flow's own handler, and preventDefault stops WebView2's page zoom.
  const flowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = flowRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y, zoom } = getViewport();
      const delta = e.deltaY * (e.deltaMode === 1 ? 20 : 1);
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * Math.pow(2, -delta * 0.002)));
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      // keep the point under the cursor fixed
      setViewport({ x: px - ((px - x) * next) / zoom, y: py - ((py - y) * next) / zoom, zoom: next });
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, []);

  const promptCount = useRef(0);
  const addPrompt = () => {
    const s = screenToFlowPosition({ x: 420, y: 160 });
    const p = { x: snap(s.x), y: snap(s.y) };
    promptCount.current = nodes.filter((n) => n.type === "prompt_input_primitive").length + 1;
    setNodes((ns) => [
      ...ns,
      { id: `prompt_${Date.now()}`, type: "prompt_input_primitive", position: p, data: { label: `프롬프트 ${promptCount.current}`, attachedContextPaths: [] } },
    ]);
  };

  // ---- Maestro canvas lines, drawn from agent settings (the backend is the truth):
  //   parent card → worker card (hierarchy), Markdown block → card (reference)
  const self = worktrees.find((w) => w.path === scope); // this canvas's own agent
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // the agent a block stands for: a worker card, or an agent block (card_ ids on the Maestro canvas, term_ inside a worktree)
  const idOf = (path: string) => (hub ? `card_${path}` : `term_${path}`);
  const cardOf = (id: string | null) => {
    const n = id ? nodes.find((x) => x.id === id) : undefined;
    return n && mirrors(n) ? worktrees.find((w) => w.path === pathOf(n)) : undefined;
  };
  const mdOf = (id: string | null) => nodes.find((n) => n.id === id && n.type === "markdown_block") as { data: { path: string } } | undefined;
  const reload = () => useStore.getState().refreshWorktrees(root);
  const act = (p: Promise<unknown>) => p.then(reload).catch(setError);
  // what a line between these two nodes would mean, or null if it's not a new, allowed link
  const linkFor = (a: string | null, b: string | null): { kind: "child"; parent: string; child: string } | { kind: "ref"; card: string; md: string } | null => {
    const [ca, cb, ma, mb] = [cardOf(a), cardOf(b), mdOf(a), mdOf(b)];
    if (ca && cb) {
      // drag direction is hierarchy direction: from the parent to its worker
      if (cb.isMaestro || ca.workers.some((p) => same(p, cb.path))) return null;
      return { kind: "child", parent: ca.path, child: cb.path };
    }
    const card = ca ?? cb, md = ma ?? mb;
    if (card && md && !card.refs.some((r) => same(r, md.data.path))) return { kind: "ref", card: card.path, md: md.data.path };
    return null;
  };
  const [layoutTick, setLayoutTick] = useState(0);
  const linkKey = worktrees.map((w) => `${w.workers.join(",")}|${w.refs.join(",")}`).join("\n");
  useEffect(() => {
    if (!loaded) return;
    setEdges((es) => {
      const others = es.filter((e) => e.data?.kind !== "orchestrates" && e.data?.kind !== "reference");
      const line = (id: string, source: string, target: string, kind: "orchestrates" | "reference"): CanvasEdge => {
        const [sourceHandle, targetHandle] = facingSides(getNode(source), getNode(target));
        return { id, type: "link", source, target, sourceHandle, targetHandle, className: kind === "reference" ? "ref" : "orch", animated: kind === "orchestrates", markerEnd: ARROW, data: { kind } };
      };
      const lines: CanvasEdge[] = [];
      for (const w of worktrees) {
        // hierarchy lines only where the workers are on the canvas (the Maestro's)
        for (const child of hub ? worktrees.filter((c) => w.workers.some((p) => same(p, c.path))) : []) {
          lines.push(line(`orch_${w.path}>${child.path}`, idOf(w.path), idOf(child.path), "orchestrates"));
        }
        for (const md of nodes.filter((n) => n.type === "markdown_block" && w.refs.some((r) => same(r, (n.data as { path: string }).path)))) {
          lines.push(line(`ref_${md.id}>${w.path}`, md.id, idOf(w.path), "reference"));
        }
      }
      return [...others, ...lines];
    });
  }, [loadGen, wtKey, linkKey, layoutTick, nodes.length]);

  // References stay two-way: one added elsewhere (project canvas, the `maestro` CLI) shows up here as a
  // Markdown block linked to this canvas's agent; one removed elsewhere takes its block away (unless
  // another agent on this canvas still refers to it). Blocks dropped but not linked yet are left alone.
  const selfRefs = (self?.refs ?? []).join("\n");
  const lastRefs = useRef<string[] | null>(null);
  useEffect(() => {
    if (!loaded || !self) return;
    const refs = self.refs, prev = lastRefs.current;
    lastRefs.current = refs;
    const gone = (prev ?? []).filter((p) => !refs.some((r) => same(r, p)) && !worktrees.some((w) => w !== self && w.refs.some((r) => same(r, p))));
    const mdPath = (n: CanvasNode) => (n.type === "markdown_block" ? n.data.path : null);
    const missing = refs.filter((r) => !nodes.some((n) => mdPath(n) !== null && same(mdPath(n)!, r)));
    if (!gone.length && !missing.length) return;
    let live = true;
    Promise.all(missing.map((p) => ipc.mdTitle(p).catch(() => p.split("/").pop() ?? p))).then((titles) => {
      if (!live) return;
      setNodes((ns) => {
        const kept = ns.filter((n) => !(mdPath(n) !== null && gone.some((g) => same(g, mdPath(n)!))));
        // stacked down the agent block's left side, below the Markdown blocks already there
        const agent = ns.find((n) => n.id === idOf(self.path));
        const x0 = (agent?.position.x ?? 0) - MD_SIZE.width - 2 * GRID, y0 = agent?.position.y ?? 0;
        const stacked = kept.filter((n) => n.type === "markdown_block" && n.position.x === x0).length;
        const added = missing
          .filter((p) => !kept.some((n) => mdPath(n) !== null && same(mdPath(n)!, p)))
          .map((p, i): CanvasNode => ({
            id: `md_${Date.now()}_${i}`,
            type: "markdown_block",
            position: { x: x0, y: y0 + (stacked + i) * (MD_SIZE.height + GRID) },
            ...MD_SIZE,
            data: { path: p, title: titles[missing.indexOf(p)] },
          }));
        return [...kept, ...added];
      });
    });
    return () => {
      live = false;
    };
  }, [loaded, selfRefs]);

  // Tree layout is the default: a new canvas (or one saved before the tree layout) starts arranged, and so
  // does any change of worktrees or links. Blocks you drag stay where you put them (saved with the
  // canvas) until then. Markdown blocks aren't touched.
  const arrange = (animate = true) => {
    setNodes((ns) => {
      // each block's own size: the Maestro's agent block is bigger than a card
      const sizeOf = (w: Worktree) => {
        const n = ns.find((n) => n.id === `card_${w.path}`);
        return { width: n?.width ?? CARD_SIZE.width, height: n?.height ?? CARD_SIZE.height };
      };
      const pos = treeLayout(worktrees, sizeOf);
      return ns.map((n) => {
        const p = mirrors(n) && pos.get(pathOf(n));
        return p ? { ...n, position: p } : n;
      });
    });
    justAdded.current = null; // the fit below shows the new card; no separate pan
    needsFit.current = false;
    requestAnimationFrame(() => {
      setLayoutTick((t) => t + 1); // lines pick their sides from the new positions
      fitView({ padding: 0.15, maxZoom: 1, duration: animate ? motionMs(useSettings.getState()) * 1.5 : 0 });
    });
  };
  const hierKey = worktrees.map((w) => `${w.path}>${w.workers.join(",")}`).join("\n");
  const baseline = useRef<{ gen: number; hier: string } | null>(null);
  useEffect(() => {
    if (!loaded || !hub || !worktrees.length) return;
    const b = baseline.current;
    baseline.current = { gen: loadGen, hier: hierKey };
    const justLoaded = !b || b.gen !== loadGen;
    if (justLoaded ? !untreed.current : b?.hier === hierKey) return;
    untreed.current = false;
    arrange(!justLoaded);
  }, [loadGen, hierKey]);

  // Markdown dropped from the library or the file tree → a Markdown block where it landed
  const [libraryOpen, setLibraryOpen] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(MD_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = async (e: React.DragEvent) => {
    const raw = e.dataTransfer.getData(MD_MIME);
    if (!raw) return;
    e.preventDefault();
    const file = JSON.parse(raw) as { path: string; title: string };
    const at = screenToFlowPosition({ x: e.clientX, y: e.clientY });
    const title = file.title || (await ipc.mdTitle(file.path).catch(() => file.path.split("/").pop() ?? file.path));
    setNodes((ns) => [
      ...ns,
      {
        id: `md_${Date.now()}`,
        type: "markdown_block",
        position: { x: snap(at.x - MD_SIZE.width / 2), y: snap(at.y - MD_SIZE.height / 2) },
        ...MD_SIZE,
        data: { path: file.path, title },
      },
    ]);
  };

  // prompt → agent: a pipe kept with the canvas; everything else is a hierarchy or reference link (agent settings)
  const isPipe = (c: Connection | { source: string; target: string }) =>
    nodes.find((n) => n.id === c.source)?.type === "prompt_input_primitive" && nodes.find((n) => n.id === c.target)?.type === "pty_terminal_node";
  const onConnect = useCallback(
    (c: Connection) => {
      if (isPipe(c)) return setEdges((es) => addEdge({ ...c, animated: true, markerEnd: ARROW, data: { kind: "command_pipe" as const } }, es));
      const l = linkFor(c.source, c.target);
      if (l?.kind === "child") act(ipc.linkWorktrees(root, l.parent, l.child));
      if (l?.kind === "ref") act(ipc.setRef(root, l.card, l.md, true));
    },
    [setEdges, worktrees, nodes],
  );
  const isValidConnection: IsValidConnection = (c) => isPipe(c) || !!linkFor(c.source, c.target);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      connectionMode={ConnectionMode.Loose}
      onDragOver={onDragOver}
      onDrop={onDrop}
      // a line from a card dropped on empty canvas → a new worktree as that card's worker
      onConnectEnd={(_, cs) => {
        const from = cardOf(cs.fromNode?.id ?? null);
        if (from && !cs.toNode) onNewAgent({ parentPath: from.path });
      }}
      onEdgesDelete={(gone) => {
        for (const e of gone) {
          const card = cardOf(e.target);
          const parent = cardOf(e.source);
          if (e.data?.kind === "orchestrates" && card && parent) act(ipc.unlinkWorktrees(root, parent.path, card.path));
          const md = mdOf(e.source);
          if (e.data?.kind === "reference" && card && md) act(ipc.setRef(root, card.path, md.data.path, false));
        }
      }}
      onNodesDelete={(gone) => {
        // the last block of a Markdown file left this canvas → the agents here no longer refer to it
        for (const n of gone.filter((g) => g.type === "markdown_block")) {
          const path = (n.data as { path: string }).path;
          const left = nodes.some((o) => o.id !== n.id && o.type === "markdown_block" && same((o.data as { path: string }).path, path));
          if (left) continue;
          for (const w of worktrees.filter((w) => w.refs.some((r) => same(r, path)))) act(ipc.setRef(root, w.path, path, false));
        }
      }}
      onNodeDragStop={() => setLayoutTick((t) => t + 1)}
      onNodeDoubleClick={(_, n) => n.type === "worktree_card" && select(n.data.worktreePath)}
      zoomOnDoubleClick={false}
      onMoveEnd={() => setViewTick((t) => t + 1)}
      snapToGrid
      snapGrid={[GRID, GRID]}
      ref={flowRef}
      minZoom={MIN_ZOOM}
      maxZoom={MAX_ZOOM}
      zoomOnScroll={false}
      zoomOnPinch={false}
      zoomActivationKeyCode={null}
      panOnScroll
      deleteKeyCode={["Delete"]}
      colorMode={isLightTheme(theme) ? "light" : "dark"}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={GRID} />
      <CanvasControls onOpenSettings={onOpenSettings} />
      <ViewMap nodes={nodes} />
      {libraryOpen && (
        <Panel position="top-right">
          <LibraryPanel root={root} onClose={() => setLibraryOpen(false)} />
        </Panel>
      )}
      <Panel position="top-left">
        {/* the same toolbar on every agent canvas (the Maestro's and each worktree's) */}
        <div className="canvas-tools">
          <span className="crumb">
            {self?.isMaestro && <span className="maestro-crown">♛ </span>}
            {self?.name ?? folderName(scope)}
          </span>
          <button className="primary" title="이 에이전트의 워커로 새 워크트리 만들기" onClick={() => onNewAgent({ parentPath: scope })}>+ 워커</button>
          <button title="에이전트 블록에 이어서 지시를 보내는 블록" onClick={addPrompt}>+ 프롬프트 블록</button>
          <button title="등록한 폴더의 마크다운을 블록으로 끌어오기" data-on={libraryOpen || undefined} onClick={() => setLibraryOpen(!libraryOpen)}>보관함</button>
          <Guide
            key={canvasKey}
            text="블록의 점을 다른 블록으로 끌어 연결해요: 에이전트 → 워커, 마크다운 → 에이전트(참조), 프롬프트 → 에이전트 · 빈 곳에 놓으면 새 워커 · 선을 눌러 × 로 끊기 · 블록 오른쪽 아래 모서리를 끌어 크기 조절 · 워커 카드를 더블클릭하면 그 에이전트 캔버스로"
          />
        </div>
      </Panel>
    </ReactFlow>
  );
}
