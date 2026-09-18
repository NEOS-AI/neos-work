import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { cn } from "@video/lib/utils";

const MIN_GAP = 0.1;

export function ClipRangeSlider({
  duration,
  start,
  end,
  currentTime,
  onChange,
  disabled,
}: {
  duration: number;
  start: number;
  end: number;
  currentTime: number;
  onChange: (next: { start: number; end: number }) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);

  const max = duration > 0 ? duration : 1;
  const startPct = clamp01(start / max) * 100;
  const endPct = clamp01(end / max) * 100;
  const playPct = clamp01(currentTime / max) * 100;

  const timeAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 0;
      const box = el.getBoundingClientRect();
      const t = ((clientX - box.left) / Math.max(1, box.width)) * max;
      return clamp(t, 0, max);
    },
    [max]
  );

  const beginDrag = (which: "start" | "end", pointerId: number, target: HTMLElement) => {
    if (disabled) return;
    target.setPointerCapture(pointerId);
    const onMove = (e: PointerEvent) => {
      const t = timeAt(e.clientX);
      if (which === "start") {
        onChange({ start: clamp(t, 0, end - MIN_GAP), end });
      } else {
        onChange({ start, end: clamp(t, start + MIN_GAP, max) });
      }
    };
    const onUp = () => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", onUp);
      target.removeEventListener("pointercancel", onUp);
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", onUp);
    target.addEventListener("pointercancel", onUp);
  };

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const t = timeAt(e.clientX);
    const nearerStart = Math.abs(t - start) <= Math.abs(t - end);
    if (nearerStart) {
      onChange({ start: clamp(t, 0, end - MIN_GAP), end });
      beginDrag("start", e.pointerId, e.currentTarget);
    } else {
      onChange({ start, end: clamp(t, start + MIN_GAP, max) });
      beginDrag("end", e.pointerId, e.currentTarget);
    }
  };

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative h-8 select-none touch-none",
        disabled && "pointer-events-none opacity-50"
      )}
      onPointerDown={onTrackDown}
    >
      <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-muted" />
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-primary/45"
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
      />
      <div
        className="pointer-events-none absolute top-0 h-full w-px bg-foreground/70"
        style={{ left: `${playPct}%` }}
        aria-hidden
      />
      <Handle
        pct={startPct}
        label="start"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginDrag("start", e.pointerId, e.currentTarget);
        }}
      />
      <Handle
        pct={endPct}
        label="end"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginDrag("end", e.pointerId, e.currentTarget);
        }}
      />
    </div>
  );
}

function Handle({
  pct,
  label,
  onPointerDown,
}: {
  pct: number;
  label: string;
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow"
      style={{ left: `${pct}%` }}
      onPointerDown={onPointerDown}
    />
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function clamp01(n: number) {
  return clamp(n, 0, 1);
}
