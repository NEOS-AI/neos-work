import { useEffect, useState } from "react";
import { toast } from "@video/lib/toast";
import { FolderOpen, Music, Captions } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@video/components/ui/select";
import { Label } from "@video/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@video/components/ui/tabs";
import { JobProgress } from "@video/components/job/JobProgress";
import { StreamPicker } from "@video/components/media/StreamPicker";
import {
  analyzeVideo,
  extractAudio,
  extractSubtitle,
  openVideoFile,
  saveFile,
} from "@video/lib/tauri/commands";
import { useFfmpegJob } from "@video/hooks/useFfmpegJob";
import { useRememberedFile } from "@video/hooks/useRememberedFile";
import type { StreamInfo } from "@video/lib/types/video";
import { toastJobDone } from "@video/lib/jobToast";
import { useI18n } from "@video/lib/i18n";

const CODEC_OPTIONS = [
  { value: "mp3", label: "MP3", ext: "mp3" },
  { value: "aac", label: "AAC", ext: "m4a" },
  { value: "flac", label: "FLAC", ext: "flac" },
  { value: "pcm_s16le", label: "WAV (PCM 16-bit)", ext: "wav" },
  { value: "libopus", label: "Opus", ext: "opus" },
];

const BITRATE_OPTIONS = ["64k", "128k", "192k", "256k", "320k"];

const SUB_EXTS = [
  { value: "srt", label: "SubRip (.srt)" },
  { value: "ass", label: "ASS (.ass)" },
  { value: "vtt", label: "WebVTT (.vtt)" },
];

export default function ExtractPage() {
  const { t } = useI18n();
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{t("extract.title")}</h2>
        <p className="text-muted-foreground">{t("extract.blurb")}</p>
      </div>

      <Tabs defaultValue="audio">
        <TabsList>
          <TabsTrigger value="audio">{t("extract.audio")}</TabsTrigger>
          <TabsTrigger value="subtitle">{t("extract.subs")}</TabsTrigger>
        </TabsList>
        <TabsContent value="audio" className="pt-4">
          <AudioExtractPanel />
        </TabsContent>
        <TabsContent value="subtitle" className="pt-4">
          <SubtitleExtractPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AudioExtractPanel() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [codec, setCodec] = useState("mp3");
  const [bitrate, setBitrate] = useState("192k");
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const job = useFfmpegJob("Extract");

  useEffect(() => {
    if (!inputPath) return;
    analyzeVideo(inputPath)
      .then((info) => {
        const audio = info.streams.filter((s) => s.codec_type === "audio");
        setStreams(info.streams);
        setSelected(audio[0] ? [audio[0].index] : []);
      })
      .catch(() => {
        setStreams([]);
        setSelected([]);
      });
  }, [inputPath]);

  const handleBrowseInput = async () => {
    const path = await openVideoFile();
    if (!path) return;
    setInputPath(path);
    const ext = CODEC_OPTIONS.find((c) => c.value === codec)?.ext ?? "mp3";
    const base = path.replace(/\.[^.]+$/, "");
    setOutputPath(`${base}_audio.${ext}`);
    try {
      const info = await analyzeVideo(path);
      const audio = info.streams.filter((s) => s.codec_type === "audio");
      setStreams(info.streams);
      setSelected(audio[0] ? [audio[0].index] : []);
    } catch (err) {
      setStreams([]);
      setSelected([]);
      toast.error(t("extract.probeFail"), { description: String(err) });
    }
  };

  const handleBrowseOutput = async () => {
    const ext = CODEC_OPTIONS.find((c) => c.value === codec)?.ext ?? "mp3";
    const path = await saveFile(`output_audio.${ext}`, [ext]);
    if (path) setOutputPath(path);
  };

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_audio.${CODEC_OPTIONS.find((c) => c.value === codec)?.ext ?? "mp3"}`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleExtract = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("extract.needFiles"));
      return;
    }
    const hasAudio = streams.some((s) => s.codec_type === "audio");
    if (!hasAudio || selected[0] == null) {
      toast.error(t("extract.emptyAudio"));
      return;
    }
    const result = await job.runJob(
      (jobId) =>
        extractAudio({
          inputPath,
          outputPath: resolvedOutput,
          codec,
          bitrate: codec === "flac" || codec === "pcm_s16le" ? undefined : bitrate,
          streamIndex: selected[0],
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        label: "Extract audio",
        replay: {
          command: "extract_audio",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            codec,
            bitrate: codec === "flac" || codec === "pcm_s16le" ? null : bitrate,
            stream_index: selected[0] ?? null,
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("extract.doneAudio"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("extract.cancelled"));
    } else {
      toast.error(t("extract.failed"), { description: result.error });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("extract.io")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PathField
            label={t("common.inputVideo")}
            value={inputPath}
            onChange={setInputPath}
            onBrowse={handleBrowseInput}
            placeholder="/path/to/video.mp4"
          />
          <PathField
            label={t("extract.outputAudio")}
            value={resolvedOutput}
            onChange={setOutputPath}
            onBrowse={handleBrowseOutput}
            placeholder="/path/to/output.mp3"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("extract.audioStream")}</CardTitle>
          <CardDescription>{t("extract.audioStreamDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <StreamPicker
            streams={streams}
            types={["audio"]}
            selected={selected}
            onChange={setSelected}
            emptyLabel={t("extract.emptyAudio")}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("extract.format")}</CardTitle>
          <CardDescription>{t("extract.formatDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label>{t("extract.codec")}</Label>
            <Select value={codec} onValueChange={(v) => v && setCodec(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CODEC_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {codec !== "flac" && codec !== "pcm_s16le" && (
            <div className="space-y-1">
              <Label>{t("extract.bitrate")}</Label>
              <Select value={bitrate} onValueChange={(v) => v && setBitrate(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BITRATE_OPTIONS.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      {job.isRunning && (
        <JobProgress
          percent={job.percent}
          message={job.message}
          label={t("extract.running")}
          onCancel={job.cancel}
        />
      )}

      <Button
        onClick={handleExtract}
        disabled={job.isRunning || !streams.some((s) => s.codec_type === "audio")}
        className="gap-2"
      >
        <Music className="h-4 w-4" />
        {job.isRunning ? t("extract.running") : t("extract.runAudio")}
      </Button>
    </div>
  );
}

function SubtitleExtractPanel() {
  const { t } = useI18n();
  const [inputPath, setInputPath] = useRememberedFile();
  const [outputPath, setOutputPath] = useState("");
  const [ext, setExt] = useState("srt");
  const [streams, setStreams] = useState<StreamInfo[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const job = useFfmpegJob("Extract");

  useEffect(() => {
    if (!inputPath) return;
    analyzeVideo(inputPath)
      .then((info) => {
        const subs = info.streams.filter((s) => s.codec_type === "subtitle");
        setStreams(info.streams);
        setSelected(subs[0] ? [subs[0].index] : []);
      })
      .catch(() => {
        setStreams([]);
        setSelected([]);
      });
  }, [inputPath]);

  const handleBrowseInput = async () => {
    const path = await openVideoFile();
    if (!path) return;
    setInputPath(path);
    const base = path.replace(/\.[^.]+$/, "");
    setOutputPath(`${base}_subs.${ext}`);
    try {
      const info = await analyzeVideo(path);
      const subs = info.streams.filter((s) => s.codec_type === "subtitle");
      setStreams(info.streams);
      setSelected(subs[0] ? [subs[0].index] : []);
      if (subs.length === 0) {
        toast.message(t("extract.noSubs"));
      }
    } catch (err) {
      setStreams([]);
      setSelected([]);
      toast.error(t("extract.probeFail"), { description: String(err) });
    }
  };

  const handleBrowseOutput = async () => {
    const path = await saveFile(`output_subs.${ext}`, [ext]);
    if (path) setOutputPath(path);
  };

  const suggestedOutput = inputPath
    ? `${inputPath.replace(/\.[^.]+$/, "")}_subs.${ext}`
    : "";
  const resolvedOutput = outputPath || suggestedOutput;

  const handleExtract = async () => {
    if (!inputPath || !resolvedOutput) {
      toast.error(t("extract.needFiles"));
      return;
    }
    if (selected[0] == null) {
      toast.error(t("extract.needSub"));
      return;
    }
    const result = await job.runJob(
      (jobId) =>
        extractSubtitle({
          inputPath,
          outputPath: resolvedOutput,
          streamIndex: selected[0],
          jobId,
        }),
      {
        outputPath: resolvedOutput,
        label: "Extract subtitle",
        replay: {
          command: "extract_subtitle",
          args: {
            input_path: inputPath,
            output_path: resolvedOutput,
            stream_index: selected[0],
            duration_secs: null,
            job_id: null,
          },
        },
      }
    );
    if (result.ok) {
      toastJobDone(t("extract.doneSub"), resolvedOutput);
    } else if (result.cancelled) {
      toast.message(t("extract.cancelled"));
    } else {
      toast.error(t("extract.failed"), { description: result.error });
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("extract.io")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PathField
            label={t("common.inputVideo")}
            value={inputPath}
            onChange={setInputPath}
            onBrowse={handleBrowseInput}
            placeholder="/path/to/video.mkv"
          />
          <PathField
            label={t("extract.outputSub")}
            value={resolvedOutput}
            onChange={setOutputPath}
            onBrowse={handleBrowseOutput}
            placeholder="/path/to/output.srt"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("extract.subStream")}</CardTitle>
          <CardDescription>{t("extract.subStreamDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <StreamPicker
            streams={streams}
            types={["subtitle"]}
            selected={selected}
            onChange={setSelected}
            emptyLabel={t("extract.emptySub")}
          />
          <div className="space-y-1">
            <Label>{t("extract.formatLabel")}</Label>
            <Select
              value={ext}
              onValueChange={(v) => {
                if (!v) return;
                setExt(v);
                if (outputPath) {
                  setOutputPath(outputPath.replace(/\.[^.]+$/, `.${v}`));
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUB_EXTS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
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
          label={t("extract.running")}
          onCancel={job.cancel}
        />
      )}

      <Button onClick={handleExtract} disabled={job.isRunning} className="gap-2">
        <Captions className="h-4 w-4" />
        {job.isRunning ? t("extract.running") : t("extract.runSub")}
      </Button>
    </div>
  );
}

function PathField({
  label,
  value,
  onChange,
  onBrowse,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
        <Button variant="outline" onClick={onBrowse}>
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
