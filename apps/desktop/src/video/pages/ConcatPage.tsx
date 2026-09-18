import { useEffect, useRef, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Layers, Trash2, ArrowUp, ArrowDown } from "lucide-react";
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
import {
  concatVideos,
  openVideoFile,
  openVideoFiles,
  saveFile,
} from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

export default function ConcatPage() {
  const { t } = useI18n();
  const [remembered] = useRememberedFile();
  const [inputs, setInputs] = useState<string[]>([]);
  const [outputPath, setOutputPath] = useState("");
  const [streamCopy, setStreamCopy] = useState(true);
  const job = useFfmpegJob("Concat");
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !remembered) return;
    seeded.current = true;
    queueMicrotask(() => {
      setInputs([remembered]);
      setOutputPath(`${remembered.replace(/\.[^.]+$/, "")}_concat.mp4`);
    });
  }, [remembered]);

  const setList = (next: string[]) => {
    setInputs(next);
    if (next[0] && !outputPath) {
      setOutputPath(`${next[0].replace(/\.[^.]+$/, "")}_concat.mp4`);
    }
  };

  const addFiles = async () => {
    const paths = await openVideoFiles();
    if (paths.length) setList([...inputs, ...paths]);
  };

  const addOne = async () => {
    const path = await openVideoFile();
    if (path) setList([...inputs, path]);
  };

  const move = (index: number, dir: -1 | 1) => {
    const next = [...inputs];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    setList(next);
  };

  const handleConcat = async () => {
    if (inputs.length < 2 || !outputPath) {
      toast.error(t("concat.needTwo"));
      return;
    }
    const result = await job.runJob(
      (jobId) =>
        concatVideos({
          inputs,
          outputPath,
          streamCopy,
          jobId,
        }),
      {
        outputPath,
        replay: {
          command: "concat_videos",
          args: {
            inputs,
            output_path: outputPath,
            stream_copy: streamCopy,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("concat.done"), outputPath);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("concat.failed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("concat.title")}</h2>
        <p className="text-muted-foreground">{t("concat.blurb")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("concat.inputs")}</CardTitle>
          <CardDescription>{t("concat.inputsDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {inputs.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("concat.empty")}</p>
          )}
          {inputs.map((path, i) => (
            <div key={`${path}-${i}`} className="flex items-center gap-2">
              <span className="w-6 shrink-0 text-xs text-muted-foreground">{i + 1}</span>
              <p className="min-w-0 flex-1 truncate text-sm">{path}</p>
              <Button variant="outline" size="icon-xs" onClick={() => move(i, -1)}>
                <ArrowUp className="h-3 w-3" />
              </Button>
              <Button variant="outline" size="icon-xs" onClick={() => move(i, 1)}>
                <ArrowDown className="h-3 w-3" />
              </Button>
              <Button
                variant="outline"
                size="icon-xs"
                onClick={() => setList(inputs.filter((_, j) => j !== i))}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="outline" onClick={addFiles}>
              {t("concat.addFiles")}
            </Button>
            <Button variant="outline" onClick={addOne}>
              {t("concat.addOne")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("common.output")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t("common.outputVideo")}</Label>
            <div className="flex gap-2">
              <Input
                value={outputPath}
                onChange={(e) => setOutputPath(e.target.value)}
                placeholder="/path/to/joined.mp4"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={async () => {
                  const path = await saveFile("joined.mp4", ["mp4", "mkv", "mov"]);
                  if (path) setOutputPath(path);
                }}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Label className="flex items-center gap-2 font-normal">
            <input
              type="checkbox"
              checked={streamCopy}
              onChange={(e) => setStreamCopy(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("concat.copy")}
          </Label>
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("concat.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleConcat} disabled={job.isRunning} className="gap-2">
        <Layers className="h-4 w-4" />
        {job.isRunning ? t("concat.running") : t("concat.run")}
      </Button>
    </div>
  );
}
