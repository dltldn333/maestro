import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { ipc } from "./ipc";
import { useStore } from "./store";

/** Drag payload for a Markdown file: JSON {path, title}. The canvas turns a drop into a Markdown block. */
export const MD_MIME = "application/x-maestro-md";

type Folder = { folder: string; persona: boolean; files: Array<{ path: string; title: string }> };

/** 보관함: folders registered for this project; drag a Markdown file out onto the canvas. */
export function LibraryPanel({ root, onClose }: { root: string; onClose: () => void }) {
  const setError = useStore((s) => s.setError);
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const load = () => ipc.libraryList(root).then(setFolders).catch(setError);
  useEffect(() => void load(), [root]);

  // the persona folder is always listed by the backend; only the user's own folders are saved
  const own = () => (folders ?? []).filter((f) => !f.persona).map((f) => f.folder);
  const save = (list: string[]) => ipc.librarySet(root, list).then(load).catch(setError);
  const add = async () => {
    const dir = await open({ directory: true, title: "보관함에 넣을 폴더" });
    if (typeof dir === "string" && folders && !folders.some((f) => f.folder === dir)) save([...own(), dir]);
  };
  const [naming, setNaming] = useState<string | null>(null);
  const createPersona = () => {
    if (!naming?.trim()) return setNaming(null);
    ipc.personaCreate(naming).then(() => {
      setNaming(null);
      load();
    }, setError);
  };

  return (
    <div className="library nowheel nodrag">
      <div className="library-head">
        <b>보관함</b>
        <span className="spacer" />
        <button className="icon" title="다시 읽기" onClick={load}>↻</button>
        <button className="icon" title="폴더 등록" onClick={add}>+</button>
        <button className="icon" title="닫기" onClick={onClose}>×</button>
      </div>
      <div className="library-body">
        {folders && folders.length <= 1 && (
          <div className="library-empty muted small">마크다운이 든 폴더를 + 로 등록하세요. 파일을 캔버스로 끌면 블록이 돼요. 오른쪽 파일 트리의 .md 도 끌어올 수 있어요.</div>
        )}
        {folders?.map((f) => (
          <div key={f.folder}>
            <div className="library-folder" title={f.folder}>
              <span className="ellipsis">{f.persona ? "♟ 페르소나 · 블록을 워크트리에 이으면 그 역할을 맡아요" : f.folder.split(/[\\/]/).pop()}</span>
              <span className="spacer" />
              {f.persona ? (
                <button className="icon" title="새 페르소나" onClick={() => setNaming("")}>+</button>
              ) : (
                <button className="icon" title="등록 해제 (파일은 그대로)" onClick={() => save(own().filter((x) => x !== f.folder))}>×</button>
              )}
            </div>
            {f.persona && naming !== null && (
              <div className="library-new">
                <input
                  autoFocus
                  value={naming}
                  placeholder="새 페르소나 이름 · Enter"
                  onChange={(e) => setNaming(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;
                    if (e.key === "Enter") createPersona();
                    if (e.key === "Escape") setNaming(null);
                  }}
                  onBlur={() => !naming && setNaming(null)}
                />
              </div>
            )}
            {!f.files.length && <div className="library-file muted small">마크다운 없음</div>}
            {f.files.map((file) => (
              <div
                key={file.path}
                className="library-file"
                draggable
                title={file.path}
                onDragStart={(e) => {
                  e.dataTransfer.setData(MD_MIME, JSON.stringify(file));
                  e.dataTransfer.effectAllowed = "copy";
                }}
              >
                <span className="ellipsis">{file.title}</span>
                <span className="muted small ellipsis">{file.path.slice(f.folder.replace(/\\/g, "/").length + 1)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
