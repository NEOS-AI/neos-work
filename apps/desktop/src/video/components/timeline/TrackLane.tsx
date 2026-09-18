import type { TimelineTrack } from "@video/lib/timeline/types";
import { cn } from "@video/lib/utils";
import { ClipBlock, type ClipGestureResult } from "./ClipBlock";

export type TrackLaneProps = {
  track: TimelineTrack;
  selectedClipId: string | null;
  pxPerSecond: number;
  widthPx: number;
  onSelectClip: (id: string | null) => void;
  onGestureStart: () => void;
  onMove: (clipId: string, timelineStart: number) => ClipGestureResult;
  onTrim: (
    clipId: string,
    edge: "in" | "out",
    sourceTime: number,
  ) => ClipGestureResult;
  onOverlap?: () => void;
};

export function TrackLane({
  track,
  selectedClipId,
  pxPerSecond,
  widthPx,
  onSelectClip,
  onGestureStart,
  onMove,
  onTrim,
  onOverlap,
}: TrackLaneProps) {
  return (
    <div
      data-track-id={track.id}
      className={cn(
        "relative h-14 border-t",
        track.kind === "audio" ? "bg-muted/40" : "bg-muted/20",
        track.muted && "opacity-60",
      )}
      style={{ width: widthPx }}
      onPointerDown={() => onSelectClip(null)}
    >
      {track.clips.map((clip) => (
        <ClipBlock
          key={clip.id}
          clip={clip}
          kind={track.kind}
          selected={clip.id === selectedClipId}
          pxPerSecond={pxPerSecond}
          onSelect={() => onSelectClip(clip.id)}
          onGestureStart={onGestureStart}
          onMove={(start) => onMove(clip.id, start)}
          onTrim={(edge, sourceTime) => onTrim(clip.id, edge, sourceTime)}
          onOverlap={onOverlap}
        />
      ))}
    </div>
  );
}
