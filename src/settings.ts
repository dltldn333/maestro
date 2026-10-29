import { create } from "zustand";
import { persist } from "zustand/middleware";

export const THEMES = [
  { id: "dark", label: "블루 다크" },
  { id: "graphite", label: "그래파이트" },
  { id: "light", label: "라이트" },
] as const;

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
};

export const useSettings = create<Prefs & { set: (p: Partial<Prefs>) => void }>()(
  persist((set) => ({ theme: "dark", easing: "smooth", speed: "normal", motion: true, defaultAgent: "claude-code", set }), { name: "maestro.settings" }),
);

/** Motion duration in ms; 0 when the user or the OS turned motion off. */
export const motionMs = (s: Prefs) =>
  s.motion && !matchMedia("(prefers-reduced-motion: reduce)").matches ? SPEEDS[s.speed].ms : 0;

/** Push theme + motion onto <html> so CSS tokens pick them up. */
function applySettings(s: Prefs) {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.style.setProperty("--mae-ease", EASINGS[s.easing].curve);
  root.style.setProperty("--mae-dur", `${motionMs(s)}ms`);
}
applySettings(useSettings.getState()); // before first paint: no flash of the default theme
useSettings.subscribe(applySettings);
