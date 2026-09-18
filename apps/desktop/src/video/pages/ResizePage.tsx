import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Maximize2 } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@video/components/ui/select";
import { JobProgress } from "@video/components/job/JobProgress";
import { checkEnvironment, openVideoFile, resizeVideo, saveFile } from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { toastJobDone } from "@video/lib/jobToast";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { useI18n } from "@video/lib/i18n";

const PRESETS = [
  { labelKey: "resize.preset.4k", width: 3840, height: 2160 },
  { labelKey: "resize.preset.1080p", width: 1920, height: 1080 },
  { labelKey: "resize.preset.720p", width: 1280, height: 720 },
  { labelKey: "resize.preset.480p", width: 854, height: 480 },
  { labelKey: "resize.preset.360p", width: 640, height: 360 },
  { labelKey: "resize.preset.keep1920", width: 1920, height: -2 },
  { labelKey: "resize.preset.keep1280", width: 1280, height: -2 },
];

const SOFTWARE_CODECS = ["libx264", "libx265", "libvpx-vp9"];

export default function ResizePage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [codec, setCodec] = useState("libx264");
  const [crf, setCrf] = useState("23");
  const [hwEncoders, setHwEncoders] = useState<string[]>([]);
  const job = useFfmpegJob("Resize");

  useEffect(() => {
    checkEnvironment()
      .then((env) => setHwEncoders(env.hw_encoders))
      .catch(() => setHwEncoders([]));
  }, []);

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_resized.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleBrowseInput = async () => {
    const path = await openVideoFile();
    if (path) {
      setInputPath(path);
      const base = path.replace(/\.[^.]+$/, "");
      setOutputPath(`${base}_resized.mp4`);
    }
  };

  const handleBrowseOutput = async () => {
    const path = await saveFile("output_resized.mp4", ["mp4", "mkv", "mov"]);
    if (path) setOutputPath(path);
  };

  const applyPreset = (w: number, h: number) => {
    setWidth(String(w));
    setHeight(String(h));
  };

  const handleResize = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    if (isNaN(w) || isNaN(h)) {
      toast.error(t("resize.invalidDim"));
      return;
    }
    if (w <= 0 && w !== -2) {
      toast.error(t("resize.widthRule"));
      return;
    }
    if (h <= 0 && h !== -2) {
      toast.error(t("resize.heightRule"));
      return;
    }
    if (w === -2 && h === -2) {
      toast.error(t("resize.onePositive"));
      return;
    }

    const result = await job.runJob(
      (jobId) =>
        resizeVideo({
          inputPath,
          outputPath: resolvedOutput,
          width: w,
          height: h,
          videoCodec: codec,
          crf: parseInt(crf, 10),
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "resize_video",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            width: w,
            height: h,
            video_codec: codec,
            crf: parseInt(crf, 10),
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("resize.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("resize.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("resize.title")}</h2>
        <p className="text-muted-foreground">{t("resize.blurb")}</p>
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
              <Button variant="outline" size="icon" onClick={handleBrowseOutput}>
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("resize.resolution")}</CardTitle>
          <CardDescription>{t("resize.resDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Badge
                key={p.labelKey}
                variant="outline"
                className="cursor-pointer hover:bg-accent"
                onClick={() => applyPreset(p.width, p.height)}
              >
                {t(p.labelKey)}
              </Badge>
            ))}
          </div>

          <div className="flex gap-4">
            <div className="space-y-1">
              <Label>{t("resize.width")}</Label>
              <Input
                type="number"
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("resize.height")}</Label>
              <Input
                type="number"
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-28"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("resize.encoder")}</CardTitle>
          <CardDescription>{t("resize.encoderDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("resize.videoCodec")}</Label>
            <Select value={codec} onValueChange={(v) => v && setCodec(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>{t("resize.software")}</SelectLabel>
                  {SOFTWARE_CODECS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectGroup>
                {hwEncoders.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>{t("resize.hardware")}</SelectLabel>
                    {hwEncoders.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{t("resize.quality")}</Label>
            <Input
              type="number"
              min={0}
              max={51}
              value={crf}
              onChange={(e) => setCrf(e.target.value)}
              className="w-24"
            />
          </div>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("resize.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleResize} disabled={job.isRunning} className="gap-2">
        <Maximize2 className="h-4 w-4" />
        {job.isRunning ? t("resize.running") : t("resize.run")}
      </Button>
    </div>
  );
}
