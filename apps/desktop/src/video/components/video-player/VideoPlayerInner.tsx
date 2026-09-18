import { useEffect, useRef, useState } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";
import { Button } from "@video/components/ui/button";
import { Input } from "@video/components/ui/input";
import { formatDuration } from "@video/lib/types/video";
import { useI18n } from "@video/lib/i18n";

export interface VideoPlayerInnerProps {
  src: string;
  fps?: number;
  onTimeChange?: (seconds: number) => void;
  startTime?: number;
  enableSpace?: boolean;
}

export default function VideoPlayerInner({
  src,
  fps = 30,
  onTimeChange,
  startTime,
  enableSpace = true,
}: VideoPlayerInnerProps) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [paused, setPaused] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekTo, setSeekTo] = useState("0");
  const onTimeChangeRef = useRef(onTimeChange);
  useEffect(() => {
    onTimeChangeRef.current = onTimeChange;
  }, [onTimeChange]);

  useEffect(() => {
    if (!videoRef.current) return;

    if (!playerRef.current) {
      const videoEl = document.createElement("video-js");
      videoEl.classList.add("vjs-big-play-centered");
      videoRef.current.appendChild(videoEl);

      const player = videojs(videoEl, {
        controls: true,
        responsive: true,
        fluid: true,
        playbackRates: [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 4],
        sources: [{ src, type: guessType(src) }],
      });
      playerRef.current = player;
      player.on("timeupdate", () => {
        const t = player.currentTime() ?? 0;
        setTime(t);
        onTimeChangeRef.current?.(t);
      });
      player.on("durationchange", () => setDuration(player.duration() ?? 0));
      player.on("play", () => setPaused(false));
      player.on("pause", () => setPaused(true));
    } else {
      playerRef.current.src([{ src, type: guessType(src) }]);
    }
  }, [src]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player || startTime == null) return;
    const apply = () => {
      const max = player.duration() ?? Number.POSITIVE_INFINITY;
      const next = Math.min(Math.max(0, startTime), Number.isFinite(max) ? max : startTime);
      player.currentTime(next);
      setTime(next);
    };
    if (player.readyState() >= 1) {
      apply();
    } else {
      player.one("loadedmetadata", apply);
    }
    return () => {
      player.off("loadedmetadata", apply);
    };
  }, [src, startTime]);

  useEffect(() => {
    return () => {
      if (playerRef.current && !playerRef.current.isDisposed()) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, []);

  const fpsRef = useRef(fps);
  useEffect(() => {
    fpsRef.current = fps;
  }, [fps]);

  const seek = (t: number) => {
    const player = playerRef.current;
    if (!player) return;
    const max = player.duration() ?? Number.POSITIVE_INFINITY;
    const next = Math.min(Math.max(0, t), max);
    player.currentTime(next);
    setTime(next);
  };

  const stepFrames = (n: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.pause();
    const rate = fpsRef.current > 0 ? fpsRef.current : 30;
    seek((player.currentTime() ?? 0) + n / rate);
  };

  const jump = (secs: number) => {
    const player = playerRef.current;
    if (!player) return;
    seek((player.currentTime() ?? 0) + secs);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const player = playerRef.current;
      if (!player) return;
      const now = player.currentTime() ?? 0;
      const rate = fpsRef.current > 0 ? fpsRef.current : 30;
      const clampSeek = (t: number) => {
        const max = player.duration() ?? Number.POSITIVE_INFINITY;
        const next = Math.min(Math.max(0, t), max);
        player.currentTime(next);
      };
      if (e.key === " " || e.code === "Space") {
        if (!enableSpace) return;
        e.preventDefault();
        if (player.paused()) player.play();
        else player.pause();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        clampSeek(now + (e.shiftKey ? -1 : -5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        clampSeek(now + (e.shiftKey ? 1 : 5));
      } else if (e.key === "," || e.key === "<") {
        e.preventDefault();
        player.pause();
        clampSeek(now - 1 / rate);
      } else if (e.key === "." || e.key === ">") {
        e.preventDefault();
        player.pause();
        clampSeek(now + 1 / rate);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableSpace]);

  const applyPreciseSeek = () => {
    const t = parseFloat(seekTo);
    if (Number.isNaN(t)) return;
    seek(t);
  };

  return (
    <div className="space-y-3">
      <div data-vjs-player>
        <div ref={videoRef} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => jump(-5)}>
          −5s
        </Button>
        <Button variant="outline" size="sm" onClick={() => stepFrames(-1)}>
          −1f
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const p = playerRef.current;
            if (!p) return;
            if (p.paused()) p.play();
            else p.pause();
          }}
        >
          {paused ? t("player.play") : t("player.pause")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => stepFrames(1)}>
          +1f
        </Button>
        <Button variant="outline" size="sm" onClick={() => jump(5)}>
          +5s
        </Button>
        <span className="text-xs text-muted-foreground">
          {formatDuration(time)} / {formatDuration(duration || null)} · {fps.toFixed(3)} fps
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step="0.001"
          value={seekTo}
          onChange={(e) => setSeekTo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") applyPreciseSeek();
          }}
          className="w-28"
          aria-label={t("player.seekTo")}
        />
        <Button variant="outline" size="sm" onClick={applyPreciseSeek}>
          {t("player.seek")}
        </Button>
        <span className="text-xs text-muted-foreground">
          {t("player.hints")}
        </span>
      </div>
    </div>
  );
}

function guessType(src: string): string {
  const path = src.split("?")[0].split("#")[0];
  const ext = path.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    mp4: "video/mp4",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/avi",
    flv: "video/x-flv",
    m4v: "video/x-m4v",
  };
  return map[ext ?? ""] ?? "video/mp4";
}
