import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Film, Music, Repeat2, Play, Maximize2, Scissors, Clapperboard, Layers, RotateCw, Crop, Image, Gauge, Volume2, Stamp, History, Sunset, GanttChart, Download } from "lucide-react";
import { Button } from "@video/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@video/components/ui/card";
import { Badge } from "@video/components/ui/badge";
import { checkEnvironment, openVideoFile } from "@video/lib/tauri/commands";
import type { EnvironmentInfo } from "@video/lib/types/video";
import { hrefWithFile, rememberFile, useRememberedFile } from "@video/hooks/useRememberedFile";
import { useI18n } from "@video/lib/i18n";
import { Link } from "react-router-dom";

const features = [
  { href: "/video/timeline", icon: GanttChart, titleKey: "home.feat.timeline", descKey: "home.feat.timelineDesc", passFile: false },
  { href: "/video/download", icon: Download, titleKey: "home.feat.download", descKey: "home.feat.downloadDesc", passFile: false },
  { href: "/video/probe", icon: Film, titleKey: "home.feat.analyze", descKey: "home.feat.analyzeDesc" },
  { href: "/video/extract", icon: Music, titleKey: "home.feat.extract", descKey: "home.feat.extractDesc" },
  { href: "/video/transcode", icon: Repeat2, titleKey: "home.feat.transcode", descKey: "home.feat.transcodeDesc" },
  { href: "/video/viewer", icon: Play, titleKey: "home.feat.viewer", descKey: "home.feat.viewerDesc" },
  { href: "/video/resize", icon: Maximize2, titleKey: "home.feat.resize", descKey: "home.feat.resizeDesc" },
  { href: "/video/trim", icon: Scissors, titleKey: "home.feat.trim", descKey: "home.feat.trimDesc" },
  { href: "/video/clips", icon: Clapperboard, titleKey: "home.feat.clips", descKey: "home.feat.clipsDesc" },
  { href: "/video/concat", icon: Layers, titleKey: "home.feat.concat", descKey: "home.feat.concatDesc" },
  { href: "/video/transform", icon: RotateCw, titleKey: "home.feat.rotate", descKey: "home.feat.rotateDesc" },
  { href: "/video/crop", icon: Crop, titleKey: "home.feat.crop", descKey: "home.feat.cropDesc" },
  { href: "/video/speed", icon: Gauge, titleKey: "home.feat.speed", descKey: "home.feat.speedDesc" },
  { href: "/video/gif", icon: Image, titleKey: "home.feat.gif", descKey: "home.feat.gifDesc" },
  { href: "/video/volume", icon: Volume2, titleKey: "home.feat.volume", descKey: "home.feat.volumeDesc" },
  { href: "/video/fade", icon: Sunset, titleKey: "home.feat.fade", descKey: "home.feat.fadeDesc" },
  { href: "/video/watermark", icon: Stamp, titleKey: "home.feat.watermark", descKey: "home.feat.watermarkDesc" },
  { href: "/video/jobs", icon: History, titleKey: "home.feat.jobs", descKey: "home.feat.jobsDesc" },
];

export default function HomePage() {
  const { t } = useI18n();
  const [selectedFile, setSelectedFile] = useRememberedFile();
  const [env, setEnv] = useState<EnvironmentInfo | null>(null);
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => {
    checkEnvironment()
      .then(setEnv)
      .catch((err) => setEnvError(String(err)));
  }, []);

  const handleSelectFile = async () => {
    try {
      const path = await openVideoFile();
      if (path) {
        rememberFile(path);
        setSelectedFile(path);
        toast.success(t("home.fileSelected"), { description: path });
      }
    } catch (err) {
      toast.error(t("home.openFailed"), { description: String(err) });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("home.title")}</h2>
        <p className="text-muted-foreground">{t("home.blurb")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("home.selectTitle")}</CardTitle>
          <CardDescription>{t("home.selectDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Button onClick={handleSelectFile} className="gap-2">
            <FolderOpen className="h-4 w-4" />
            {t("home.openFile")}
          </Button>
          {selectedFile && (
            <p className="max-w-md truncate text-sm text-muted-foreground">
              {selectedFile}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("home.env")}</CardTitle>
          <CardDescription>{t("home.envDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {envError && (
            <p className="text-sm text-destructive">{envError}</p>
          )}
          {env && (
            <>
              <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-muted-foreground">{t("home.platform")}</dt>
                  <dd className="font-medium">
                    {env.os}/{env.arch}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("home.triple")}</dt>
                  <dd className="font-medium">{env.target_triple}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("home.sidecarNames")}</dt>
                  <dd className="font-medium">{env.ffmpeg_sidecar}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("home.ffmpeg")}</dt>
                  <dd className="font-medium">
                    {env.ffmpeg_ok ? t("home.ready") : t("home.missing")}
                    {env.ffmpeg_source ? ` (${env.ffmpeg_source})` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("home.ffprobe")}</dt>
                  <dd className="font-medium">
                    {env.ffprobe_ok ? t("home.ready") : t("home.missing")}
                    {env.ffprobe_source ? ` (${env.ffprobe_source})` : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("home.ytdlp")}</dt>
                  <dd className="font-medium">
                    {env.ytdlp_ok ? t("home.ready") : t("home.missing")}
                    {env.ytdlp_source ? ` (${env.ytdlp_source})` : ""}
                  </dd>
                </div>
              </dl>
              {env.ffmpeg_version && (
                <p className="truncate text-xs text-muted-foreground">{env.ffmpeg_version}</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {env.hw_encoders.length === 0 ? (
                  <Badge variant="outline">{t("home.noHw")}</Badge>
                ) : (
                  env.hw_encoders.map((name) => (
                    <Badge key={name} variant="secondary">
                      {name}
                    </Badge>
                  ))
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map(({ href, icon: Icon, titleKey, descKey, passFile }) => (
          <Link key={href} to={passFile === false ? href : hrefWithFile(href, selectedFile)}>
            <Card className="h-full cursor-pointer transition-colors hover:bg-accent/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Icon className="h-5 w-5 text-primary" />
                  <CardTitle className="text-base">{t(titleKey)}</CardTitle>
                </div>
                <CardDescription>{t(descKey)}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
