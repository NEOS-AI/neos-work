import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@video/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video/components/ui/card";
import { Badge } from "@video/components/ui/badge";
import { revealPath } from "@video/lib/tauri/commands";
import {
  clearJobs,
  listJobs,
  subscribeJobs,
  type JobRecord,
} from "@video/lib/jobHistory";
import { invokeReplay } from "@video/lib/jobReplay";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { toastJobDone } from "@video/lib/jobToast";
import { JobProgress } from "@video/components/job/JobProgress";
import { jobLabelKey, useI18n } from "@video/lib/i18n";

function statusVariant(status: JobRecord["status"]): "default" | "secondary" | "outline" | "destructive" {
  if (status === "ok") return "default";
  if (status === "running") return "secondary";
  if (status === "cancelled") return "outline";
  return "destructive";
}

function formatWhen(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function JobsPage() {
  const { t } = useI18n();
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const runner = useFfmpegJob("Rerun");

  useEffect(() => {
    queueMicrotask(() => setJobs(listJobs()));
    return subscribeJobs(() => setJobs(listJobs()));
  }, []);

  const handleRerun = async (job: JobRecord) => {
    if (!job.replay) {
      toast.error(t("jobs.noReplay"));
      return;
    }
    const result = await runner.runJob(
      (jobId) => invokeReplay(job.replay!, jobId),
      {
        outputPath: job.outputPath,
        replay: job.replay,
        label: job.label,
      }
    );
    const label = t(jobLabelKey(job.label));
    if (result.ok && job.outputPath) {
      toastJobDone(t("jobs.rerunOk", { label }), job.outputPath);
    } else if (result.ok) {
      toast.success(t("jobs.rerunOk", { label }));
    } else if (result.cancelled) {
      toast.message(t("jobs.rerunCancelled"));
    } else {
      toast.error(t("jobs.rerunFailed"), { description: result.error });
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">{t("jobs.title")}</h2>
          <p className="text-muted-foreground">{t("jobs.blurb")}</p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => {
            clearJobs();
            setJobs([]);
          }}
          disabled={jobs.length === 0}
        >
          <Trash2 className="h-4 w-4" />
          {t("jobs.clear")}
        </Button>
      </div>

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("jobs.empty")}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <Card key={job.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-base">{t(jobLabelKey(job.label))}</CardTitle>
                  <Badge variant={statusVariant(job.status)}>
                    {t(`jobs.status.${job.status}`)}
                  </Badge>
                </div>
                <CardDescription>
                  {t("jobs.started", { time: formatWhen(job.startedAt) })}
                  {job.finishedAt
                    ? t("jobs.finished", { time: formatWhen(job.finishedAt) })
                    : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {job.outputPath && (
                  <p className="truncate text-sm">{job.outputPath}</p>
                )}
                {job.error && (
                  <p className="text-sm text-destructive">{job.error}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {job.outputPath && job.status === "ok" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      onClick={() =>
                        revealPath(job.outputPath!).catch((err) =>
                          toast.error(t("jobs.openFolderFailed"), { description: String(err) })
                        )
                      }
                    >
                      <FolderOpen className="h-4 w-4" />
                      {t("jobs.show")}
                    </Button>
                  )}
                  {job.replay && job.status !== "running" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2"
                      disabled={runner.isRunning}
                      onClick={() => handleRerun(job)}
                    >
                      <RotateCcw className="h-4 w-4" />
                      {t("jobs.rerun")}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {runner.isRunning && (
        <JobProgress
          percent={runner.percent}
          message={runner.message}
          label={t("jobs.rerunning")}
          onCancel={runner.cancel}
        />
      )}
    </div>
  );
}
