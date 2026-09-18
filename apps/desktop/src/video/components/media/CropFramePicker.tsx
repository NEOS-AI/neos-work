import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

type Drag =
  | { kind: "create"; x0: number; y0: number }
  | { kind: "move"; start: CropRect; px: number; py: number }
  | { kind: "resize"; handle: Handle; start: CropRect };

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_CURSOR: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

export function CropFramePicker({
  src,
  videoWidth,
  videoHeight,
  value,
  onChange,
  onDisplaySize,
}: {
  src: string;
  videoWidth: number;
  videoHeight: number;
  value: CropRect;
  onChange: (next: CropRect) => void;
  onDisplaySize?: (size: { width: number; height: number }) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onDisplaySizeRef = useRef(onDisplaySize);
  const [measured, setMeasured] = useState<{
    src: string;
    w: number;
    h: number;
  } | null>(null);
  const [cursor, setCursor] = useState("crosshair");
  const frame =
    measured && measured.src === src
      ? { w: measured.w, h: measured.h }
      : { w: videoWidth, h: videoHeight };
  const scaleInfo = useDisplayScale(videoRef, frame.w, frame.h);

  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onDisplaySizeRef.current = onDisplaySize;
  }, [onDisplaySize]);

  const toVideo = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const el = videoRef.current;
      if (!el || frame.w <= 0 || frame.h <= 0) return null;
      const box = el.getBoundingClientRect();
      const scale = Math.min(box.width / frame.w, box.height / frame.h);
      const ox = (box.width - frame.w * scale) / 2;
      const oy = (box.height - frame.h * scale) / 2;
      const x = Math.round((clientX - box.left - ox) / scale);
      const y = Math.round((clientY - box.top - oy) / scale);
      return {
        x: clamp(x, 0, Math.max(0, frame.w - 1)),
        y: clamp(y, 0, Math.max(0, frame.h - 1)),
      };
    },
    [frame.w, frame.h]
  );

  const hitHandle = useCallback(
    (p: { x: number; y: number }, scale: number): Handle | null => {
      const r = valueRef.current;
      const tol = Math.max(12, 16 / scale);
      for (const h of HANDLES) {
        const { hx, hy } = handlePoint(r, h);
        if (Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol) return h;
      }
      return null;
    },
    []
  );

  const applyDrag = useCallback(
    (p: { x: number; y: number }) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (drag.kind === "create") {
        onChangeRef.current(
          clampRect(
            {
              x: Math.min(drag.x0, p.x),
              y: Math.min(drag.y0, p.y),
              width: Math.max(1, Math.abs(p.x - drag.x0)),
              height: Math.max(1, Math.abs(p.y - drag.y0)),
            },
            frame.w,
            frame.h
          )
        );
        return;
      }
      if (drag.kind === "move") {
        onChangeRef.current(
          clampRect(
            {
              x: clamp(drag.start.x + (p.x - drag.px), 0, frame.w - drag.start.width),
              y: clamp(drag.start.y + (p.y - drag.py), 0, frame.h - drag.start.height),
              width: drag.start.width,
              height: drag.start.height,
            },
            frame.w,
            frame.h
          )
        );
        return;
      }
      onChangeRef.current(
        clampRect(resizeRect(drag.start, drag.handle, p, frame.w, frame.h), frame.w, frame.h)
      );
    },
    [frame.w, frame.h]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const p = toVideo(e.clientX, e.clientY);
      if (!p) return;
      if (dragRef.current) {
        applyDrag(p);
        return;
      }
      const scale = scaleInfo?.scale ?? 1;
      const handle = hitHandle(p, scale);
      if (handle) setCursor(HANDLE_CURSOR[handle]);
      else if (inside(p, valueRef.current)) setCursor("move");
      else setCursor("crosshair");
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [applyDrag, hitHandle, scaleInfo?.scale, toVideo]);

  const beginDrag = (drag: Drag, target: HTMLElement, pointerId: number) => {
    dragRef.current = drag;
    target.setPointerCapture(pointerId);
  };

  const onSurfaceDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = toVideo(e.clientX, e.clientY);
    if (!p) return;
    const scale = scaleInfo?.scale ?? 1;
    const handle = hitHandle(p, scale);
    const r = valueRef.current;
    if (handle) {
      beginDrag({ kind: "resize", handle, start: { ...r } }, e.currentTarget, e.pointerId);
      setCursor(HANDLE_CURSOR[handle]);
      return;
    }
    if (inside(p, r)) {
      beginDrag({ kind: "move", start: { ...r }, px: p.x, py: p.y }, e.currentTarget, e.pointerId);
      setCursor("move");
      return;
    }
    beginDrag({ kind: "create", x0: p.x, y0: p.y }, e.currentTarget, e.pointerId);
    onChange(clampRect({ x: p.x, y: p.y, width: 1, height: 1 }, frame.w, frame.h));
  };

  const onHandleDown = (e: ReactPointerEvent<HTMLButtonElement>, handle: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    beginDrag(
      { kind: "resize", handle, start: { ...valueRef.current } },
      e.currentTarget,
      e.pointerId
    );
    setCursor(HANDLE_CURSOR[handle]);
  };

  return (
    <div className="relative overflow-hidden rounded-lg bg-black">
      <video
        ref={videoRef}
        src={src}
        muted
        playsInline
        preload="metadata"
        className="pointer-events-none block max-h-80 w-full object-contain"
        onLoadedMetadata={(ev) => {
          const el = ev.currentTarget;
          el.currentTime = 0;
          el.pause();
          const w = el.videoWidth || videoWidth;
          const h = el.videoHeight || videoHeight;
          if (!w || !h) return;
          setMeasured({ src, w, h });
          onDisplaySizeRef.current?.({ width: w, height: h });
        }}
      />
      <div
        className="absolute inset-0 touch-none"
        style={{ cursor }}
        onPointerDown={onSurfaceDown}
      />
      {scaleInfo && (
        <>
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/15"
            style={{
              left: scaleInfo.ox + value.x * scaleInfo.scale,
              top: scaleInfo.oy + value.y * scaleInfo.scale,
              width: Math.max(1, value.width * scaleInfo.scale),
              height: Math.max(1, value.height * scaleInfo.scale),
            }}
          />
          {HANDLES.map((h) => {
            const { hx, hy } = handlePoint(value, h);
            return (
              <button
                key={h}
                type="button"
                aria-label={h}
                className="absolute z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white bg-primary shadow"
                style={{
                  left: scaleInfo.ox + hx * scaleInfo.scale,
                  top: scaleInfo.oy + hy * scaleInfo.scale,
                  cursor: HANDLE_CURSOR[h],
                }}
                onPointerDown={(e) => onHandleDown(e, h)}
              />
            );
          })}
        </>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

function evenFloor(n: number) {
  return n - (n % 2);
}

function clampRect(r: CropRect, vw: number, vh: number): CropRect {
  const x = evenFloor(clamp(r.x, 0, Math.max(0, vw - 1)));
  const y = evenFloor(clamp(r.y, 0, Math.max(0, vh - 1)));
  return {
    x,
    y,
    width: Math.max(2, evenFloor(clamp(r.width, 1, Math.max(1, vw - x)))),
    height: Math.max(2, evenFloor(clamp(r.height, 1, Math.max(1, vh - y)))),
  };
}

function inside(p: { x: number; y: number }, r: CropRect) {
  return p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height;
}

function handlePoint(r: CropRect, h: Handle) {
  const midX = r.x + r.width / 2;
  const midY = r.y + r.height / 2;
  const right = r.x + r.width;
  const bottom = r.y + r.height;
  switch (h) {
    case "nw":
      return { hx: r.x, hy: r.y };
    case "n":
      return { hx: midX, hy: r.y };
    case "ne":
      return { hx: right, hy: r.y };
    case "e":
      return { hx: right, hy: midY };
    case "se":
      return { hx: right, hy: bottom };
    case "s":
      return { hx: midX, hy: bottom };
    case "sw":
      return { hx: r.x, hy: bottom };
    case "w":
      return { hx: r.x, hy: midY };
  }
}

function resizeRect(
  start: CropRect,
  handle: Handle,
  p: { x: number; y: number },
  vw: number,
  vh: number
): CropRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (handle.includes("e")) right = clamp(p.x, left + 1, vw);
  if (handle.includes("s")) bottom = clamp(p.y, top + 1, vh);
  if (handle.includes("w")) left = clamp(p.x, 0, right - 1);
  if (handle.includes("n")) top = clamp(p.y, 0, bottom - 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function useDisplayScale(
  videoRef: RefObject<HTMLVideoElement | null>,
  videoWidth: number,
  videoHeight: number
) {
  const [info, setInfo] = useState<{ scale: number; ox: number; oy: number } | null>(
    null
  );

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || videoWidth === 0) return;
      const scale = Math.min(box.width / videoWidth, box.height / videoHeight);
      setInfo({
        scale,
        ox: (box.width - videoWidth * scale) / 2,
        oy: (box.height - videoHeight * scale) / 2,
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("loadedmetadata", update);
    return () => {
      ro.disconnect();
      el.removeEventListener("loadedmetadata", update);
    };
  }, [videoRef, videoWidth, videoHeight]);

  return info;
}
