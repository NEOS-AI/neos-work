import { useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Volume2 } from "lucide-react";
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
import { openVideoFile, saveFile } from "@video/lib/tauri/commands";
import { adjustVolume } from "@video/lib/tauri/volume";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

export default function VolumePage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [gainDb, setGainDb] = useState("0");
  const [normalize, setNormalize] = useState(false);
  const job = useFfmpegJob("Volume");

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_volume.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleAdjust = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    const gain = parseFloat(gainDb);
    if (!Number.isFinite(gain) || gain < -48 || gain > 48) {
      toast.error(t("volume.gainRange"));
      return;
    }
    const result = await job.runJob(
      (jobId) =>
        adjustVolume({
          inputPath,
          outputPath: resolvedOutput,
          normalize,
          gainDb: gain,
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "adjust_volume",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            normalize,
            gain_db: gain,
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("volume.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("volume.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("volume.title")}</h2>
        <p className="text-muted-foreground">{t("volume.blurb")}</p>
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
                  const path = await saveFile("output_volume.mp4", ["mp4", "mkv", "mov"]);
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
          <CardTitle>{t("volume.audio")}</CardTitle>
          <CardDescription>{t("volume.audioDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("volume.gain")}</Label>
            <Input
              type="number"
              min={-48}
              max={48}
              step="0.5"
              value={gainDb}
              onChange={(e) => setGainDb(e.target.value)}
              className="w-28"
            />
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={normalize}
              onChange={(e) => setNormalize(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("volume.norm")}
          </Label>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("volume.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleAdjust} disabled={job.isRunning} className="gap-2">
        <Volume2 className="h-4 w-4" />
        {job.isRunning ? t("volume.running") : t("volume.run")}
      </Button>
    </div>
  );
}
