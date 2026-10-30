import { useState } from "react";
import { Panel, useReactFlow, useStore } from "@xyflow/react";
import type { CanvasNode } from "./types";

const SPAN = 2; // the map covers the visible area ×2 on each axis
type Box = { x: number; y: number; w: number; h: number };

/**
 * Minimap locked to the current view: the view is framed in the middle with its surroundings around it.
 * LoL-style: press to put the camera there, hold and drag to sweep it. The map stays still while held.
 */
export function ViewMap({ nodes }: { nodes: CanvasNode[] }) {
  const [tx, ty, zoom] = useStore((s) => s.transform);
  const w = useStore((s) => s.width);
  const h = useStore((s) => s.height);
  const { setViewport } = useReactFlow();
  const [held, setHeld] = useState<Box | null>(null);
  if (!w || !h) return null;

  // visible rect and map box, in flow coordinates
  const view = { x: -tx / zoom, y: -ty / zoom, w: w / zoom, h: h / zoom };
  const box = held ?? { x: view.x - (view.w * (SPAN - 1)) / 2, y: view.y - (view.h * (SPAN - 1)) / 2, w: view.w * SPAN, h: view.h * SPAN };

  const centerAt = (e: React.PointerEvent<SVGSVGElement>, b: Box) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = b.x + ((e.clientX - r.left) / r.width) * b.w;
    const fy = b.y + ((e.clientY - r.top) / r.height) * b.h;
    setViewport({ x: w / 2 - fx * zoom, y: h / 2 - fy * zoom, zoom });
  };

  return (
    <Panel position="bottom-right">
      <svg
        className="viewmap nodrag nopan nowheel"
        data-held={held ? "" : undefined}
        style={{ aspectRatio: `${w} / ${h}` }}
        viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          setHeld(box);
          centerAt(e, box);
        }}
        onPointerMove={(e) => held && centerAt(e, held)}
        onPointerUp={() => setHeld(null)}
        onPointerCancel={() => setHeld(null)}
      >
        {nodes.map((n) => (
          <rect
            key={n.id}
            className={n.type === "prompt_input_primitive" ? "vm-prompt" : "vm-term"}
            x={n.position.x}
            y={n.position.y}
            width={n.width ?? n.measured?.width ?? 0}
            height={n.height ?? n.measured?.height ?? 0}
            rx={8 / zoom}
          />
        ))}
        <rect className="vm-frame" x={view.x} y={view.y} width={view.w} height={view.h} vectorEffect="non-scaling-stroke" />
      </svg>
    </Panel>
  );
}
