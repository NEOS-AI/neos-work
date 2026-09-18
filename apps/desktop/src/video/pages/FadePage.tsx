import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Sunset } from "lucide-react";
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
import { fadeVideo } from "@video/lib/tauri/fade";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { formatDuration } from "@video/lib/types/video";
import { useI18n } from "@video/lib/i18n";

export default function FadePage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [fadeIn, setFadeIn] = useState("1");
  const [fadeOut, setFadeOut] = useState("1");
  const [includeAudio, setIncludeAudio] = useState(true);
  const [duration, setDuration] = useState<number | null>(null);
  const job = useFfmpegJob("Fade");

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_fade.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  useEffect(() => {
    if (!inputPath) return;
    analyzeVideo(inputPath)
      .then((info) => setDuration(info.format.duration))
      .catch(() => setDuration(null));
  }, [inputPath]);

  const handleFade = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    const inn = parseFloat(fadeIn);
    const out = parseFloat(fadeOut);
    if (!Number.isFinite(inn) || !Number.isFinite(out) || inn < 0 || out < 0) {
      toast.error(t("fade.needNonNeg"));
      return;
    }
    if (inn === 0 && out === 0) {
      toast.error(t("fade.needTime"));
      return;
    }
    const replay = {
      command: "fade_video",
      args: {
        input_path: inputPath,
        output_path: resolvedOutput,
        fade_in_secs: inn,
        fade_out_secs: out,
        include_audio: includeAudio,
        video_codec: null,
        crf: null,
        duration_secs: null,
        job_id: null,
      },
    };
    const result = await job.runJob(
      (jobId) =>
        fadeVideo({
          inputPath,
          outputPath: resolvedOutput,
          fadeInSecs: inn,
          fadeOutSecs: out,
          includeAudio,
          jobId,
        }),
      { outputPath: resolvedOutput, replay }
    );
    if (result.ok) {
      toastJobDone(t("fade.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("fade.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("fade.title")}</h2>
        <p className="text-muted-foreground">{t("fade.blurb")}</p>
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
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const path = await openVideoFile();
                  if (path) setInputPath(path);
                }}
              >
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
                  const path = await saveFile("output_fade.mp4", ["mp4", "mkv", "mov"]);
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
          <CardTitle>{t("fade.section")}</CardTitle>
          <CardDescription>{t("fade.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-4">
            <div className="space-y-1">
              <Label>{t("fade.in")}</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={fadeIn}
                onChange={(e) => setFadeIn(e.target.value)}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("fade.out")}</Label>
              <Input
                type="number"
                min={0}
                step="0.1"
                value={fadeOut}
                onChange={(e) => setFadeOut(e.target.value)}
                className="w-28"
              />
            </div>
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={includeAudio}
              onChange={(e) => setIncludeAudio(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("fade.audio")}
          </Label>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("fade.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleFade} disabled={job.isRunning} className="gap-2">
        <Sunset className="h-4 w-4" />
        {job.isRunning ? t("fade.running") : t("fade.run")}
      </Button>
    </div>
  );
}
