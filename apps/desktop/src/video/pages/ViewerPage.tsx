import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Camera } from "lucide-react";
import { Button } from "@video/components/ui/button";
import { Input } from "@video/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video/components/ui/card";
import {
  analyzeVideo,
  exportFrame,
  openVideoFile,
  saveFile,
  toAssetUrl,
} from "@video/lib/tauri/commands";
import { VideoPlayer } from "@video/components/video-player/VideoPlayer";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { parseFps } from "@video/lib/types/video";
import { toastJobDone } from "@video/lib/jobToast";
import { JobProgress } from "@video/components/job/JobProgress";
import { useI18n } from "@video/lib/i18n";

export default function ViewerPage() {
  const { t } = useI18n();
  const [filePath, setFilePath] = useRememberedFile();
  const [activeSrc, setActiveSrc] = useState("");
  const [fps, setFps] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  const job = useFfmpegJob("Snapshot");

  useEffect(() => {
    if (!filePath) return;
    analyzeVideo(filePath)
      .then((info) => {
        const video = info.streams.find((s) => s.codec_type === "video");
        const parsed = parseFps(video?.r_frame_rate ?? null);
        if (parsed && parsed > 0) setFps(parsed);
      })
      .catch(() => setFps(30));
    toAssetUrl(filePath)
      .then(setActiveSrc)
      .catch((err) => toast.error(t("viewer.loadFailed"), { description: String(err) }));
  }, [filePath, t]);

  const handleBrowse = async () => {
    const path = await openVideoFile();
    if (path) setFilePath(path);
  };

  const handleSnapshot = async () => {
    if (!filePath) {
      toast.error(t("viewer.loadFirst"));
      return;
    }
    const defaultName = `${filePath.replace(/\.[^.]+$/, "")}_${currentTime.toFixed(3)}.png`;
    const output = await saveFile(defaultName.split(/[/\\]/).pop() ?? "frame.png", ["png", "jpg"]);
    if (!output) return;
    const result = await job.runJob(
      (jobId) =>
        exportFrame({
          inputPath: filePath,
          outputPath: output,
          atSecs: currentTime,
          jobId,
        }),
      {
        outputPath: output,
        replay: {
          command: "export_frame",
          args: {
            input_path: filePath,
            output_path: output,
            at_secs: currentTime,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("viewer.frameSaved"), output);
    } else if (result.cancelled) {
      toast.message(t("viewer.exportCancelled"));
    } else {
      toast.error(t("viewer.exportFailed"), { description: result.error });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("viewer.title")}</h2>
        <p className="text-muted-foreground">{t("viewer.blurb")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("viewer.open")}</CardTitle>
          <CardDescription>{t("viewer.openDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder="/path/to/video.mp4"
              className="flex-1"
            />
            <Button variant="outline" onClick={handleBrowse}>
              <FolderOpen className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {activeSrc && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <VideoPlayer src={activeSrc} fps={fps} onTimeChange={setCurrentTime} />
            <Button
              variant="outline"
              className="gap-2"
              onClick={handleSnapshot}
              disabled={job.isRunning}
            >
              <Camera className="h-4 w-4" />
              {t("viewer.saveFrame", { time: currentTime.toFixed(3) })}
            </Button>
            {job.isRunning && (
              <JobProgress
                percent={job.percent}
                message={job.message}
                label={t("viewer.exporting")}
                onCancel={job.cancel}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
