import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Repeat2 } from "lucide-react";
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@video/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@video/components/ui/tabs";
import { JobProgress } from "@video/components/job/JobProgress";
import { StreamPicker } from "@video/components/media/StreamPicker";
import {
  analyzeVideo,
  checkEnvironment,
  muxVideo,
  openAudioFile,
  openSubtitleFile,
  openVideoFile,
  saveFile,
  transcodeVideo,
} from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import type { StreamInfo } from "@video/lib/types/video";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

const SOFTWARE_VIDEO_CODECS = ["libx264", "libx265", "libvpx-vp9", "copy"];
const AUDIO_CODECS = ["aac", "mp3", "libopus", "copy"];
const CONTAINERS = ["mp4", "mkv", "webm", "mov", "avi"];

export default function TranscodePage() {
  const { t } = useI18n();
  const [hwEncoders, setHwEncoders] = useState<string[]>([]);

  useEffect(() => {
    checkEnvironment()
      .then((env) => setHwEncoders(env.hw_encoders))
      .catch(() => setHwEncoders([]));
  }, []);

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("tc.title")}</h2>
        <p className="text-muted-foreground">{t("tc.blurb")}</p>
      </div>

      <Tabs defaultValue="transcode">
        <TabsList>
          <TabsTrigger value="transcode">{t("tc.tab.transcode")}</TabsTrigger>
          <TabsTrigger value="mux">{t("tc.tab.mux")}</TabsTrigger>
        </TabsList>

        <TabsContent value="transcode" className="space-y-4 pt-4">
          <TranscodePanel hwEncoders={hwEncoders} />
        </TabsContent>
        <TabsContent value="mux" className="space-y-4 pt-4">
          <MuxPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TranscodePanel({ hwEncoders }: { hwEncoders: string[] }) {
  const { t } = useI18n();
  const job = useFfmpegJob("Transcode");
  const [tcInput, setTcInput] = useRememberedFile();
  const [tcOutput, setTcOutput] = useState("");
  const [tcVideoCodec, setTcVideoCodec] = useState("libx264");
  const [tcAudioCodec, setTcAudioCodec] = useState("aac");
  const [tcCrf, setTcCrf] = useState("23");
  const [subtitleMode, setSubtitleMode] = useState<"none" | "copy" | "burn">("copy");
  const [inputStreams, setInputStreams] = useState<StreamInfo[]>([]);
  const [burnSel, setBurnSel] = useState<number[]>([]);
  const [extSubPath, setExtSubPath] = useState("");

  useEffect(() => {
    if (!tcInput) return;
    analyzeVideo(tcInput)
      .then((info) => {
        setInputStreams(info.streams);
        const firstSub = info.streams.find((s) => s.codec_type === "subtitle");
        setBurnSel(firstSub ? [firstSub.index] : []);
      })
      .catch(() => {
        setInputStreams([]);
        setBurnSel([]);
      });
  }, [tcInput]);

  const handleTranscode = async () => {
    if (!tcInput || !tcOutput) {
      toast.error(t("tc.setPaths"));
      return;
    }
    if (subtitleMode === "burn" && tcVideoCodec === "copy") {
      toast.error(t("tc.burnNeedEncode"));
      return;
    }
    const options = {
      input_path: tcInput,
      output_path: tcOutput,
      video_codec: tcVideoCodec,
      audio_codec: tcAudioCodec,
      crf: tcVideoCodec !== "copy" ? parseInt(tcCrf, 10) : null,
      subtitle_mode: subtitleMode,
      subtitle_stream_index: subtitleMode === "burn" && !extSubPath ? burnSel[0] ?? null : null,
      subtitle_input: subtitleMode === "burn" && extSubPath ? extSubPath : null,
      duration_secs: null,
      job_id: null,
    };
    const result = await job.runJob(
      (jobId) =>
        transcodeVideo({
          input_path: tcInput,
          output_path: tcOutput,
          video_codec: tcVideoCodec,
          audio_codec: tcAudioCodec,
          crf: tcVideoCodec !== "copy" ? parseInt(tcCrf, 10) : undefined,
          subtitle_mode: subtitleMode,
          subtitle_stream_index: subtitleMode === "burn" && !extSubPath ? burnSel[0] : undefined,
          subtitle_input: subtitleMode === "burn" && extSubPath ? extSubPath : null,
          job_id: jobId,
        }),
      {
        outputPath: tcOutput,
        replay: { command: "transcode_video", args: { options } },
      }
    );
    if (result.ok) {
      toastJobDone(t("tc.done"), tcOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("tc.failed"), { description: result.error });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("common.files")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathRow
            label={t("common.input")}
            value={tcInput}
            onChange={setTcInput}
            onBrowse={async () => {
              const path = await openVideoFile();
              if (!path) return;
              setTcInput(path);
              try {
                const info = await analyzeVideo(path);
                setInputStreams(info.streams);
                const firstSub = info.streams.find((s) => s.codec_type === "subtitle");
                setBurnSel(firstSub ? [firstSub.index] : []);
              } catch {
                setInputStreams([]);
                setBurnSel([]);
              }
            }}
          />
          <PathRow
            label={t("common.output")}
            value={tcOutput}
            onChange={setTcOutput}
            onBrowse={async () => {
              const path = await saveFile(`output.${CONTAINERS[0]}`, CONTAINERS);
              if (path) setTcOutput(path);
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("tc.codec")}</CardTitle>
          <CardDescription>{t("tc.codecDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t("tc.videoCodec")}</Label>
              <Select value={tcVideoCodec} onValueChange={(v) => v && setTcVideoCodec(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>{t("resize.software")}</SelectLabel>
                    {SOFTWARE_VIDEO_CODECS.map((c) => (
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
              <Label>{t("tc.audioCodec")}</Label>
              <Select value={tcAudioCodec} onValueChange={(v) => v && setTcAudioCodec(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDIO_CODECS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {tcVideoCodec !== "copy" && (
            <div className="space-y-1">
              <Label>
                {t("quality.hint", { label: qualityLabel(tcVideoCodec, t) })}
              </Label>
              <Input
                type="number"
                min={0}
                max={51}
                value={tcCrf}
                onChange={(e) => setTcCrf(e.target.value)}
                className="w-24"
              />
            </div>
          )}
          <div className="space-y-1">
            <Label>{t("tc.subs")}</Label>
            <Select
              value={subtitleMode}
              onValueChange={(v) => v && setSubtitleMode(v as "none" | "copy" | "burn")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copy">{t("tc.subs.copy")}</SelectItem>
                <SelectItem value="burn">{t("tc.subs.burn")}</SelectItem>
                <SelectItem value="none">{t("tc.subs.none")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {subtitleMode === "burn" && (
            <div className="space-y-3">
              <PathRow
                label={t("tc.extSub")}
                value={extSubPath}
                onChange={setExtSubPath}
                onBrowse={async () => {
                  const path = await openSubtitleFile();
                  if (path) setExtSubPath(path);
                }}
              />
              {!extSubPath && (
                <div className="space-y-2">
                  <Label>{t("tc.embedSub")}</Label>
                  <StreamPicker
                    streams={inputStreams}
                    types={["subtitle"]}
                    selected={burnSel}
                    onChange={setBurnSel}
                    name="transcode-burn-sub"
                    emptyLabel={t("tc.embedEmpty")}
                  />
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("tc.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleTranscode} disabled={job.isRunning} className="gap-2">
        <Repeat2 className="h-4 w-4" />
        {job.isRunning ? t("tc.running") : t("tc.run")}
      </Button>
    </>
  );
}

function MuxPanel() {
  const { t } = useI18n();
  const job = useFfmpegJob("Mux");
  const [muxVideoPath, setMuxVideoPath] = useRememberedFile();
  const [muxAudioPath, setMuxAudioPath] = useState("");
  const [muxSubPath, setMuxSubPath] = useState("");
  const [muxOutput, setMuxOutput] = useState("");
  const [videoInfo, setVideoInfo] = useState<StreamInfo[]>([]);
  const [audioInfo, setAudioInfo] = useState<StreamInfo[]>([]);
  const [subInfo, setSubInfo] = useState<StreamInfo[]>([]);
  const [videoSel, setVideoSel] = useState<number[]>([]);
  const [audioSel, setAudioSel] = useState<number[]>([]);
  const [subSel, setSubSel] = useState<number[]>([]);
  const [subFileSel, setSubFileSel] = useState<number[]>([]);

  useEffect(() => {
    if (!muxVideoPath) return;
    analyzeVideo(muxVideoPath)
      .then((info) => {
        setVideoInfo(info.streams);
        const firstV = info.streams.find((s) => s.codec_type === "video");
        setVideoSel(firstV ? [firstV.index] : []);
      })
      .catch(() => setVideoInfo([]));
  }, [muxVideoPath]);

  const loadVideo = async () => {
    const path = await openVideoFile();
    if (!path) return;
    setMuxVideoPath(path);
    try {
      const info = await analyzeVideo(path);
      setVideoInfo(info.streams);
      const firstV = info.streams.find((s) => s.codec_type === "video");
      setVideoSel(firstV ? [firstV.index] : []);
      setSubSel([]);
    } catch (err) {
      toast.error(t("tc.probeVideo"), { description: String(err) });
    }
  };

  const loadAudio = async () => {
    const path = (await openAudioFile()) ?? (await openVideoFile());
    if (!path) return;
    setMuxAudioPath(path);
    try {
      const info = await analyzeVideo(path);
      setAudioInfo(info.streams);
      const firstA = info.streams.find((s) => s.codec_type === "audio");
      setAudioSel(firstA ? [firstA.index] : []);
    } catch (err) {
      toast.error(t("tc.probeAudio"), { description: String(err) });
    }
  };

  const loadSub = async () => {
    const path = await openSubtitleFile();
    if (!path) return;
    setMuxSubPath(path);
    try {
      const info = await analyzeVideo(path);
      setSubInfo(info.streams);
      const firstS = info.streams.find((s) => s.codec_type === "subtitle");
      setSubFileSel(firstS ? [firstS.index] : []);
    } catch {
      setSubInfo([]);
      setSubFileSel([]);
    }
  };

  const handleMux = async () => {
    if (!muxVideoPath || !muxAudioPath || !muxOutput) {
      toast.error(t("tc.mux.needAll"));
      return;
    }
    const options = {
      video_input: muxVideoPath,
      audio_input: muxAudioPath,
      output_path: muxOutput,
      video_streams: videoSel,
      audio_streams: audioSel,
      subtitle_streams: subSel,
      subtitle_input: muxSubPath || null,
      subtitle_input_streams: muxSubPath ? subFileSel : [],
      duration_secs: null,
      job_id: null,
    };
    const result = await job.runJob(
      (jobId) =>
        muxVideo({
          video_input: muxVideoPath,
          audio_input: muxAudioPath,
          output_path: muxOutput,
          video_streams: videoSel,
          audio_streams: audioSel,
          subtitle_streams: subSel,
          subtitle_input: muxSubPath || null,
          subtitle_input_streams: muxSubPath ? subFileSel : [],
          job_id: jobId,
        }),
      { outputPath: muxOutput, replay: { command: "mux_video", args: { options } } }
    );
    if (result.ok) {
      toastJobDone(t("tc.mux.done"), muxOutput);
    } else if (result.cancelled) {
      toast.message(t("common.cancelled"));
    } else {
      toast.error(t("tc.mux.failed"), { description: result.error });
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t("tc.mux.inputs")}</CardTitle>
          <CardDescription>{t("tc.mux.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <PathRow label={t("tc.mux.video")} value={muxVideoPath} onChange={setMuxVideoPath} onBrowse={loadVideo} />
          <PathRow label={t("tc.mux.audio")} value={muxAudioPath} onChange={setMuxAudioPath} onBrowse={loadAudio} />
          <PathRow
            label={t("tc.mux.sub")}
            value={muxSubPath}
            onChange={setMuxSubPath}
            onBrowse={loadSub}
          />
          <PathRow
            label={t("common.output")}
            value={muxOutput}
            onChange={setMuxOutput}
            onBrowse={async () => {
              const path = await saveFile(`output.${CONTAINERS[0]}`, CONTAINERS);
              if (path) setMuxOutput(path);
            }}
          />
        </CardContent>
      </Card>

      {videoInfo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("tc.mux.vstreams")}</CardTitle>
            <CardDescription>{t("tc.mux.vstreamsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <StreamPicker
              streams={videoInfo}
              types={["video"]}
              selected={videoSel}
              onChange={setVideoSel}
              multiple
            />
          </CardContent>
        </Card>
      )}

      {audioInfo.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("tc.mux.astreams")}</CardTitle>
          </CardHeader>
          <CardContent>
            <StreamPicker
              streams={audioInfo}
              types={["audio"]}
              selected={audioSel}
              onChange={setAudioSel}
              multiple
            />
          </CardContent>
        </Card>
      )}

      {videoInfo.some((s) => s.codec_type === "subtitle") && (
        <Card>
          <CardHeader>
            <CardTitle>{t("tc.mux.sstreams")}</CardTitle>
            <CardDescription>{t("tc.mux.sstreamsDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            <StreamPicker
              streams={videoInfo}
              types={["subtitle"]}
              selected={subSel}
              onChange={setSubSel}
              multiple
              name="mux-video-subs"
            />
          </CardContent>
        </Card>
      )}

      {muxSubPath && (
        <Card>
          <CardHeader>
            <CardTitle>{t("tc.mux.extStreams")}</CardTitle>
          </CardHeader>
          <CardContent>
            <StreamPicker
              streams={subInfo}
              types={["subtitle"]}
              selected={subFileSel}
              onChange={setSubFileSel}
              multiple
              name="mux-file-subs"
              emptyLabel={t("tc.mux.extEmpty")}
            />
          </CardContent>
        </Card>
      )}

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("tc.mux.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleMux} disabled={job.isRunning} className="gap-2">
        <Repeat2 className="h-4 w-4" />
        {job.isRunning ? t("tc.mux.running") : t("tc.mux.run")}
      </Button>
    </>
  );
}

function qualityLabel(codec: string, t: (key: string) => string): string {
  if (codec.includes("videotoolbox")) return t("quality.vt");
  if (codec.includes("nvenc")) return t("quality.nvenc");
  if (codec.includes("qsv")) return t("quality.qsv");
  return t("quality.crf");
}

function PathRow({
  label,
  value,
  onChange,
  onBrowse,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="/path/to/file" />
        <Button variant="outline" size="icon" onClick={onBrowse}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
