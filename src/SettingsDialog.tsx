import { useEffect, useState } from "react";
import { AGENTS, AgentLogo, PERMISSIONS, agentLabel, agentUsable } from "./NewAgentDialog";
import { MODEL_CHOICES } from "./slashCommands";
import { EASINGS, SPEEDS, THEMES, useSettings } from "./settings";
import { ipc } from "./ipc";
import { listen } from "@tauri-apps/api/event";
import { XTerm } from "./nodes/XTerm";
import type { AgentStatePayload } from "./types";
import { useStore } from "./store";

// gear outline (Lucide "settings", ISC)
export const GearIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const SECTIONS = [
  { id: "agents", label: "에이전트", desc: "쓸 에이전트를 켜고 끄고, 새 워크트리에 쓸 기본 에이전트와 모델을 정해요." },
  { id: "style", label: "스타일", desc: "테마와 화면 움직임의 느낌을 정해요." },
] as const;

/** The command a new worktree with this agent would run, as the backend builds it (agent.rs / antigravity.rs). */
function commandPreview(id: string, perm: string, model?: string) {
  const m = model ? ` --model ${model}` : "";
  if (id === "claude-code") return `claude --permission-mode ${perm}${m}`;
  if (id === "antigravity") {
    const mode = perm === "bypassPermissions" ? "--dangerously-skip-permissions" : `--mode ${perm === "plan" ? "plan" : perm === "auto" ? "auto" : "accept-edits"}`;
    return `agy ${mode}${m}`;
  }
  return id;
}

/** (value, label) models an agent offers: Claude's aliases, or Antigravity's live list. null while loading. */
function useModels(id: string) {
  const [models, setModels] = useState<Array<[string, string]> | null>(null);
  useEffect(() => {
    if (id === "claude-code") setModels(MODEL_CHOICES.map((m) => [m.name, `${m.name} · ${m.description}`]));
    else if (id === "antigravity") ipc.antigravityModels().then(setModels).catch(() => setModels([]));
    else setModels([]);
  }, [id]);
  return models;
}

/** One agent as a tile: logo, name, state, on/off switch, launch command; opens up for its model and setup terminal. */
function AgentTile({ id, label, soon }: { id: string; label: string; soon?: boolean }) {
  const cli = useStore((st) => st.cli);
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const st = cli?.agents.find((a) => a.id === id);
  const installed = !!st?.installed && !soon;
  const on = installed && !s.disabledAgents.includes(id);
  const isDefault = s.defaultAgent === id;
  const state = !st ? "확인 중" : soon ? "준비 중" : !installed ? "설치 필요" : on ? "사용 중" : "꺼짐";

  return (
    <div className="agent-tile" data-open={open || undefined} data-off={!on || undefined}>
      <div className="agent-tile-top">
        <AgentLogo id={id} size={28} />
        <div className="agent-tile-name">
          <b>{label.replace(/ \(.*\)$/, "")}</b>
          <span className="agent-pill" data-state={state}>{state}</span>
        </div>
        <span className="spacer" />
        <label className="switch" title={on ? "끄기" : "켜기"}>
          <input
            type="checkbox"
            checked={on}
            disabled={!installed}
            onChange={(e) => s.set({ disabledAgents: e.target.checked ? s.disabledAgents.filter((x) => x !== id) : [...s.disabledAgents, id] })}
          />
          <span />
        </label>
      </div>
      <code className="agent-tile-cmd">{installed ? commandPreview(id, s.defaultPermission, s.agentModels[id]) : (st?.installCmd || "앱과 함께 설치돼요")}</code>
      <div className="agent-tile-actions">
        <button className="link small" disabled={!on || isDefault} onClick={() => s.set({ defaultAgent: id })}>
          {isDefault ? "★ 기본 에이전트" : "기본으로"}
        </button>
        <span className="spacer" />
        <button className="link small" disabled={soon} onClick={() => setOpen(!open)}>{open ? "접기" : installed ? "모델 · 로그인" : "설치"}</button>
      </div>
      {open && st && <div className="agent-tile-body">{st.installed ? <InstalledDetails id={id} /> : <InstallHelp id={id} st={st} npm={cli!.npm} />}</div>}
    </div>
  );
}

/** 보조 모델: one agent + model for light background work (project-canvas summaries), or off. */
function AssistantRow() {
  const s = useSettings();
  const cli = useStore((st) => st.cli);
  const models = useModels(s.assistantAgent);
  const choices = AGENTS.filter((a) => !a.disabled && cli?.agents.find((c) => c.id === a.id)?.installed);
  return (
    <div className="set-row">
      <div>
        <div>보조 모델</div>
        <div className="muted small">프로젝트 캔버스의 답변 요약처럼 가벼운 일을 맡아요. 빠르고 싼 모델이 좋아요.</div>
      </div>
      <div className="set-inline">
        <select value={s.assistantAgent} onChange={(e) => s.set({ assistantAgent: e.target.value, assistantModel: "" })}>
          {choices.map((a) => <option key={a.id} value={a.id}>{agentLabel(a.id)}</option>)}
          <option value="off">끄기</option>
        </select>
        {s.assistantAgent !== "off" && (
          <select value={s.assistantModel} disabled={!models} onChange={(e) => s.set({ assistantModel: e.target.value })}>
            <option value="">{s.assistantAgent === "claude-code" ? "haiku (기본)" : "CLI 기본값"}</option>
            {models?.filter(([v]) => v !== "haiku").map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        )}
      </div>
    </div>
  );
}

/** Default model for new worktrees with this agent. */
function InstalledDetails({ id }: { id: string }) {
  const s = useSettings();
  const models = useModels(id);
  if (id === "codex") return <div className="muted small">Codex 연결은 준비 중이에요.</div>;
  return (
    <>
      <div className="set-row">
        <div>
          <div>기본 모델</div>
          <div className="muted small">새 워크트리를 만들 때 이 모델로 시작해요. 이미 있는 워크트리는 그대로예요.</div>
        </div>
        <select value={s.agentModels[id] ?? ""} disabled={!models} onChange={(e) => s.set({ agentModels: { ...s.agentModels, [id]: e.target.value } })}>
          <option value="">CLI 기본값</option>
          {models?.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
      </div>
      {!models && <div className="muted small">모델 목록 불러오는 중…</div>}
      <SetupTerminal id={id} installed />
    </>
  );
}

/**
 * A terminal right in settings: installs the CLI if needed, then runs it so its first-run screens
 * (theme, login, trust) are finished here instead of in some other window.
 */
function SetupTerminal({ id, installed }: { id: string; installed: boolean }) {
  const loadCli = useStore((s) => s.loadCli);
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  const key = `setup:${id}`;

  // the CLI exiting (login finished, or the user quit) → re-detect what's installed now
  useEffect(() => {
    if (!open) return;
    const un = listen<AgentStatePayload>("agent://state", (e) => {
      if (e.payload.worktreePath === key && e.payload.state.kind === "TERMINATED") {
        setDone(true);
        loadCli().catch(() => {});
      }
    });
    return () => void un.then((f) => f());
  }, [open]);

  const close = () => {
    ipc.setupStop(id).catch(() => {});
    setOpen(false);
    setDone(false);
    loadCli().catch(() => {});
  };

  if (!open)
    return (
      <div className="set-row">
        <div className="muted small">
          {installed ? "로그인하거나 첫 설정을 마치려면 여기서 바로 실행하세요." : "설치부터 첫 실행, 로그인까지 이 안의 터미널에서 이어서 해요."}
        </div>
        <button className="primary" onClick={() => setOpen(true)}>{installed ? "터미널에서 로그인" : "설치하고 로그인"}</button>
      </div>
    );
  return (
    <div className="setup-term">
      <div className="setup-term-bar small">
        <span className="muted">{done ? "끝났어요. 설치 상태를 다시 확인했어요." : "로그인까지 마치면 CLI를 종료하거나 닫기를 누르세요."}</span>
        <span className="spacer" />
        <button onClick={close}>닫기</button>
      </div>
      <XTerm path={key} start={() => ipc.setupStart(id)} />
    </div>
  );
}

function InstallHelp({ id, st, npm }: { id: string; st: { installCmd: string }; npm: boolean }) {
  if (!st.installCmd)
    return <div className="muted small">{id === "antigravity" ? "npm 패키지가 아니에요. 앱(antigravity.google)을 설치하면 함께 깔려요. 설치 후 새로고침을 눌러 주세요." : "설치 방법을 확인해 주세요."}</div>;
  return (
    <>
      <code className="set-cmd">{st.installCmd}</code>
      {npm ? <SetupTerminal id={id} installed={false} /> : <div className="err small">npm이 없어요. Node.js(nodejs.org)를 먼저 설치해 주세요.</div>}
    </>
  );
}

/** Settings popup: category list on the left, the chosen category's options on the right. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [sec, setSec] = useState<(typeof SECTIONS)[number]["id"]>("agents");
  const [flip, setFlip] = useState(false);
  const cur = SECTIONS.find((x) => x.id === sec)!;
  const cli = useStore((st) => st.cli);
  const isInstalled = (id: string) => !!cli?.agents.find((a) => a.id === id)?.installed;
  const installedAgents = AGENTS.filter((a) => !a.disabled && isInstalled(a.id));
  const availableAgents = AGENTS.filter((a) => !installedAgents.includes(a));
  // re-check on open: a CLI may have been installed from a terminal meanwhile
  useEffect(() => void useStore.getState().loadCli().catch(() => {}), []);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <nav className="set-nav">
          <div className="set-nav-title muted small">설정</div>
          {SECTIONS.map((x) => (
            <button key={x.id} data-on={x.id === sec || undefined} onClick={() => setSec(x.id)}>{x.label}</button>
          ))}
        </nav>

        <div className="set-body">
          <button className="icon set-close" title="닫기" autoFocus onClick={onClose}>×</button>
          <h3>{cur.label}</h3>
          <p className="muted small">{cur.desc}</p>

          {sec === "agents" ? (
            <>
              {cli && !cli.agents.some((a) => a.installed) && (
                <div className="set-alert">에이전트 CLI가 하나도 설치돼 있지 않아요. 아래 "설치 가능"에서 하나를 설치해야 워크트리를 만들 수 있어요.</div>
              )}
              <h4>기본값</h4>
              <section className="set-card">
                <div className="set-row">
                  <div>
                    <div>기본 에이전트</div>
                    <div className="muted small">새 워크트리 창에서 미리 골라 둬요. 자동은 쓸 수 있는 첫 에이전트예요.</div>
                  </div>
                  <div className="seg seg-logos">
                    <button data-on={s.defaultAgent === "auto" || undefined} onClick={() => s.set({ defaultAgent: "auto" })}>자동</button>
                    {AGENTS.filter((a) => agentUsable(a.id, cli, s.disabledAgents)).map((a) => (
                      <button key={a.id} data-on={s.defaultAgent === a.id || undefined} onClick={() => s.set({ defaultAgent: a.id })}>
                        <AgentLogo id={a.id} />
                        {agentLabel(a.id)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="set-row">
                  <div>
                    <div>권한</div>
                    <div className="muted small">{PERMISSIONS.find((p) => p.id === s.defaultPermission)?.hint}</div>
                  </div>
                  <select value={s.defaultPermission} onChange={(e) => s.set({ defaultPermission: e.target.value })}>
                    {PERMISSIONS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <AssistantRow />
              </section>

              <div className="set-group-head">
                <h4>에이전트</h4>
                <span className="spacer" />
                <button className="link muted small" onClick={() => useStore.getState().loadCli().catch(() => {})}>↻ 다시 확인</button>
              </div>
              <div className="agent-grid">
                {[...installedAgents, ...availableAgents].map((a) => <AgentTile key={a.id} id={a.id} label={a.label} soon={a.disabled} />)}
              </div>
            </>
          ) : (
            <>
              <h4>테마</h4>
              <div className="theme-pick">
                {THEMES.map((t) => (
                  <button key={t.id} data-theme-swatch={t.id} data-on={t.id === s.theme || undefined} onClick={() => s.set({ theme: t.id })}>
                    <span className="swatch" />
                    {t.label}
                  </button>
                ))}
              </div>

              <h4>모션</h4>
              <section className="set-card">
                <div className="set-row">
                  <div>
                    <div>모션 사용</div>
                    <div className="muted small">패널 접기·펴기, 미니맵 확대, 창 열기, 블록으로 이동</div>
                  </div>
                  <input type="checkbox" checked={s.motion} onChange={(e) => s.set({ motion: e.target.checked })} />
                </div>
                <div className="set-row">
                  <div>이징</div>
                  <div className="seg">
                    {Object.entries(EASINGS).map(([id, e]) => (
                      <button key={id} disabled={!s.motion} data-on={id === s.easing || undefined} onClick={() => s.set({ easing: id as keyof typeof EASINGS })}>{e.label}</button>
                    ))}
                  </div>
                </div>
                <div className="set-row">
                  <div>속도</div>
                  <div className="seg">
                    {Object.entries(SPEEDS).map(([id, sp]) => (
                      <button key={id} disabled={!s.motion} data-on={id === s.speed || undefined} onClick={() => s.set({ speed: id as keyof typeof SPEEDS })}>{sp.label}</button>
                    ))}
                  </div>
                </div>
                <div className="set-row">
                  <div>미리보기</div>
                  <button className="motion-preview" onClick={() => setFlip(!flip)} title="눌러서 미리보기">
                    <span className="knob" data-flip={flip || undefined} />
                  </button>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
