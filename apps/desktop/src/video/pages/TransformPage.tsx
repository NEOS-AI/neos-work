import { useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, RotateCw } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@video/components/ui/select";
import { JobProgress } from "@video/components/job/JobProgress";
import { openVideoFile, saveFile, transformVideo } from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

const ROTATIONS = [
  { value: "0", labelKey: "rotate.none" },
  { value: "90", labelKey: "rotate.90" },
  { value: "180", labelKey: "rotate.180" },
  { value: "270", labelKey: "rotate.270" },
] as const;

export default function TransformPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [rotate, setRotate] = useState("90");
  const [hflip, setHflip] = useState(false);
  const [vflip, setVflip] = useState(false);
  const job = useFfmpegJob("Rotate");

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_transform.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleBrowse = async () => {
    const path = await openVideoFile();
    if (path) setInputPath(path);
  };

  const handleTransform = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    const degrees = parseInt(rotate, 10);
    if (degrees === 0 && !hflip && !vflip) {
      toast.error(t("rotate.needOp"));
      return;
    }
    const result = await job.runJob(
      (jobId) =>
        transformVideo({
          inputPath,
          outputPath: resolvedOutput,
          rotateDegrees: degrees,
          hflip,
          vflip,
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "transform_video",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            rotate_degrees: degrees,
            hflip,
            vflip,
            video_codec: null,
            crf: null,
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("rotate.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("rotate.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("rotate.title")}</h2>
        <p className="text-muted-foreground">{t("rotate.blurb")}</p>
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
                  const path = await saveFile("output_transform.mp4", ["mp4", "mkv", "mov"]);
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
          <CardTitle>{t("rotate.section")}</CardTitle>
          <CardDescription>{t("rotate.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("rotate.rotate")}</Label>
            <Select value={rotate} onValueChange={(v) => v && setRotate(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROTATIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {t(r.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={hflip}
              onChange={(e) => setHflip(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("rotate.hflip")}
          </Label>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={vflip}
              onChange={(e) => setVflip(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("rotate.vflip")}
          </Label>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("rotate.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleTransform} disabled={job.isRunning} className="gap-2">
        <RotateCw className="h-4 w-4" />
        {job.isRunning ? t("rotate.running") : t("rotate.run")}
      </Button>
    </div>
  );
}
