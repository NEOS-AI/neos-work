import { toast } from "@video/lib/toast";
import { FolderOpen, Search } from "lucide-react";
import { Button } from "@video/components/ui/button";
import { Input } from "@video/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video/components/ui/card";
import { Badge } from "@video/components/ui/badge";
import { Separator } from "@video/components/ui/separator";
import { openVideoFile } from "@video/lib/tauri/commands";
import { useVideoAnalysis } from "@video/hooks/useVideoAnalysis";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import {
  formatBytes,
  formatDuration,
  parseFps,
  type StreamInfo,
} from "@video/lib/types/video";
import { useI18n } from "@video/lib/i18n";

export default function ProbePage() {
  const { t } = useI18n();
  const [filePath, setFilePath] = useRememberedFile();
  const { analyze, data, isLoading, error, reset } = useVideoAnalysis();

  const handleBrowse = async () => {
    const path = await openVideoFile();
    if (path) setFilePath(path);
  };

  const handleAnalyze = async () => {
    if (!filePath.trim()) {
      toast.error(t("probe.needFile"));
      return;
    }
    reset();
    try {
      await analyze(filePath);
    } catch (err) {
      toast.error(t("probe.failed"), { description: String(err) });
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("probe.title")}</h2>
        <p className="text-muted-foreground">{t("probe.blurb")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("probe.file")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="/path/to/video.mp4"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              className="flex-1"
            />
            <Button variant="outline" onClick={handleBrowse} className="gap-2">
              <FolderOpen className="h-4 w-4" />
              {t("common.browse")}
            </Button>
          </div>
          <Button onClick={handleAnalyze} disabled={isLoading} className="gap-2">
            <Search className="h-4 w-4" />
            {isLoading ? t("probe.analyzing") : t("probe.analyze")}
          </Button>
        </CardContent>
      </Card>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("probe.container")}</CardTitle>
              <CardDescription>{data.format.format_long_name}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
                <DataRow label={t("probe.format")} value={data.format.format_name} />
                <DataRow label={t("probe.duration")} value={formatDuration(data.format.duration)} />
                <DataRow label={t("probe.bitRate")} value={data.format.bit_rate ? `${Math.round(data.format.bit_rate / 1000)} kbps` : "—"} />
                <DataRow label={t("probe.fileSize")} value={formatBytes(data.format.size)} />
              </dl>
            </CardContent>
          </Card>

          <div className="space-y-3">
            <h3 className="font-semibold">{t("probe.streams", { count: data.streams.length })}</h3>
            {data.streams.map((s) => (
              <StreamCard key={s.index} stream={s} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function DataRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function StreamCard({ stream }: { stream: StreamInfo }) {
  const { t } = useI18n();
  const isVideo = stream.codec_type === "video";
  const fps = isVideo ? parseFps(stream.r_frame_rate) : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <Badge variant={isVideo ? "default" : stream.codec_type === "subtitle" ? "outline" : "secondary"}>
            {stream.codec_type}
          </Badge>
          <span className="font-medium text-sm">
            {t("probe.stream", { index: stream.index, codec: stream.codec_name })}
          </span>
          {stream.language && <Badge variant="outline">{stream.language}</Badge>}
        </div>
        {stream.codec_long_name && (
          <CardDescription>{stream.codec_long_name}</CardDescription>
        )}
      </CardHeader>
      <Separator />
      <CardContent className="pt-3">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
          {isVideo && stream.width && stream.height && (
            <DataRow label={t("probe.resolution")} value={`${stream.width}×${stream.height}`} />
          )}
          {fps != null && (
            <DataRow label={t("probe.fps")} value={fps.toFixed(3)} />
          )}
          {stream.pix_fmt && <DataRow label={t("probe.pixFmt")} value={stream.pix_fmt} />}
          {stream.sample_rate && <DataRow label={t("probe.sampleRate")} value={`${stream.sample_rate} Hz`} />}
          {stream.channels != null && <DataRow label={t("probe.channels")} value={String(stream.channels)} />}
          {stream.channel_layout && <DataRow label={t("probe.layout")} value={stream.channel_layout} />}
          {stream.bit_rate && <DataRow label={t("probe.bitRate")} value={stream.bit_rate} />}
          {stream.language && <DataRow label={t("probe.language")} value={stream.language} />}
          {stream.title && <DataRow label={t("probe.streamTitle")} value={stream.title} />}
          {stream.duration && <DataRow label={t("probe.duration")} value={`${parseFloat(stream.duration).toFixed(2)}s`} />}
        </dl>
      </CardContent>
    </Card>
  );
}
