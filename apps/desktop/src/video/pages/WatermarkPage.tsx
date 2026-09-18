import { useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Stamp } from "lucide-react";
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
import { openVideoFile, saveFile } from "@video/lib/tauri/commands";
import { applyWatermark } from "@video/lib/tauri/watermark";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

const POSITIONS = [
  { value: "br", labelKey: "watermark.pos.br" },
  { value: "bl", labelKey: "watermark.pos.bl" },
  { value: "tr", labelKey: "watermark.pos.tr" },
  { value: "tl", labelKey: "watermark.pos.tl" },
  { value: "center", labelKey: "watermark.pos.center" },
] as const;

export default function WatermarkPage() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [mode, setMode] = useState<"image" | "text">("text");
  const [imagePath, setImagePath] = useState("");
  const [text, setText] = useState("");
  const [position, setPosition] = useState("br");
  const [fontSize, setFontSize] = useState("32");
  const job = useFfmpegJob("Watermark");

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_mark.mp4`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleApply = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("common.setPaths"));
      return;
    }
    if (mode === "image" && !imagePath) {
      toast.error(t("watermark.needImage"));
      return;
    }
    if (mode === "text" && !text.trim()) {
      toast.error(t("watermark.needText"));
      return;
    }
    const size = parseInt(fontSize, 10);
    const result = await job.runJob(
      (jobId) =>
        applyWatermark({
          inputPath,
          outputPath: resolvedOutput,
          position,
          imagePath: mode === "image" ? imagePath : undefined,
          text: mode === "text" ? text : undefined,
          fontSize: Number.isFinite(size) ? size : 32,
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        replay: {
          command: "apply_watermark",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            position,
            image_path: mode === "image" ? imagePath : null,
            text: mode === "text" ? text : null,
            font_path: null,
            font_size: Number.isFinite(size) ? size : 32,
            video_codec: null,
            crf: null,
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("watermark.done"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("watermark.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("watermark.title")}</h2>
        <p className="text-muted-foreground">{t("watermark.blurb")}</p>
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
                  const path = await saveFile("output_mark.mp4", ["mp4", "mkv", "mov"]);
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
          <CardTitle>{t("watermark.overlay")}</CardTitle>
          <CardDescription>{t("watermark.overlayDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("watermark.kind")}</Label>
            <Select value={mode} onValueChange={(v) => v && setMode(v as "image" | "text")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">{t("watermark.text")}</SelectItem>
                <SelectItem value="image">{t("watermark.image")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {mode === "image" ? (
            <div className="space-y-1">
              <Label>{t("watermark.image")}</Label>
              <div className="flex gap-2">
                <Input
                  value={imagePath}
                  onChange={(e) => setImagePath(e.target.value)}
                  placeholder="/path/to/logo.png"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={async () => {
                    const { open } = await import("@tauri-apps/plugin-dialog");
                    const result = await open({
                      multiple: false,
                      filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp"] }],
                    });
                    if (typeof result === "string") setImagePath(result);
                  }}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <Label>{t("watermark.text")}</Label>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="© NEOS Work" />
              </div>
              <div className="space-y-1">
                <Label>{t("watermark.fontSize")}</Label>
                <Input
                  type="number"
                  min={8}
                  max={200}
                  value={fontSize}
                  onChange={(e) => setFontSize(e.target.value)}
                  className="w-24"
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label>{t("watermark.position")}</Label>
            <Select value={position} onValueChange={(v) => v && setPosition(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSITIONS.map((p) => (
                  <SelectItem key={p.value} value={p.value}>
                    {t(p.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("watermark.burning")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleApply} disabled={job.isRunning} className="gap-2">
        <Stamp className="h-4 w-4" />
        {job.isRunning ? t("watermark.running") : t("watermark.run")}
      </Button>
    </div>
  );
}
