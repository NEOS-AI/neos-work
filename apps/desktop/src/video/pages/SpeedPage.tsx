import { useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Gauge } from "lucide-react";
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
import { Badge } from "@video/components/ui/badge";
import { JobProgress } from "@video/components/job/JobProgress";
import { openVideoFile, saveFile } from "@video/lib/tauri/commands";
import { changeSpeed } from "@video/lib/tauri/speed";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

const PRESETS = [0.25, 0.5, 1, 1.5, 2, 4];

export default function SpeedPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [rate, setRate] = useState("1.5");
  const [hasAudio, setHasAudio] = useState(true);
  const job = useFfmpegJob("Speed");

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_speed.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;
  const parsedRate = parseFloat(rate);

  const handleBrowse = async () => {
    const path = await openVideoFile();
    if (path) setInputPath(path);
  };

  const handleChangeSpeed = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    if (!Number.isFinite(parsedRate) || parsedRate < 0.25 || parsedRate > 4) {
      toast.error(t("speed.rateRange"));
      return;
    }
    const result = await job.runJob(
      (jobId) =>
        changeSpeed({
          inputPath,
          outputPath: resolvedOutput,
          rate: parsedRate,
          hasAudio,
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "change_speed",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            rate: parsedRate,
            has_audio: hasAudio,
            video_codec: null,
            crf: null,
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("speed.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("speed.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("speed.title")}</h2>
        <p className="text-muted-foreground">{t("speed.blurb")}</p>
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
                  const path = await saveFile("output_speed.mp4", ["mp4", "mkv", "mov"]);
                  if (path) setOutputPath(path);
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("speed.section")}</CardTitle>
          <CardDescription>{t("speed.sectionDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => (
              <Badge
                key={preset}
                variant={parsedRate === preset ? "default" : "outline"}
                className="cursor-pointer hover:bg-accent"
                onClick={() => setRate(String(preset))}
              >
                {preset}x
              </Badge>
            ))}
          </div>
          <div className="space-y-1">
            <Label>{t("speed.rate")}</Label>
            <Input
              type="number"
              min={0.25}
              max={4}
              step={0.05}
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              className="w-28"
            />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={hasAudio}
              onChange={(e) => setHasAudio(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("speed.audio")}
          </Label>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("speed.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleChangeSpeed} disabled={job.isRunning} className="gap-2">
        <Gauge className="h-4 w-4" />
        {job.isRunning ? t("speed.running") : t("speed.run")}
      </Button>
    </div>
  );
}
