import { lazy, Suspense } from "react";

const VideoPlayerInner = lazy(() => import("./VideoPlayerInner"));

export interface VideoPlayerProps {
  src: string;
  fps?: number;
  onTimeChange?: (seconds: number) => void;
  startTime?: number;
  enableSpace?: boolean;
}

export function VideoPlayer({
  src,
  fps,
  onTimeChange,
  startTime,
  enableSpace,
}: VideoPlayerProps) {
  return (
    <Suspense
      fallback={
        <div className="flex h-64 items-center justify-center rounded-lg bg-black text-sm text-white">
          Loading player…
        </div>
      }
    >
      <VideoPlayerInner
        src={src}
        fps={fps}
        onTimeChange={onTimeChange}
        startTime={startTime}
        enableSpace={enableSpace}
      />
    </Suspense>
  );
}
