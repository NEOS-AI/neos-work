import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { clipDuration } from "@video/lib/timeline/project";
import type { TimelineClip, TrackKind } from "@video/lib/timeline/types";
import { cn } from "@video/lib/utils";

export type ClipGestureResult = "ok" | "overlap" | "rejected";

export type ClipBlockProps = {
  clip: TimelineClip;
  kind: TrackKind;
  selected: boolean;
  pxPerSecond: number;
  onSelect: () => void;
  onGestureStart: () => void;
  onMove: (timelineStart: number) => ClipGestureResult;
  onTrim: (edge: "in" | "out", sourceTime: number) => ClipGestureResult;
  onOverlap?: () => void;
};

type DragKind = "move" | "in" | "out";

type DragState = {
  kind: DragKind;
  originX: number;
  originStart: number;
  originIn: number;
  originOut: number;
  overlapped: boolean;
};

export function ClipBlock({
  clip,
  kind,
  selected,
  pxPerSecond,
  onSelect,
  onGestureStart,
  onMove,
  onTrim,
  onOverlap,
}: ClipBlockProps) {
  const dragRef = useRef<DragState | null>(null);

  const beginDrag = (
    dragKind: DragKind,
    e: ReactPointerEvent<HTMLElement>,
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    onSelect();
    onGestureStart();
    e.currentTarget.setPointerCapture(e.pointerId);

    const drag: DragState = {
      kind: dragKind,
      originX: e.clientX,
      originStart: clip.timeline_start,
      originIn: clip.source_in,
      originOut: clip.source_out,
      overlapped: false,
    };
    dragRef.current = drag;

    const pps = pxPerSecond;
    const move = onMove;
    const trim = onTrim;
    const overlap = onOverlap;
    const target = e.currentTarget;
    const onMovePtr = (ev: PointerEvent) => {
      const current = dragRef.current;
      if (!current) return;
      const dt = (ev.clientX - current.originX) / pps;
      let result: ClipGestureResult;
      if (current.kind === "move") {
        result = move(Math.max(0, current.originStart + dt));
      } else if (current.kind === "in") {
        result = trim("in", current.originIn + dt);
      } else {
        result = trim("out", current.originOut + dt);
      }
      if (result === "overlap") current.overlapped = true;
      else if (result === "ok") current.overlapped = false;
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMovePtr);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
      const current = dragRef.current;
      dragRef.current = null;
      if (current?.overlapped) overlap?.();
    };
    target.addEventListener("pointermove", onMovePtr);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const left = clip.timeline_start * pxPerSecond;
  const width = Math.max(clipDuration(clip) * pxPerSecond, 2);

  return (
    <div
      data-clip-id={clip.id}
      aria-label={clipLabel(clip)}
      className={cn(
        "absolute top-1.5 bottom-1.5 cursor-grab overflow-hidden rounded-md border text-left text-[11px] leading-none select-none touch-none active:cursor-grabbing",
        kind === "video"
          ? "border-primary/20 bg-primary text-primary-foreground"
          : "border-foreground/10 bg-foreground/80 text-background",
        selected && "z-10 ring-2 ring-ring ring-offset-1 ring-offset-background",
      )}
      style={{ left, width }}
      onPointerDown={(e) => beginDrag("move", e)}
    >
      <button
        type="button"
        aria-label="Trim in"
        className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize bg-background/25 hover:bg-background/50"
        onPointerDown={(e) => beginDrag("in", e)}
      />
      <span className="pointer-events-none block truncate px-2.5 py-2 font-medium">
        {clipLabel(clip)}
      </span>
      <button
        type="button"
        aria-label="Trim out"
        className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize bg-background/25 hover:bg-background/50"
        onPointerDown={(e) => beginDrag("out", e)}
      />
    </div>
  );
}

function clipLabel(clip: TimelineClip): string {
  const parts = clip.source_path.split(/[/\\]/);
  return parts[parts.length - 1] || clip.source_path || clip.id;
}
