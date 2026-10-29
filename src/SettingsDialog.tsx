import { useState } from "react";
import { AGENTS } from "./NewAgentDialog";
import { EASINGS, SPEEDS, THEMES, useSettings } from "./settings";

const TABS = [
  { id: "style", label: "스타일" },
  { id: "agent", label: "에이전트" },
] as const;

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const s = useSettings();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("style");
  const [flip, setFlip] = useState(false);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings" onKeyDown={(e) => e.key === "Escape" && onClose()} tabIndex={-1}>
        <h3>설정</h3>
        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} data-on={t.id === tab || undefined} onClick={() => setTab(t.id)}>{t.label}</button>
          ))}
        </div>

        {tab === "style" ? (
          <>
            <section className="set-group">
              <h4>테마</h4>
              <div className="theme-pick">
                {THEMES.map((t) => (
                  <button key={t.id} data-theme-swatch={t.id} data-on={t.id === s.theme || undefined} onClick={() => s.set({ theme: t.id })}>
                    <span className="swatch" />
                    {t.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="set-group">
              <h4>모션</h4>
              <p className="muted small">패널 접기·펴기, 미니맵 확대, 창 열기, 블록으로 이동할 때 같은 느낌으로 움직여요.</p>
              <label className="set-row">
                <span>모션 사용</span>
                <input type="checkbox" checked={s.motion} onChange={(e) => s.set({ motion: e.target.checked })} />
              </label>
              <div className="set-row">
                <span>이징</span>
                <div className="seg">
                  {Object.entries(EASINGS).map(([id, e]) => (
                    <button key={id} disabled={!s.motion} data-on={id === s.easing || undefined} onClick={() => s.set({ easing: id as keyof typeof EASINGS })}>{e.label}</button>
                  ))}
                </div>
              </div>
              <div className="set-row">
                <span>속도</span>
                <div className="seg">
                  {Object.entries(SPEEDS).map(([id, sp]) => (
                    <button key={id} disabled={!s.motion} data-on={id === s.speed || undefined} onClick={() => s.set({ speed: id as keyof typeof SPEEDS })}>{sp.label}</button>
                  ))}
                </div>
              </div>
              <button className="motion-preview" onClick={() => setFlip(!flip)} title="눌러서 미리보기">
                <span className="knob" data-flip={flip || undefined} />
              </button>
            </section>
          </>
        ) : (
          <section className="set-group">
            <h4>기본 에이전트</h4>
            <p className="muted small">새 CLI 블록을 만들 때 미리 골라 둘 에이전트예요.</p>
            <div className="agent-pick">
              {AGENTS.map((a) => (
                <button key={a.id} disabled={a.disabled} data-on={a.id === s.defaultAgent || undefined} onClick={() => s.set({ defaultAgent: a.id })}>{a.label}</button>
              ))}
            </div>
          </section>
        )}

        <div className="modal-actions">
          <button className="primary" autoFocus onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
