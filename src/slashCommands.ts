export type SlashCmd = { name: string; description: string; source: string; note?: string };

const OPENS_IN_CLI = "CLI 보기에서 열려요";

// Claude Code built-ins worth offering from chat. Ones that open a picker or dialog only work in the terminal.
export const BUILTIN_COMMANDS: SlashCmd[] = [
  { name: "add-dir", description: "작업 폴더 추가", source: "기본" },
  { name: "agents", description: "서브에이전트 관리", source: "기본", note: OPENS_IN_CLI },
  { name: "clear", description: "대화 지우고 새로 시작", source: "기본", note: "새 세션이 시작돼 Chat 보기가 이어지지 않아요" },
  { name: "compact", description: "대화를 요약해 컨텍스트 줄이기", source: "기본" },
  { name: "config", description: "설정", source: "기본", note: OPENS_IN_CLI },
  { name: "context", description: "컨텍스트 사용량 보기", source: "기본" },
  { name: "cost", description: "이번 세션 비용·시간", source: "기본" },
  { name: "doctor", description: "설치 상태 점검", source: "기본", note: OPENS_IN_CLI },
  { name: "help", description: "도움말", source: "기본" },
  { name: "hooks", description: "훅 설정", source: "기본", note: OPENS_IN_CLI },
  { name: "init", description: "CLAUDE.md 만들기", source: "기본" },
  { name: "mcp", description: "MCP 서버 관리", source: "기본", note: OPENS_IN_CLI },
  { name: "memory", description: "메모리 파일 편집", source: "기본", note: OPENS_IN_CLI },
  { name: "model", description: "모델 바꾸기", source: "기본" },
  { name: "permissions", description: "권한 규칙", source: "기본", note: OPENS_IN_CLI },
  { name: "review", description: "변경 사항 리뷰", source: "기본" },
  { name: "rewind", description: "이전 시점으로 되돌리기", source: "기본", note: OPENS_IN_CLI },
  { name: "security-review", description: "보안 리뷰", source: "기본" },
  { name: "status", description: "버전·계정·모델 상태", source: "기본", note: OPENS_IN_CLI },
  { name: "usage", description: "사용량 한도", source: "기본", note: OPENS_IN_CLI },
];

// `/model` with no argument opens a picker that only exists in the TUI, so chat shows this list
// and sends `/model <name>`. Names are the aliases Claude Code accepts.
export const MODEL_CHOICES: SlashCmd[] = [
  { name: "default", description: "기본값 (계정 권장 모델)", source: "모델" },
  { name: "best", description: "지금 쓸 수 있는 가장 좋은 모델", source: "모델" },
  { name: "opus", description: "Opus · 어렵고 긴 작업", source: "모델" },
  { name: "sonnet", description: "Sonnet · 빠르고 균형 잡힘", source: "모델" },
  { name: "haiku", description: "Haiku · 가장 빠르고 저렴", source: "모델" },
  { name: "fable", description: "Fable", source: "모델" },
  { name: "opusplan", description: "계획은 Opus, 실행은 Sonnet", source: "모델" },
  { name: "opus[1m]", description: "Opus · 100만 토큰 컨텍스트", source: "모델" },
  { name: "sonnet[1m]", description: "Sonnet · 100만 토큰 컨텍스트", source: "모델" },
];

/** Prefix matches first, then substring matches in name or description. */
export function matchCommands(all: SlashCmd[], query: string): SlashCmd[] {
  const q = query.toLowerCase();
  const pre = all.filter((c) => c.name.toLowerCase().startsWith(q));
  const sub = all.filter((c) => !pre.includes(c) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q)));
  return [...pre, ...sub];
}
