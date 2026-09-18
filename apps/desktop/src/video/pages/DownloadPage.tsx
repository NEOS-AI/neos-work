import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "@video/lib/toast";
import { Download, FolderOpen } from "lucide-react";
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
import { Progress } from "@video/components/ui/progress";
import { JobProgress } from "@video/components/job/JobProgress";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { hrefWithFile, rememberFile } from "@video/hooks/useRememberedFile";
import { useI18n } from "@video/lib/i18n";
import { toastJobDone } from "@video/lib/jobToast";
import { checkEnvironment } from "@video/lib/tauri/commands";
import {
  classifyDownloadUrl,
  downloadVideo,
  openDirectory,
  parseDownloadLines,
  probeDownload,
  probeDownloadList,
  type DownloadInfo,
} from "@video/lib/tauri/download";
import { formatDuration, isCancelledError } from "@video/lib/types/video";

const DIR_KEY = "neos-video:download-dir";
const LEGACY_DIR_KEY = "video-rs:download-dir";

type QueueItem = {
  key: string;
  id: string;
  url: string;
  title: string;
  duration_secs: number | null;
  uploader: string | null;
  thumbnail: string | null;
  selected: boolean;
  lineError?: string;
  resultError?: string;
};

export default function DownloadPage() {
  const { t } = useI18n();
  const [url, setUrl] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [listTitle, setListTitle] = useState<string | null>(null);
  const [asPlaylist, setAsPlaylist] = useState(false);
  const [probing, setProbing] = useState(false);
  const [outputDir, setOutputDir] = useState("");
  const [quality, setQuality] = useState("1080");
  const [ytdlpOk, setYtdlpOk] = useState<boolean | null>(null);
  const [lastPath, setLastPath] = useState("");
  const [batchLabel, setBatchLabel] = useState("");
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [currentTitle, setCurrentTitle] = useState("");
  const job = useFfmpegJob("Download");

  useEffect(() => {
    try {
      const stored =
        window.localStorage.getItem(DIR_KEY) ??
        window.localStorage.getItem(LEGACY_DIR_KEY);
      if (stored) setOutputDir(stored);
    } catch {
      // ignore
    }
    checkEnvironment()
      .then((env) => setYtdlpOk(env.ytdlp_ok))
      .catch(() => setYtdlpOk(false));
  }, []);

  const persistDir = (dir: string) => {
    setOutputDir(dir);
    try {
      window.localStorage.setItem(DIR_KEY, dir);
    } catch {
      // ignore
    }
  };

  const fromInfo = (
    info: DownloadInfo,
    opts?: { url?: string; key?: string },
  ): QueueItem => ({
    key: opts?.key ?? info.id,
    id: info.id,
    url: opts?.url ?? info.url,
    title: info.title,
    duration_secs: info.duration_secs,
    uploader: info.uploader,
    thumbnail: info.thumbnail,
    selected: true,
  });

  const handleProbe = async () => {
    const text = url.trim();
    if (!text) {
      toast.error(t("download.needUrl"));
      return;
    }
    setProbing(true);
    setItems([]);
    setListTitle(null);
    try {
      const lineCount = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length;
      if (lineCount > 1) {
        const parsed = await parseDownloadLines(text);
        setItems(
          parsed.map((line, i) => ({
            key: `line-${i}-${line.video_id ?? "err"}`,
            id: line.video_id ?? `line-${i}`,
            url: line.video_id
              ? `https://www.youtube.com/watch?v=${line.video_id}`
              : line.raw,
            title: line.raw,
            duration_secs: null,
            uploader: null,
            thumbnail: null,
            selected: !line.error,
            lineError: line.error ?? undefined,
          })),
        );
        return;
      }
      const first = text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? text;
      const kind = await classifyDownloadUrl(first);
      const listParam = playlistIdFromUrl(first);
      if (kind === "playlist" || (asPlaylist && listParam)) {
        const listUrl =
          kind === "playlist" ? first : `https://www.youtube.com/playlist?list=${listParam}`;
        const list = await probeDownloadList(listUrl);
        setListTitle(list.title);
        setItems(list.entries.map((e, i) => fromInfo(e, { key: `pl-${i}-${e.id}` })));
        return;
      }
      const next = await probeDownload(first);
      setItems([fromInfo(next, { url: first })]);
    } catch (err) {
      toast.error(t("download.probeFailed"), { description: String(err) });
    } finally {
      setProbing(false);
    }
  };

  const handleBrowseDir = async () => {
    const dir = await openDirectory();
    if (dir) persistDir(dir);
  };

  const selectedItems = items.filter((i) => i.selected && !i.lineError);

  const handleDownload = async () => {
    if (!outputDir.trim()) {
      toast.error(t("download.needUrlAndDir"));
      return;
    }
    if (selectedItems.length === 0) {
      toast.error(t("download.needSelection"));
      return;
    }
    const queue = selectedItems;
    let saved = "";
    let failed = 0;
    const result = await job.runJob(
      async (jobId) => {
        for (let i = 0; i < queue.length; i++) {
          const item = queue[i];
          setCurrentKey(item.key);
          setCurrentTitle(item.title);
          setBatchLabel(
            t("download.batchProgress", { current: i + 1, total: queue.length }),
          );
          job.hint(0, t("download.currentFile"));
          try {
            saved = await downloadVideo({
              url: item.url,
              outputDir: outputDir.trim(),
              quality,
              jobId,
            });
            setLastPath(saved);
            rememberFile(saved);
            setItems((prev) =>
              prev.map((p) =>
                p.key === item.key ? { ...p, resultError: undefined } : p,
              ),
            );
          } catch (err) {
            if (isCancelledError(err)) {
              throw err;
            }
            failed += 1;
            const message = String(err);
            setItems((prev) =>
              prev.map((p) =>
                p.key === item.key ? { ...p, resultError: message } : p,
              ),
            );
          }
        }
      },
      {
        outputPath: saved || outputDir.trim(),
        replay:
          queue.length === 1
            ? {
                command: "download_video",
                args: {
                  options: {
                    url: queue[0].url,
                    output_dir: outputDir.trim(),
                    quality,
                    job_id: null,
                  },
                },
              }
            : undefined,
      },
    );
    setBatchLabel("");
    setCurrentKey(null);
    setCurrentTitle("");
    if (result.ok && failed === 0 && saved) {
      toastJobDone(t("download.done"), saved);
    } else if (result.ok && failed > 0) {
      toast.message(t("download.batchPartial"), {
        description: t("download.batchSummary")
          .replace("{ok}", String(queue.length - failed))
          .replace("{fail}", String(failed)),
      });
    } else if (result.ok) {
      toast.success(t("download.done"));
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("download.failed"), { description: result.error });
    }
  };

  const allSelected = items.length > 0 && items.every((i) => i.lineError || i.selected);
  const toggleAll = (on: boolean) => {
    setItems((prev) => prev.map((i) => (i.lineError ? i : { ...i, selected: on })));
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("download.title")}</h2>
        <p className="text-muted-foreground">{t("download.blurb")}</p>
      </div>

      {ytdlpOk === false && (
        <p className="text-sm text-destructive">{t("download.missingYtdlp")}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("download.url")}</CardTitle>
          <CardDescription>{t("download.urlDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={"https://www.youtube.com/watch?v=…"}
            rows={4}
            className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring flex w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none"
          />
          {playlistIdFromUrl(url.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "") &&
            url.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).length === 1 && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={asPlaylist}
                onChange={(e) => setAsPlaylist(e.target.checked)}
              />
              {t("download.asPlaylist")}
            </label>
          )}
          <Button variant="outline" onClick={handleProbe} disabled={probing || job.isRunning}>
            {probing ? t("download.probing") : t("download.probe")}
          </Button>
        </CardContent>
      </Card>

      {items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{listTitle ?? t("download.queue")}</CardTitle>
            <CardDescription>
              {t("download.queueCount").replace("{n}", String(items.length))}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => toggleAll(e.target.checked)}
              />
              {t("download.selectAll")}
            </label>
            <ul className="max-h-64 space-y-2 overflow-y-auto text-sm">
              {items.map((item) => (
                <li key={item.key} className="rounded-md border px-3 py-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1"
                      disabled={!!item.lineError}
                      checked={item.selected}
                      onChange={(e) =>
                        setItems((prev) =>
                          prev.map((p) =>
                            p.key === item.key ? { ...p, selected: e.target.checked } : p,
                          ),
                        )
                      }
                    />
                    {item.thumbnail && (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="mt-0.5 h-12 w-20 shrink-0 rounded object-cover"
                      />
                    )}
                    <span>
                      <span className="font-medium">{item.title}</span>
                      <span className="block text-muted-foreground">
                        {item.id}
                        {item.duration_secs != null && ` · ${formatDuration(item.duration_secs)}`}
                        {item.uploader && ` · ${item.uploader}`}
                      </span>
                      {item.lineError && (
                        <span className="block text-destructive">{item.lineError}</span>
                      )}
                      {item.resultError && (
                        <span className="block text-destructive">{item.resultError}</span>
                      )}
                      {currentKey === item.key && job.isRunning && (
                        <span className="mt-2 block space-y-1">
                          <span className="flex items-center justify-between text-xs">
                            <span>{t("download.currentFile")}</span>
                            <span>{job.percent.toFixed(0)}%</span>
                          </span>
                          <Progress value={job.percent} />
                          {job.message && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {job.message}
                            </span>
                          )}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t("download.save")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>{t("download.quality")}</Label>
            <Select value={quality} onValueChange={(v) => v && setQuality(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1080">{t("download.q1080")}</SelectItem>
                <SelectItem value="720">{t("download.q720")}</SelectItem>
                <SelectItem value="best">{t("download.qBest")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("download.folder")}</Label>
            <div className="flex gap-2">
              <Input value={outputDir} onChange={(e) => persistDir(e.target.value)} />
              <Button type="button" variant="outline" className="gap-2" onClick={handleBrowseDir}>
                <FolderOpen className="h-4 w-4" />
                {t("common.browse")}
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              className="gap-2"
              onClick={handleDownload}
              disabled={job.isRunning || selectedItems.length === 0}
            >
              <Download className="h-4 w-4" />
              {t("download.start")}
            </Button>
            {job.isRunning && (
              <Button variant="outline" onClick={() => void job.cancel()}>
                {t("common.cancel")}
              </Button>
            )}
          </div>
          {job.isRunning && (
            <JobProgress
              percent={job.percent}
              message={job.message}
              label={batchLabel || t("download.running")}
              subtitle={currentTitle || undefined}
              onCancel={job.cancel}
            />
          )}
          {lastPath && (
            <p className="text-sm text-muted-foreground">
              {lastPath}{" "}
              <Link className="underline" to={hrefWithFile("/video/viewer", lastPath)}>
                {t("download.openViewer")}
              </Link>
              {" · "}
              <Link className="underline" to={hrefWithFile("/video/timeline", lastPath)}>
                {t("download.openTimeline")}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function playlistIdFromUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    const list = parsed.searchParams.get("list");
    return list && list.length > 0 ? list : null;
  } catch {
    return null;
  }
}
