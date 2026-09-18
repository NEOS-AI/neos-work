import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "@video/lib/toast";
import { ArrowDown, ArrowUp, Clapperboard, FolderOpen, Plus, Trash2 } from "lucide-react";
import { Button } from "@video/components/ui/button";
import { Input } from "@video/components/ui/input";
import { Label } from "@video/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video/components/ui/card";
import { JobProgress } from "@video/components/job/JobProgress";
import { VideoPlayer } from "@video/components/video-player/VideoPlayer";
import {
  analyzeVideo,
  openVideoFile,
  toAssetUrl,
  trimVideo,
} from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { formatDuration, parseFps } from "@video/lib/types/video";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";
import { cn } from "@video/lib/utils";
import { ClipRangeSlider } from "@video/components/media/ClipRangeSlider";

type Clip = { id: string; start: number; end: number };

function newClipId() {
  return `clip-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clipOutputPath(inputPath: string, index: number) {
  const base = inputPath.replace(/\.[^.]+$/, "");
  return `${base}_clip_${String(index).padStart(2, "0")}.mp4`;
}

export default function ClipsPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [previewSrc, setPreviewSrc] = useState("");
  const [fps, setFps] = useState(30);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [draftStart, setDraftStart] = useState("0");
  const [draftEnd, setDraftEnd] = useState("");
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [streamCopy, setStreamCopy] = useState(false);
  const [queueLabel, setQueueLabel] = useState("");
  const job = useFfmpegJob("Clip");
  const stopRef = useRef(false);

  useEffect(() => {
    if (!inputPath) return;
    analyzeVideo(inputPath)
      .then((info) => {
        setDuration(info.format.duration);
        const video = info.streams.find((s) => s.codec_type === "video");
        const parsed = parseFps(video?.r_frame_rate ?? null);
        if (parsed && parsed > 0) setFps(parsed);
        if (info.format.duration != null) {
          setDraftEnd((prev) => (prev === "" ? info.format.duration!.toFixed(3) : prev));
        }
      })
      .catch(() => {
        setDuration(null);
        setFps(30);
      });
    toAssetUrl(inputPath)
      .then(setPreviewSrc)
      .catch((err) => toast.error(t("viewer.loadFailed"), { description: String(err) }));
  }, [inputPath, t]);

  const markStart = useCallback(() => {
    setDraftStart(currentTime.toFixed(3));
  }, [currentTime]);

  const markEnd = useCallback(() => {
    setDraftEnd(currentTime.toFixed(3));
  }, [currentTime]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "i" || e.key === "I") {
        e.preventDefault();
        markStart();
      } else if (e.key === "o" || e.key === "O") {
        e.preventDefault();
        markEnd();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [markStart, markEnd]);

  const parseDraft = (): { start: number; end: number } | null => {
    const start = parseFloat(draftStart);
    const end = parseFloat(draftEnd);
    if (!Number.isFinite(start)) {
      toast.error(t("trim.invalidStart"));
      return null;
    }
    if (!Number.isFinite(end)) {
      toast.error(t("trim.invalidEnd"));
      return null;
    }
    if (end <= start) {
      toast.error(t("trim.endAfterStart"));
      return null;
    }
    if (start < 0 || (duration != null && end > duration + 0.05)) {
      toast.error(t("clips.needInRange"));
      return null;
    }
    return { start, end };
  };

  const handleBrowse = async () => {
    const path = await openVideoFile();
    if (path) setInputPath(path);
  };

  const addClip = () => {
    const range = parseDraft();
    if (!range) return;
    const clip: Clip = { id: newClipId(), ...range };
    setClips((prev) => [...prev, clip]);
    setSelectedId(clip.id);
  };

  const selectClip = (clip: Clip) => {
    setSelectedId(clip.id);
    setDraftStart(clip.start.toFixed(3));
    setDraftEnd(clip.end.toFixed(3));
  };

  const applyDraftToSelected = () => {
    if (!selectedId) return;
    const range = parseDraft();
    if (!range) return;
    setClips((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, ...range } : c))
    );
  };

  const moveClip = (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= clips.length) return;
    const next = [...clips];
    [next[index], next[j]] = [next[j], next[index]];
    setClips(next);
  };

  const removeClip = (id: string) => {
    setClips((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const handleCancel = () => {
    stopRef.current = true;
    void job.cancel();
  };

  const exportQueue = async (items: Clip[]) => {
    if (!inputPath) {
      toast.error(t("common.setPaths"));
      return;
    }
    if (items.length === 0) {
      toast.error(t("clips.needList"));
      return;
    }
    for (const clip of items) {
      if (clip.end <= clip.start) {
        toast.error(t("trim.endAfterStart"));
        return;
      }
    }

    stopRef.current = false;
    for (let i = 0; i < items.length; i++) {
      if (stopRef.current) {
        toast.message(t("common.cancelled"));
        setQueueLabel("");
        return;
      }
      const clip = items[i];
      const index = clips.indexOf(clip);
      const n = (index >= 0 ? index : i) + 1;
      const output = clipOutputPath(inputPath, n);
      setQueueLabel(t("clips.runningN", { n, total: items.length }));
      const result = await job.runJob(
        (jobId) =>
          trimVideo({
            inputPath,
            outputPath: output,
            startSecs: clip.start,
            endSecs: clip.end,
            streamCopy,
            jobId,
          }),
        {
          outputPath: output,
          replay: {
            command: "trim_video",
            args: {
              input_path: inputPath,
              output_path: output,
              start_secs: clip.start,
              end_secs: clip.end,
              stream_copy: streamCopy,
              duration_secs: null,
              job_id: null,
            },
          },
        }
      );
      if (result.ok) {
        toastJobDone(t("clips.doneN", { n }), output);
      } else if (result.cancelled || stopRef.current) {
        toast.message(t("common.cancelled"));
        setQueueLabel("");
        return;
      } else {
        toast.error(t("clips.failed"), { description: result.error });
        setQueueLabel("");
        return;
      }
    }
    setQueueLabel("");
  };

  const selected = clips.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("clips.title")}</h2>
        <p className="text-muted-foreground">{t("clips.blurb")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.files")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("common.inputVideo")}</Label>
            <div className="flex gap-2">
              <Input
                value={inputPath}
                onChange={(e) => setInputPath(e.target.value)}
                placeholder="/path/to/video.mp4"
              />
              <Button variant="outline" size="icon" onClick={handleBrowse}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {duration != null && (
            <p className="text-xs text-muted-foreground">
              {t("common.sourceDuration", {
                duration: formatDuration(duration),
                secs: duration.toFixed(3),
              })}
            </p>
          )}
        </CardContent>
      </Card>

      {previewSrc && (
        <Card>
          <CardHeader>
            <CardTitle>{t("clips.preview")}</CardTitle>
            <CardDescription>{t("clips.previewDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <VideoPlayer src={previewSrc} fps={fps} onTimeChange={setCurrentTime} />
            <p className="text-xs text-muted-foreground">
              {t("clips.now", { time: currentTime.toFixed(3) })}
            </p>
            {duration != null && duration > 0 && (
              <div className="space-y-1">
                <Label>{t("clips.slider")}</Label>
                <ClipRangeSlider
                  duration={duration}
                  start={Number.isFinite(parseFloat(draftStart)) ? parseFloat(draftStart) : 0}
                  end={
                    Number.isFinite(parseFloat(draftEnd))
                      ? parseFloat(draftEnd)
                      : duration
                  }
                  currentTime={currentTime}
                  onChange={({ start, end }) => {
                    setDraftStart(start.toFixed(3));
                    setDraftEnd(end.toFixed(3));
                  }}
                />
                <p className="text-xs text-muted-foreground">{t("clips.sliderDesc")}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={markStart}>
                {t("clips.markStart")}
              </Button>
              <Button variant="outline" onClick={markEnd}>
                {t("clips.markEnd")}
              </Button>
            </div>
            <div className="flex flex-wrap gap-4">
              <div className="space-y-1">
                <Label>{t("trim.start")}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={draftStart}
                  onChange={(e) => setDraftStart(e.target.value)}
                  className="w-32"
                />
              </div>
              <div className="space-y-1">
                <Label>{t("trim.end")}</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.001"
                  value={draftEnd}
                  onChange={(e) => setDraftEnd(e.target.value)}
                  className="w-32"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="gap-2" onClick={addClip}>
                <Plus className="h-4 w-4" />
                {t("clips.add")}
              </Button>
              {selected && (
                <Button variant="outline" onClick={applyDraftToSelected}>
                  {t("clips.update")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("clips.list")}</CardTitle>
          <CardDescription>{t("clips.listDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {clips.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("clips.empty")}</p>
          )}
          {clips.map((clip, i) => (
            <div
              key={clip.id}
              className={cn(
                "flex items-center gap-2 rounded-md border px-2 py-1.5",
                selectedId === clip.id && "border-primary bg-accent/40"
              )}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm"
                onClick={() => selectClip(clip)}
              >
                {i + 1}. {clip.start.toFixed(3)}–{clip.end.toFixed(3)}s
                <span className="ml-2 text-muted-foreground">
                  ({(clip.end - clip.start).toFixed(3)}s)
                </span>
              </button>
              <Button variant="outline" size="icon-xs" onClick={() => moveClip(i, -1)}>
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="icon-xs" onClick={() => moveClip(i, 1)}>
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="icon-xs" onClick={() => removeClip(clip.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={streamCopy}
              onChange={(e) => setStreamCopy(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("clips.copy")}
          </Label>
        </CardContent>
      </Card>

      {(job.isRunning || queueLabel) && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={queueLabel || t("clips.running")}
          onCancel={handleCancel}
        />
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          className="gap-2"
          disabled={job.isRunning || !selected}
          onClick={() => selected && exportQueue([selected])}
        >
          <Clapperboard className="h-4 w-4" />
          {t("clips.exportOne")}
        </Button>
        <Button
          variant="outline"
          className="gap-2"
          disabled={job.isRunning || clips.length === 0}
          onClick={() => exportQueue(clips)}
        >
          <Clapperboard className="h-4 w-4" />
          {t("clips.exportAll")}
        </Button>
      </div>
    </div>
  );
}
