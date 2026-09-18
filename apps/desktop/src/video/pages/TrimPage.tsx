import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Scissors } from "lucide-react";
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
import { analyzeVideo, openVideoFile, saveFile, trimVideo } from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { formatDuration } from "@video/lib/types/video";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

export default function TrimPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [start, setStart] = useState("0");
  const [end, setEnd] = useState("");
  const [streamCopy, setStreamCopy] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const job = useFfmpegJob("Trim");

  useEffect(() => {
    if (!inputPath) return;
    analyzeVideo(inputPath)
      .then((info) => {
        setDuration(info.format.duration);
        if (!end && info.format.duration != null) {
          setEnd(info.format.duration.toFixed(3));
        }
      })
      .catch(() => setDuration(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-probe when the file changes
  }, [inputPath]);

  const handleBrowseInput = async () => {
    const path = await openVideoFile();
    if (!path) return;
    setInputPath(path);
    const base = path.replace(/\.[^.]+$/, "");
    setOutputPath(`${base}_trim.mp4`);
  };

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_trim.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleTrim = async () => {
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
    if (startSecs == null && endSecs == null) {
      toast.error(t("trim.needRange"));
      return;
    }
    if (startSecs != null && endSecs != null && endSecs <= startSecs) {
      toast.error(t("trim.endAfterStart"));
      return;
    }

    const result = await job.runJob(
      (jobId) =>
        trimVideo({
          inputPath,
          outputPath: resolvedOutput,
          startSecs,
          endSecs,
          streamCopy,
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "trim_video",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            start_secs: startSecs ?? null,
            end_secs: endSecs ?? null,
            stream_copy: streamCopy,
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("trim.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("trim.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("trim.title")}</h2>
        <p className="text-muted-foreground">{t("trim.blurb")}</p>
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
            <Label>{t("common.outputVideo")}</Label>
            <div className="flex gap-2">
              <Input
                value={resolvedOutput}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="/path/to/output.mp4"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const path = await saveFile("output_trim.mp4", ["mp4", "mkv", "mov"]);
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
          <CardTitle>{t("trim.range")}</CardTitle>
          <CardDescription>{t("trim.rangeDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="space-y-1">
              <Label>{t("trim.start")}</Label>
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
              <Label>{t("trim.end")}</Label>
              <Input
                type="number"
                min={0}
                step="0.001"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-32"
              />
            </div>
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={streamCopy}
              onChange={(e) => setStreamCopy(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("trim.copy")}
          </Label>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("trim.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleTrim} disabled={job.isRunning} className="gap-2">
        <Scissors className="h-4 w-4" />
        {job.isRunning ? t("trim.running") : t("trim.run")}
      </Button>
    </div>
  );
}
