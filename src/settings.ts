import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AgentView } from "./types";

// light: the canvas (React Flow) and xterm use their light palette
export const THEMES = [
  { id: "dark", label: "블루 다크", light: false },
  { id: "graphite", label: "그래파이트", light: false },
  { id: "mocha", label: "모카", light: false },
  { id: "light", label: "라이트", light: true },
  { id: "ivory", label: "아이보리", light: true },
  { id: "neon", label: "네온", light: false },
] as const;

export const isLightTheme = (id: string) => THEMES.some((t) => t.id === id && t.light);

// One feel for every UI motion: panel collapse, minimap grow, dialogs, canvas fly-to.
export const EASINGS = {
  standard: { label: "표준", curve: "cubic-bezier(.2, 0, 0, 1)" },
  smooth: { label: "부드럽게", curve: "cubic-bezier(.16, 1, .3, 1)" },
  bouncy: { label: "탄력", curve: "cubic-bezier(.34, 1.56, .64, 1)" },
  linear: { label: "일정하게", curve: "linear" },
} as const;

export const SPEEDS = {
  fast: { label: "빠르게", ms: 120 },
  normal: { label: "보통", ms: 220 },
  slow: { label: "느리게", ms: 360 },
} as const;

type Prefs = {
  theme: (typeof THEMES)[number]["id"];
  easing: keyof typeof EASINGS;
  speed: keyof typeof SPEEDS;
  motion: boolean;
  defaultAgent: string;
  /** permission mode new worktrees start with */
  defaultPermission: string;
  /** installed but switched off: not offered when creating a worktree */
  disabledAgents: string[];
  /** default --model per agent for new worktrees; missing = the CLI's own default */
  agentModels: Record<string, string>;
  /** the assistant model for light background work (project-canvas summaries): an agent CLI + model, or "off" */
  assistantAgent: string;
  /** "" = that agent's cheap default (Haiku for Claude) */
  assistantModel: string;
  /** inside a worktree: the agent full-screen (default) or the canvas with its blocks */
  agentLayout: "full" | "canvas";
  /** chat or terminal in the full-screen agent view (canvas blocks keep their own) */
  fullView: AgentView;
};

export const useSettings = create<Prefs & { set: (p: Partial<Prefs>) => void }>()(
  persist((set) => ({ theme: "dark", easing: "smooth", speed: "normal", motion: true, defaultAgent: "auto", defaultPermission: "acceptEdits", disabledAgents: [], agentModels: {}, assistantAgent: "claude-code", assistantModel: "", agentLayout: "full", fullView: "chat", set }), { name: "maestro.settings" }),
);

/** Motion duration in ms; 0 when the user or the OS turned motion off. */
export const motionMs = (s: Prefs) =>
  s.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches ? SPEEDS[s.speed].ms : 0;

/** Push theme + motion onto <html> so CSS tokens pick them up. */
function applySettings(s: Prefs) {
  const root = document.documentElement;
  // a theme removed since it was saved (e.g. forest) falls back to the default
  root.dataset.theme = THEMES.some((t) => t.id === s.theme) ? s.theme : "dark";
  root.style.setProperty("--mae-ease", EASINGS[s.easing].curve);
  root.style.setProperty("--mae-dur", `${motionMs(s)}ms`);
}
applySettings(useSettings.getState()); // before first paint: no flash of the default theme
useSettings.subscribe(applySettings);
