import { useEffect, useRef, useState } from "react";
import { Handle, NodeResizer, Position, useReactFlow, useStore, type NodeProps } from "@xyflow/react";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { b64ToBytes, ipc } from "../ipc";
import type { PtyStdoutBatchEvent, TerminalFlowNode } from "../types";

const LOD_ZOOM = 0.6;

export function TerminalNode({ id, data, selected }: NodeProps<TerminalFlowNode>) {
  const lod = useStore((s) => s.transform[2] < LOD_ZOOM);
  const { updateNodeData } = useReactFlow();
  const alive = data.status !== "TERMINATED";

  const discard = async () => {
    if (!confirm(`워크트리와 브랜치 '${data.branchName}'를 삭제합니다. 커밋하지 않은 작업과 이 브랜치의 커밋이 사라집니다.`)) return;
    try {
      await ipc.discard(data.sessionId);
      updateNodeData(id, { status: "TERMINATED" });
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="node node-terminal" data-status={data.status}>
      <NodeResizer isVisible={selected} minWidth={360} minHeight={220} />
      <Handle type="target" position={Position.Left} />
      <header>
        <span className="dot" />
        <b>{data.branchName}</b>
        <span className="muted">{data.adapterId}{data.allocatedPort ? ` · :${data.allocatedPort}` : ""}</span>
        <span className="spacer" />
        {alive && <button onClick={() => ipc.kill(data.sessionId)}>종료</button>}
        <button onClick={discard}>폐기</button>
      </header>
      {!alive ? (
        <div className="lod muted">세션 종료됨 · {data.worktreePath}</div>
      ) : lod ? (
        <LodCard sessionId={data.sessionId} />
      ) : (
        <XTerm sessionId={data.sessionId} />
      )}
    </div>
  );
}

// Zoomed-out view: the last 2 plain-text lines instead of a live xterm.
function LodCard({ sessionId }: { sessionId: string }) {
  const [tail, setTail] = useState<string[]>([]);
  useEffect(() => {
    const un = listen<PtyStdoutBatchEvent>("pty://stdout", (e) => {
      if (e.payload.sessionId === sessionId) setTail(e.payload.strippedTail);
    });
    return () => void un.then((f) => f());
  }, [sessionId]);
  return (
    <div className="lod">
      {tail.length ? tail.map((l, i) => <div key={i}>{l}</div>) : <span className="muted">출력 대기 중…</span>}
    </div>
  );
}

function XTerm({ sessionId }: { sessionId: string }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = new Terminal({
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      theme: { background: "#000000" },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current!);
    fit.fit();

    // Replay scrollback, then live batches; seq drops batches the snapshot already holds.
    let seq = -1;
    const queued: PtyStdoutBatchEvent[] = [];
    let disposed = false;
    const write = (ev: PtyStdoutBatchEvent) => {
      if (ev.seq <= seq) return;
      term.write(b64ToBytes(ev.dataB64));
      seq = ev.seq;
    };
    const unlisten = listen<PtyStdoutBatchEvent>("pty://stdout", (e) => {
      if (e.payload.sessionId !== sessionId) return;
      seq < 0 ? queued.push(e.payload) : write(e.payload);
    });
    unlisten
      .then(() => ipc.scrollback(sessionId))
      .then((sb) => {
        if (disposed) return;
        term.write(b64ToBytes(sb.dataB64));
        seq = sb.seq;
        queued.forEach(write);
        ipc.resize(sessionId, term.cols, term.rows).catch(() => {});
      })
      .catch(() => {});

    const input = term.onData((d) => ipc.writeRaw(sessionId, d).catch(() => {}));

    // Only real size changes reach here: canvas zoom is a CSS transform and doesn't resize the box.
    let timer: number | undefined;
    const ro = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        fit.fit();
        ipc.resize(sessionId, term.cols, term.rows).catch(() => {});
      }, 150);
    });
    ro.observe(host.current!);

    return () => {
      disposed = true;
      clearTimeout(timer);
      ro.disconnect();
      input.dispose();
      unlisten.then((f) => f());
      term.dispose();
    };
  }, [sessionId]);

  return <div ref={host} className="xterm-host nodrag nowheel nopan" />;
}
