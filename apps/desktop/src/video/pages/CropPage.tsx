import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { Crop, FolderOpen } from "lucide-react";
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
import { analyzeVideo, openVideoFile, saveFile, toAssetUrl } from "@video/lib/tauri/commands";
import { cropVideo } from "@video/lib/tauri/crop";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { CropFramePicker } from "@video/components/media/CropFramePicker";
import { useI18n } from "@video/lib/i18n";
import { displaySize } from "@video/lib/types/video";

export default function CropPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [width, setWidth] = useState("1920");
  const [height, setHeight] = useState("1080");
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number } | null>(
    null
  );
  const [previewSrc, setPreviewSrc] = useState("");
  const job = useFfmpegJob("Crop");

  useEffect(() => {
    if (!inputPath) return;
    let cancelled = false;
    analyzeVideo(inputPath)
      .then((info) => {
        if (cancelled) return;
        const video = info.streams.find((s) => s.codec_type === "video");
        const shown = displaySize(video?.width, video?.height, video?.rotation);
        if (shown) {
          setSourceSize(shown);
          setWidth(String(shown.width));
          setHeight(String(shown.height));
          setX("0");
          setY("0");
        } else {
          setSourceSize(null);
        }
      })
      .catch(() => {
        if (!cancelled) setSourceSize(null);
      });
    toAssetUrl(inputPath)
      .then((url) => {
        if (!cancelled) setPreviewSrc(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewSrc("");
      });
    return () => {
      cancelled = true;
    };
  }, [inputPath]);

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_crop.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleBrowse = async () => {
    const path = await openVideoFile();
    if (path) setInputPath(path);
  };

  const handleCrop = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    const w = parseInt(width, 10);
    const h = parseInt(height, 10);
    const ox = parseInt(x, 10);
    const oy = parseInt(y, 10);
    if ([w, h, ox, oy].some((n) => Number.isNaN(n))) {
      toast.error(t("crop.needNumbers"));
      return;
    }
    if (w <= 0 || h <= 0) {
      toast.error(t("crop.needPositive"));
      return;
    }
    if (ox < 0 || oy < 0) {
      toast.error(t("crop.needNonNeg"));
      return;
    }
    if (
      sourceSize &&
      (ox + w > sourceSize.width || oy + h > sourceSize.height)
    ) {
      toast.error(t("crop.needInFrame"));
      return;
    }

    const replay = {
      command: "crop_video",
      args: {
        input_path: inputPath,
        output_path: resolvedOutput,
        width: w,
        height: h,
        x: ox,
        y: oy,
        video_codec: null,
        crf: null,
        duration_secs: null,
        job_id: null,
      },
    };
    const result = await job.runJob(
      (jobId) =>
        cropVideo({
          inputPath,
          outputPath: resolvedOutput,
          width: w,
          height: h,
          x: ox,
          y: oy,
          jobId,
        }),
      { outputPath: resolvedOutput, replay }
    );
    if (result.ok) {
      toastJobDone(t("crop.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("crop.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("crop.title")}</h2>
        <p className="text-muted-foreground">{t("crop.blurb")}</p>
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
                  const path = await saveFile("output_crop.mp4", ["mp4", "mkv", "mov"]);
                  if (path) setOutputPath(path);
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {inputPath && sourceSize && (
            <p className="text-xs text-muted-foreground">
              {t("crop.source", { width: sourceSize.width, height: sourceSize.height })}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("crop.section")}</CardTitle>
          <CardDescription>{t("crop.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {previewSrc && sourceSize && (
            <CropFramePicker
              src={previewSrc}
              videoWidth={sourceSize.width}
              videoHeight={sourceSize.height}
              value={{
                x: parseInt(x, 10) || 0,
                y: parseInt(y, 10) || 0,
                width: parseInt(width, 10) || 1,
                height: parseInt(height, 10) || 1,
              }}
              onChange={(rect) => {
                setX(String(rect.x));
                setY(String(rect.y));
                setWidth(String(rect.width));
                setHeight(String(rect.height));
              }}
              onDisplaySize={(size) => {
                if (
                  sourceSize &&
                  sourceSize.width === size.width &&
                  sourceSize.height === size.height
                ) {
                  return;
                }
                setSourceSize(size);
                setWidth(String(size.width));
                setHeight(String(size.height));
                setX("0");
                setY("0");
              }}
            />
          )}
          <div className="flex flex-wrap gap-4">
            <div className="space-y-1">
              <Label>{t("crop.width")}</Label>
              <Input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setWidth(e.target.value)}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("crop.height")}</Label>
              <Input
                type="number"
                min={1}
                value={height}
                onChange={(e) => setHeight(e.target.value)}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("crop.x")}</Label>
              <Input
                type="number"
                min={0}
                value={x}
                onChange={(e) => setX(e.target.value)}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label>{t("crop.y")}</Label>
              <Input
                type="number"
                min={0}
                value={y}
                onChange={(e) => setY(e.target.value)}
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
          label={t("crop.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleCrop} disabled={job.isRunning} className="gap-2">
        <Crop className="h-4 w-4" />
        {job.isRunning ? t("crop.running") : t("crop.run")}
      </Button>
    </div>
  );
}
