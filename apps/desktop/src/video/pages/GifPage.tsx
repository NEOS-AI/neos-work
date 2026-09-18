import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Image as ImageIcon } from "lucide-react";
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
import { analyzeVideo, openVideoFile, saveFile } from "@video/lib/tauri/commands";
import { exportGif } from "@video/lib/tauri/gif";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { formatDuration } from "@video/lib/types/video";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

export default function GifPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [fps, setFps] = useState("10");
  const [width, setWidth] = useState("480");
  const [duration, setDuration] = useState<number | null>(null);
  const job = useFfmpegJob("GIF");

  useEffect(() => {
    if (!inputPath) return;
    analyzeVideo(inputPath)
      .then((info) => {
        setDuration(info.format.duration);
      })
      .catch(() => setDuration(null));
  }, [inputPath]);

  const handleBrowseInput = async () => {
    const path = await openVideoFile();
    if (!path) return;
    setInputPath(path);
    const base = path.replace(/\.[^.]+$/, "");
    setOutputPath(`${base}_clip.gif`);
  };

  const suggested = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_clip.gif`
    : "";
  const resolvedOutput = outputPath || suggested;

  const handleExport = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    const startSecs = start.trim() === "" ? undefined : parseFloat(start);
    const endSecs = end.trim() === "" ? undefined : parseFloat(end);
    if (startSecs != null && Number.isNaN(startSecs)) {
      toast.error(t("trim.invalidStart"));
      return;
    }
    if (endSecs != null && Number.isNaN(endSecs)) {
      toast.error(t("trim.invalidEnd"));
      return;
    }
    if (startSecs != null && endSecs != null && endSecs <= startSecs) {
      toast.error(t("trim.endAfterStart"));
      return;
    }

    const fpsVal = fps.trim() === "" ? undefined : parseInt(fps, 10);
    const widthVal = width.trim() === "" ? undefined : parseInt(width, 10);
    if (fpsVal != null && (!Number.isFinite(fpsVal) || fpsVal <= 0)) {
      toast.error(t("gif.needFps"));
      return;
    }
    if (widthVal != null && (!Number.isFinite(widthVal) || widthVal <= 0)) {
      toast.error(t("gif.needWidth"));
      return;
    }

    const result = await job.runJob(
      (jobId) =>
        exportGif({
          inputPath,
          outputPath: resolvedOutput,
          startSecs,
          endSecs,
          fps: fpsVal,
          width: widthVal,
          durationSecs: duration ?? undefined,
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "export_gif",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            start_secs: startSecs ?? null,
            end_secs: endSecs ?? null,
            fps: fpsVal,
            width: widthVal,
            duration_secs: duration ?? null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("gif.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("gif.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("gif.title")}</h2>
        <p className="text-muted-foreground">{t("gif.blurb")}</p>
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
              <Button variant="outline" size="icon" onClick={handleBrowseInput}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t("gif.output")}</Label>
            <div className="flex gap-2">
              <Input
                value={resolvedOutput}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="/path/to/output.gif"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const path = await saveFile("output_clip.gif", ["gif"]);
                  if (path) setOutputPath(path);
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {duration != null && (
            <p className="text-xs text-muted-foreground">
              {t("common.sourceDuration", { duration: formatDuration(duration), secs: duration.toFixed(3) })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("gif.range")}</CardTitle>
          <CardDescription>{t("gif.rangeDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label>{t("gif.start")}</Label>
              <Input
                type="number"
                min={0}
                step="0.001"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("gif.end")}</Label>
              <Input
                type="number"
                min={0}
                step="0.001"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-32"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("gif.fps")}</Label>
              <Input
                type="number"
                min={1}
                step="1"
                value={fps}
                onChange={(e) => setFps(e.target.value)}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("gif.width")}</Label>
              <Input
                type="number"
                min={1}
                step="1"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-28"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("gif.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleExport} disabled={job.isRunning} className="gap-2">
        <ImageIcon className="h-4 w-4" />
        {job.isRunning ? t("gif.running") : t("gif.run")}
      </Button>
    </div>
  );
}
