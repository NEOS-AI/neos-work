import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Film, Music, Scissors, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@video/components/ui/button";
import {
  moveClip,
  projectDuration,
  removeClip,
  splitClip,
  trimClip,
} from "@video/lib/timeline/project";
import type { TimelineProject } from "@video/lib/timeline/types";
import { useI18n } from "@video/lib/i18n";
import { cn } from "@video/lib/utils";
import type { ClipGestureResult } from "./ClipBlock";
import { TrackLane } from "./TrackLane";

const TRACK_LABEL_W = 48;
const MIN_PX_PER_SEC = 20;
const MAX_PX_PER_SEC = 400;
const DEFAULT_PX_PER_SEC = 80;
const PAD_SECONDS = 12;

export type TimelineEditorProps = {
  project: TimelineProject;
  onChange: (next: TimelineProject) => void;
  selectedClipId: string | null;
  onSelectClip: (id: string | null) => void;
  playhead: number;
  onPlayheadChange: (t: number) => void;
  onImportVideo?: () => void;
  onImportAudio?: () => void;
  onOverlap?: () => void;
};

export function razorAt(
  project: TimelineProject,
  clipId: string,
  playhead: number,
  newId: string,
) {
  return splitClip(project, clipId, playhead, newId);
}

export function TimelineEditor({
  project,
  onChange,
  selectedClipId,
  onSelectClip,
  playhead,
  onPlayheadChange,
  onImportVideo,
  onImportAudio,
  onOverlap,
}: TimelineEditorProps) {
  const { t } = useI18n();
  const [pxPerSecond, setPxPerSecond] = useState(DEFAULT_PX_PER_SEC);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rulerRef = useRef<HTMLDivElement>(null);
  const gestureBaseRef = useRef(project);

  const duration = projectDuration(project);
  const contentSeconds = Math.max(duration + PAD_SECONDS, 20, playhead + 4);
  const contentWidth = contentSeconds * pxPerSecond;

  const ticks = useMemo(
    () => rulerTicks(contentSeconds, pxPerSecond),
    [contentSeconds, pxPerSecond],
  );

  const snapshotProject = useCallback(() => {
    gestureBaseRef.current = project;
  }, [project]);

  const handleMove = useCallback(
    (clipId: string, timelineStart: number): ClipGestureResult => {
      const result = moveClip(gestureBaseRef.current, clipId, timelineStart);
      if (result.ok) {
        onChange(result.project);
        return "ok";
      }
      return result.reason === "overlap" ? "overlap" : "rejected";
    },
    [onChange],
  );

  const handleTrim = useCallback(
    (
      clipId: string,
      edge: "in" | "out",
      sourceTime: number,
    ): ClipGestureResult => {
      const base = gestureBaseRef.current;
      const result = trimClip(base, clipId, edge, sourceTime, base.fps);
      if (result.ok) {
        onChange(result.project);
        return "ok";
      }
      return result.reason === "overlap" ? "overlap" : "rejected";
    },
    [onChange],
  );

  const handleRazor = () => {
    if (!selectedClipId) return;
    const result = razorAt(
      project,
      selectedClipId,
      playhead,
      crypto.randomUUID(),
    );
    if (result.ok) onChange(result.project);
  };

  const handleDelete = () => {
    if (!selectedClipId) return;
    onChange(removeClip(project, selectedClipId));
    onSelectClip(null);
  };

  const timeAtClientX = (clientX: number) => {
    const el = rulerRef.current;
    if (!el) return 0;
    const box = el.getBoundingClientRect();
    return Math.max(0, (clientX - box.left) / pxPerSecond);
  };

  const beginPlayheadDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onPlayheadChange(timeAtClientX(e.clientX));
    const target = e.currentTarget;
    const onMove = (ev: PointerEvent) => {
      onPlayheadChange(timeAtClientX(ev.clientX));
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

  const zoomTo = (next: number) => {
    const clamped = clamp(next, MIN_PX_PER_SEC, MAX_PX_PER_SEC);
    const el = scrollRef.current;
    if (el) {
      const time = el.scrollLeft / pxPerSecond;
      setPxPerSecond(clamped);
      requestAnimationFrame(() => {
        el.scrollLeft = time * clamped;
      });
    } else {
      setPxPerSecond(clamped);
    }
  };

  const canEdit = selectedClipId != null;

  return (
    <div className="overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onImportVideo?.()}
        >
          <Film />
          {t("timeline.importVideo")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => onImportAudio?.()}
        >
          <Music />
          {t("timeline.importAudio")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!canEdit}
          onClick={handleRazor}
        >
          <Scissors />
          {t("timeline.razor")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!canEdit}
          onClick={handleDelete}
        >
          <Trash2 />
          {t("timeline.delete")}
        </Button>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-2 font-mono text-xs tabular-nums text-muted-foreground">
            {playhead.toFixed(3)}s
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("timeline.zoomOut")}
            disabled={pxPerSecond <= MIN_PX_PER_SEC}
            onClick={() => zoomTo(pxPerSecond / 1.25)}
          >
            <ZoomOut />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("timeline.zoomIn")}
            disabled={pxPerSecond >= MAX_PX_PER_SEC}
            onClick={() => zoomTo(pxPerSecond * 1.25)}
          >
            <ZoomIn />
          </Button>
        </div>
      </div>

      <div ref={scrollRef} className="overflow-x-auto overflow-y-hidden">
        <div
          className="relative min-w-full select-none"
          style={{ width: TRACK_LABEL_W + contentWidth }}
        >
          <div className="flex">
            <div
              className="sticky left-0 z-20 shrink-0 border-r bg-card"
              style={{ width: TRACK_LABEL_W, height: 28 }}
            />
            <div
              ref={rulerRef}
              className="relative h-7 cursor-ew-resize touch-none bg-muted/30"
              style={{ width: contentWidth }}
              onPointerDown={beginPlayheadDrag}
            >
              {ticks.map((t) => (
                <div
                  key={t}
                  className="absolute top-0 h-full"
                  style={{ left: t * pxPerSecond }}
                >
                  <div className="h-1.5 w-px bg-border" />
                  <span className="absolute top-1.5 left-1 font-mono text-[10px] text-muted-foreground">
                    {formatTick(t)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {project.tracks.map((track) => (
            <div key={track.id} className="flex">
              <div
                className="sticky left-0 z-20 flex shrink-0 items-center justify-center border-r bg-card text-xs font-medium"
                style={{ width: TRACK_LABEL_W }}
              >
                {track.name}
              </div>
              <TrackLane
                track={track}
                selectedClipId={selectedClipId}
                pxPerSecond={pxPerSecond}
                widthPx={contentWidth}
                onSelectClip={onSelectClip}
                onGestureStart={snapshotProject}
                onMove={handleMove}
                onTrim={handleTrim}
                onOverlap={onOverlap}
              />
            </div>
          ))}

          <div
            aria-hidden
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-destructive"
            style={{ left: TRACK_LABEL_W + playhead * pxPerSecond }}
          >
            <div
              className={cn(
                "absolute -top-0 left-1/2 -translate-x-1/2",
                "border-x-4 border-t-[7px] border-x-transparent border-t-destructive",
              )}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function tickStep(pxPerSecond: number): number {
  if (pxPerSecond >= 200) return 0.5;
  if (pxPerSecond >= 80) return 1;
  if (pxPerSecond >= 40) return 2;
  return 5;
}

function rulerTicks(seconds: number, pxPerSecond: number): number[] {
  const step = tickStep(pxPerSecond);
  const n = Math.ceil(seconds / step);
  const ticks: number[] = [];
  for (let i = 0; i <= n; i++) ticks.push(i * step);
  return ticks;
}

function formatTick(t: number): string {
  if (t === 0) return "0";
  return Number.isInteger(t) ? `${t}s` : `${t.toFixed(1)}s`;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}
