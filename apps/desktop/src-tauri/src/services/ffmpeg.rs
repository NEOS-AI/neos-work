use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;

use crate::models::error::AppError;
use crate::models::video_info::VideoInfo;
use crate::services::encoders::{
    crf_to_videotoolbox_q, escape_filter_path, hwaccel_for_codec, is_bitmap_subtitle,
    software_fallback_codec, subtitle_codec_for_output,
};
use crate::services::ffprobe::FFprobeService;
use crate::services::job::{resolve_job_id, JobRegistry};
use crate::services::sidecar::spawn_ffmpeg;
use crate::services::ts_to_mp4::{
    build_ts_to_mp4_args, choose_ts_codecs, is_hls_playlist_path, is_mpegts_format, output_is_mp4,
    validate_ts_streams, TsConvertMode,
};

// ---------------------------------------------------------------------------
// Progress event payload
// ---------------------------------------------------------------------------

#[derive(Clone, serde::Serialize)]
pub struct ProgressPayload {
    pub job_id: String,
    /// 0–100
    pub percent: f64,
    pub message: String,
}

fn emit_progress(app: &AppHandle, job_id: &str, percent: f64, message: impl Into<String>) {
    let _ = app.emit(
        "ffmpeg-progress",
        ProgressPayload {
            job_id: job_id.to_string(),
            percent,
            message: message.into(),
        },
    );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/// Builder for constructing ffmpeg argument lists in a readable, chainable
/// manner. Call `.build()` to get the final `Vec<String>` of arguments.
pub struct FFmpegCommandBuilder {
    args: Vec<String>,
}

impl FFmpegCommandBuilder {
    pub fn new() -> Self {
        // Always suppress banner and enable progress output
        Self {
            args: vec!["-y".into(), "-hide_banner".into()],
        }
    }

    pub fn hwaccel(mut self, name: &str) -> Self {
        // Must appear before any `-i` input.
        self.args.push("-hwaccel".into());
        self.args.push(name.into());
        self
    }

    pub fn input(mut self, path: &str) -> Self {
        self.args.push("-i".into());
        self.args.push(path.into());
        self
    }

    pub fn video_codec(mut self, codec: &str) -> Self {
        self.args.push("-c:v".into());
        self.args.push(codec.into());
        self
    }

    pub fn audio_codec(mut self, codec: &str) -> Self {
        self.args.push("-c:a".into());
        self.args.push(codec.into());
        self
    }

    pub fn subtitle_codec(mut self, codec: &str) -> Self {
        self.args.push("-c:s".into());
        self.args.push(codec.into());
        self
    }

    pub fn no_video(mut self) -> Self {
        self.args.push("-vn".into());
        self
    }

    pub fn no_subtitles(mut self) -> Self {
        self.args.push("-sn".into());
        self
    }

    pub fn no_data(mut self) -> Self {
        self.args.push("-dn".into());
        self
    }

    pub fn no_audio(mut self) -> Self {
        self.args.push("-an".into());
        self
    }

    /// Append a `-vf` filter, composing with an existing one via comma.
    pub fn video_filter(mut self, filter: &str) -> Self {
        if let Some(pos) = self.args.iter().position(|a| a == "-vf") {
            if let Some(existing) = self.args.get_mut(pos + 1) {
                existing.push(',');
                existing.push_str(filter);
                return self;
            }
        }
        self.args.push("-vf".into());
        self.args.push(filter.into());
        self
    }

    pub fn scale(self, width: i32, height: i32) -> Self {
        self.video_filter(&format!("scale={}:{}", width, height))
    }

    pub fn filter_complex(mut self, graph: &str) -> Self {
        self.args.push("-filter_complex".into());
        self.args.push(graph.into());
        self
    }

    pub fn seek_start(mut self, secs: f64) -> Self {
        self.args.push("-ss".into());
        self.args.push(format_timestamp(secs));
        self
    }

    pub fn seek_end(mut self, secs: f64) -> Self {
        self.args.push("-to".into());
        self.args.push(format_timestamp(secs));
        self
    }

    pub fn format_flag(mut self, name: &str) -> Self {
        self.args.push("-f".into());
        self.args.push(name.into());
        self
    }

    pub fn arg_pair(mut self, flag: &str, value: &str) -> Self {
        self.args.push(flag.into());
        self.args.push(value.into());
        self
    }

    pub fn frames_video(mut self, n: u32) -> Self {
        self.args.push("-frames:v".into());
        self.args.push(n.to_string());
        self
    }

    pub fn crf(mut self, crf: u8) -> Self {
        self.args.push("-crf".into());
        self.args.push(crf.to_string());
        self
    }

    pub fn video_bitrate(mut self, bitrate: &str) -> Self {
        self.args.push("-b:v".into());
        self.args.push(bitrate.into());
        self
    }

    pub fn audio_bitrate(mut self, bitrate: &str) -> Self {
        self.args.push("-b:a".into());
        self.args.push(bitrate.into());
        self
    }

    pub fn audio_sample_rate(mut self, rate: u32) -> Self {
        self.args.push("-ar".into());
        self.args.push(rate.to_string());
        self
    }

    pub fn map(mut self, spec: &str) -> Self {
        self.args.push("-map".into());
        self.args.push(spec.into());
        self
    }

    pub fn map_all(mut self) -> Self {
        self.args.push("-map".into());
        self.args.push("0".into());
        self
    }

    pub fn copy_all(mut self) -> Self {
        self.args.push("-c".into());
        self.args.push("copy".into());
        self
    }

    /// Apply a CRF-like quality value using the right flag for the encoder family.
    pub fn apply_video_quality(mut self, codec: &str, crf: Option<u8>) -> Self {
        let Some(q) = crf else {
            return self;
        };
        if codec == "copy" {
            return self;
        }
        if codec.contains("videotoolbox") {
            self.args.push("-q:v".into());
            self.args.push(crf_to_videotoolbox_q(q).to_string());
            self.args.push("-allow_sw".into());
            self.args.push("1".into());
            return self;
        }
        if codec.contains("nvenc") {
            self.args.push("-rc".into());
            self.args.push("vbr".into());
            self.args.push("-cq".into());
            self.args.push(q.to_string());
            return self;
        }
        if codec.contains("qsv") {
            self.args.push("-global_quality".into());
            self.args.push(q.to_string());
            return self;
        }
        self.crf(q)
    }

    pub fn output(mut self, path: &str) -> Self {
        self.args.push(path.into());
        self
    }

    pub fn build(self) -> Vec<String> {
        self.args
    }
}

// ---------------------------------------------------------------------------
// Mux map helpers (pure — unit-tested)
// ---------------------------------------------------------------------------

/// Build `-map` specs for a mux job.
///
/// * `video_streams` / `audio_streams` / `subtitle_streams` are absolute
///   stream indices inside their respective input files.
/// * Empty video/audio lists fall back to the first stream of that type
///   (`0:v:0`, `1:a:0`) so existing callers keep working.
/// * `subtitle_input_streams` are indices in a dedicated third input
///   (`2:…`). If that input is present and the list is empty, map `2:s:0`.
pub fn build_mux_maps(
    video_streams: &[u32],
    audio_streams: &[u32],
    subtitle_streams: &[u32],
    has_subtitle_input: bool,
    subtitle_input_streams: &[u32],
) -> Vec<String> {
    let mut maps = Vec::new();

    if video_streams.is_empty() {
        maps.push("0:v:0".to_string());
    } else {
        for i in video_streams {
            maps.push(format!("0:{i}"));
        }
    }

    if audio_streams.is_empty() {
        maps.push("1:a:0".to_string());
    } else {
        for i in audio_streams {
            maps.push(format!("1:{i}"));
        }
    }

    for i in subtitle_streams {
        maps.push(format!("0:{i}"));
    }

    if has_subtitle_input {
        if subtitle_input_streams.is_empty() {
            maps.push("2:s:0".to_string());
        } else {
            for i in subtitle_input_streams {
                maps.push(format!("2:{i}"));
            }
        }
    }
    maps
}

pub(crate) fn build_mux_args(
    video_input: &str,
    audio_input: &str,
    output: &str,
    video_streams: &[u32],
    audio_streams: &[u32],
    subtitle_streams: &[u32],
    subtitle_input: Option<&str>,
    subtitle_input_streams: &[u32],
) -> Vec<String> {
    let mut builder = FFmpegCommandBuilder::new()
        .input(video_input)
        .input(audio_input);
    if let Some(sub) = subtitle_input {
        builder = builder.input(sub);
    }
    for spec in build_mux_maps(
        video_streams,
        audio_streams,
        subtitle_streams,
        subtitle_input.is_some(),
        subtitle_input_streams,
    ) {
        builder = builder.map(&spec);
    }
    builder = builder.copy_all();
    if !subtitle_streams.is_empty() || subtitle_input.is_some() {
        builder = builder.subtitle_codec(subtitle_codec_for_output(output));
    }
    builder.output(output).build()
}

/// 0-based index among subtitle streams (what FFmpeg `si=` / `0:s:N` expect).
pub fn subtitle_stream_ordinal(streams: &[(u32, String)], absolute_index: Option<u32>) -> Option<(u32, String)> {
    if streams.is_empty() {
        return None;
    }
    if let Some(abs) = absolute_index {
        if let Some((ord, (_, codec))) = streams.iter().enumerate().find(|(_, (i, _))| *i == abs)
        {
            return Some((ord as u32, codec.clone()));
        }
    }
    streams.first().map(|(_, codec)| (0, codec.clone()))
}

pub fn burn_in_text_filter(input_path: &str, subtitle_ordinal: u32) -> String {
    format!(
        "subtitles={}:si={}",
        escape_filter_path(input_path),
        subtitle_ordinal
    )
}

pub fn format_timestamp(secs: f64) -> String {
    format!("{secs:.3}")
}

/// Concat demuxer list body. Paths are single-quoted; `'` becomes `'\''`.
pub fn concat_list_contents(paths: &[String]) -> Result<String, AppError> {
    if paths.len() < 2 {
        return Err(AppError::InvalidArgument(
            "concat needs at least two input files".into(),
        ));
    }
    let mut out = String::new();
    for p in paths {
        if p.is_empty() {
            return Err(AppError::InvalidArgument(
                "concat input paths must not be empty".into(),
            ));
        }
        let escaped = p.replace('\'', r"'\''");
        out.push_str("file '");
        out.push_str(&escaped);
        out.push_str("'\n");
    }
    Ok(out)
}

pub fn build_concat_args(list_path: &str, output: &str, stream_copy: bool) -> Vec<String> {
    let mut builder = FFmpegCommandBuilder::new()
        .format_flag("concat")
        .arg_pair("-safe", "0")
        .input(list_path);
    if stream_copy {
        builder = builder.copy_all();
    } else {
        builder = builder
            .video_codec("libx264")
            .audio_codec("aac")
            .apply_video_quality("libx264", Some(23));
    }
    builder.output(output).build()
}

/// `rotate_degrees` is 0, 90, 180, or 270 (clockwise).
pub fn build_transform_filter(rotate_degrees: i32, hflip: bool, vflip: bool) -> Result<String, AppError> {
    let mut parts: Vec<String> = match rotate_degrees {
        0 => Vec::new(),
        90 => vec!["transpose=1".into()],
        180 => vec!["transpose=1".into(), "transpose=1".into()],
        270 => vec!["transpose=2".into()],
        _ => {
            return Err(AppError::InvalidArgument(
                "rotate_degrees must be 0, 90, 180, or 270".into(),
            ));
        }
    };
    if hflip {
        parts.push("hflip".into());
    }
    if vflip {
        parts.push("vflip".into());
    }
    if parts.is_empty() {
        return Err(AppError::InvalidArgument(
            "choose a rotation or at least one flip".into(),
        ));
    }
    Ok(parts.join(","))
}

pub fn build_transform_args(
    input: &str,
    output: &str,
    rotate_degrees: i32,
    hflip: bool,
    vflip: bool,
    video_codec: &str,
    crf: Option<u8>,
) -> Result<Vec<String>, AppError> {
    let filter = build_transform_filter(rotate_degrees, hflip, vflip)?;
    Ok(FFmpegCommandBuilder::new()
        .input(input)
        .video_filter(&filter)
        .video_codec(video_codec)
        .apply_video_quality(video_codec, crf.or(Some(23)))
        .audio_codec("copy")
        .output(output)
        .build())
}

pub fn build_frame_args(input: &str, output: &str, at_secs: f64) -> Result<Vec<String>, AppError> {
    if at_secs < 0.0 {
        return Err(AppError::InvalidArgument(
            "at_secs must be non-negative".into(),
        ));
    }
    Ok(FFmpegCommandBuilder::new()
        .seek_start(at_secs)
        .input(input)
        .frames_video(1)
        .output(output)
        .build())
}

/// Build ffmpeg args for a trim/cut. `start`/`end` are seconds on the source timeline.
/// Stream-copy seeks on the input side (fast); re-encode seeks after `-i` (frame-accurate).
pub fn build_trim_args(
    input: &str,
    output: &str,
    start: Option<f64>,
    end: Option<f64>,
    stream_copy: bool,
) -> Result<Vec<String>, AppError> {
    if start.is_none() && end.is_none() {
        return Err(AppError::InvalidArgument(
            "set start_secs and/or end_secs to trim".into(),
        ));
    }
    if let (Some(s), Some(e)) = (start, end) {
        if e <= s {
            return Err(AppError::InvalidArgument(
                "end_secs must be greater than start_secs".into(),
            ));
        }
    }
    if start.is_some_and(|s| s < 0.0) || end.is_some_and(|e| e < 0.0) {
        return Err(AppError::InvalidArgument(
            "start_secs and end_secs must be non-negative".into(),
        ));
    }

    let mut builder = FFmpegCommandBuilder::new();
    if stream_copy {
        if let Some(s) = start {
            builder = builder.seek_start(s);
        }
        if let Some(e) = end {
            builder = builder.seek_end(e);
        }
        builder = builder.input(input).copy_all();
    } else {
        builder = builder.input(input);
        if let Some(s) = start {
            builder = builder.seek_start(s);
        }
        if let Some(e) = end {
            builder = builder.seek_end(e);
        }
        builder = builder
            .video_codec("libx264")
            .audio_codec("aac")
            .apply_video_quality("libx264", Some(23));
    }
    Ok(builder.output(output).build())
}

pub fn validate_extract_audio(
    info: &VideoInfo,
    stream_index: Option<u32>,
) -> Result<(), AppError> {
    let tracks: Vec<_> = info
        .streams
        .iter()
        .filter(|s| s.codec_type == "audio")
        .collect();
    if tracks.is_empty() {
        return Err(AppError::InvalidArgument(
            "input has no audio stream".into(),
        ));
    }
    if let Some(idx) = stream_index {
        if !tracks.iter().any(|s| s.index == idx) {
            return Err(AppError::InvalidArgument(format!(
                "stream {idx} is not an audio track"
            )));
        }
    }
    Ok(())
}

pub(crate) fn build_extract_audio_args(
    input: &str,
    output: &str,
    codec: &str,
    bitrate: Option<&str>,
    stream_index: Option<u32>,
) -> Vec<String> {
    let mut builder = FFmpegCommandBuilder::new().input(input);
    if let Some(idx) = stream_index {
        builder = builder.map(&format!("0:{idx}"));
    } else {
        builder = builder.no_video();
    }
    builder = builder.audio_codec(codec);
    if let Some(br) = bitrate {
        builder = builder.audio_bitrate(br);
    }
    builder.output(output).build()
}

pub fn burn_in_bitmap_graph(subtitle_ordinal: u32) -> String {
    format!("[0:v][0:s:{subtitle_ordinal}]overlay[vout]")
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

pub struct FFmpegService;

impl FFmpegService {
    /// Probe `path` when the caller did not supply a duration.
    pub async fn resolve_duration(
        app: &AppHandle,
        path: &str,
        provided: Option<f64>,
    ) -> Option<f64> {
        if let Some(d) = provided {
            if d > 0.0 {
                return Some(d);
            }
        }
        FFprobeService::probe(app, path)
            .await
            .ok()
            .and_then(|info| info.format.duration)
            .filter(|d| *d > 0.0)
    }

    /// Run an ffmpeg command built by `FFmpegCommandBuilder`.
    /// Parses stderr for `time=` progress markers and emits `"ffmpeg-progress"`
    /// events to the frontend. The spawned child is registered so `cancel_job`
    /// can kill it.
    pub async fn run(
        app: &AppHandle,
        args: Vec<String>,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let job_id = resolve_job_id(job_id);
        let registry = app.state::<JobRegistry>();
        if registry.is_cancelled(&job_id) {
            let _ = registry.finish(&job_id);
            emit_progress(app, &job_id, 0.0, "Cancelled");
            return Err(AppError::Cancelled);
        }

        let spawned = spawn_ffmpeg(app, &args)?;
        eprintln!("ffmpeg source={} job={}", spawned.source, job_id);
        let mut rx = spawned.rx;

        if let Err(err) = registry.register(&job_id, spawned.child) {
            let _ = registry.finish(&job_id);
            if matches!(err, AppError::Cancelled) {
                emit_progress(app, &job_id, 0.0, "Cancelled");
            }
            return Err(err);
        }

        let mut stderr_buf = String::new();
        let mut term_code: Option<Option<i32>> = None;

        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stderr(line) => {
                    let text = String::from_utf8_lossy(&line).to_string();
                    stderr_buf.push_str(&text);
                    stderr_buf.push('\n');

                    if let Some((percent, message)) =
                        progress_event_from_stderr(&text, total_duration_secs)
                    {
                        emit_progress(app, &job_id, percent, message);
                    }
                }
                CommandEvent::Terminated(status) => {
                    term_code = Some(status.code);
                    break;
                }
                _ => {}
            }
        }

        let cancelled = registry.finish(&job_id);
        if cancelled {
            emit_progress(app, &job_id, 0.0, "Cancelled");
            return Err(AppError::Cancelled);
        }
        if let Some(code) = term_code {
            if !code.map(|c| c == 0).unwrap_or(false) {
                return Err(AppError::Ffmpeg(stderr_buf));
            }
        }

        Ok(())
    }

    async fn run_with_hw_fallback(
        app: &AppHandle,
        primary: Vec<String>,
        fallback: Option<Vec<String>>,
        duration: Option<f64>,
        job_id: Option<&str>,
        hw_codec: &str,
    ) -> Result<(), AppError> {
        match Self::run(app, primary, duration, job_id).await {
            Err(AppError::Cancelled) => Err(AppError::Cancelled),
            Err(e) => {
                let Some(fallback_args) = fallback else {
                    return Err(e);
                };
                let soft = software_fallback_codec(hw_codec);
                eprintln!("hardware encoder `{hw_codec}` failed ({e}); retrying with {soft}");
                let id = resolve_job_id(job_id);
                emit_progress(
                    app,
                    &id,
                    0.0,
                    format!("Hardware encoder failed; retrying with {soft}"),
                );
                Self::run(app, fallback_args, duration, Some(&id)).await
            }
            Ok(()) => Ok(()),
        }
    }

    // ------------------------------------------------------------------
    // High-level operations
    // ------------------------------------------------------------------

    /// Extract audio track from a video file.
    ///
    /// `stream_index` is an absolute stream index in the input. When `None`,
    /// FFmpeg's default (first audio stream, `-vn`) is used.
    pub async fn extract_audio(
        app: &AppHandle,
        input: &str,
        output: &str,
        codec: &str,
        bitrate: Option<&str>,
        stream_index: Option<u32>,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let info = FFprobeService::probe(app, input).await.ok();
        if let Some(info) = info.as_ref() {
            validate_extract_audio(info, stream_index)?;
        }

        let args = build_extract_audio_args(input, output, codec, bitrate, stream_index);
        Self::run(app, args, duration, job_id).await
    }

    /// Extract a subtitle stream to `.srt` / `.ass` / `.vtt` (or stream-copy).
    pub async fn extract_subtitle(
        app: &AppHandle,
        input: &str,
        output: &str,
        stream_index: u32,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let codec = subtitle_codec_for_output(output);
        let args = FFmpegCommandBuilder::new()
            .input(input)
            .map(&format!("0:{stream_index}"))
            .subtitle_codec(codec)
            .output(output)
            .build();
        Self::run(app, args, duration, job_id).await
    }

    /// Transcode a video to a different codec/container.
    ///
    /// `subtitle_mode`:
    /// - `"copy"` remuxes/converts subtitle streams
    /// - `"burn"` hard-burns a subtitle stream into the video
    /// - `"none"` / omitted drops them
    pub async fn transcode(
        app: &AppHandle,
        input: &str,
        output: &str,
        video_codec: &str,
        audio_codec: &str,
        crf: Option<u8>,
        subtitle_mode: Option<&str>,
        subtitle_stream_index: Option<u32>,
        subtitle_input: Option<&str>,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        if subtitle_mode == Some("burn") && video_codec == "copy" {
            return Err(AppError::InvalidArgument(
                "burning subtitles requires re-encoding (video_codec cannot be copy)".into(),
            ));
        }

        let duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let burn = if subtitle_mode == Some("burn") {
            Some(
                Self::resolve_burn_target(app, input, subtitle_stream_index, subtitle_input)
                    .await?,
            )
        } else {
            None
        };

        let primary = build_transcode_args(
            input,
            output,
            video_codec,
            audio_codec,
            crf,
            subtitle_mode,
            burn.as_ref(),
        );
        let fallback = hwaccel_for_codec(video_codec).map(|_| {
            build_transcode_args(
                input,
                output,
                software_fallback_codec(video_codec),
                audio_codec,
                crf,
                subtitle_mode,
                burn.as_ref(),
            )
        });

        Self::run_with_hw_fallback(app, primary, fallback, duration, job_id, video_codec).await
    }

    async fn resolve_burn_target(
        app: &AppHandle,
        input: &str,
        subtitle_stream_index: Option<u32>,
        subtitle_input: Option<&str>,
    ) -> Result<BurnTarget, AppError> {
        if let Some(ext) = subtitle_input.filter(|s| !s.is_empty()) {
            return Ok(BurnTarget {
                path: ext.to_string(),
                ordinal: 0,
                bitmap: false,
            });
        }
        let info = FFprobeService::probe(app, input).await?;
        let streams: Vec<(u32, String)> = info
            .streams
            .iter()
            .filter(|s| s.codec_type == "subtitle")
            .map(|s| (s.index, s.codec_name.clone()))
            .collect();
        let (ordinal, codec) = subtitle_stream_ordinal(&streams, subtitle_stream_index).ok_or_else(
            || AppError::InvalidArgument("no subtitle stream found to burn in".into()),
        )?;
        Ok(BurnTarget {
            path: input.to_string(),
            ordinal,
            bitmap: is_bitmap_subtitle(&codec),
        })
    }

    /// Cut `[start_secs, end_secs)` from the source. Omitted bounds mean the
    /// source start/end. Stream-copy is fast; `stream_copy = false` re-encodes.
    pub async fn trim(
        app: &AppHandle,
        input: &str,
        output: &str,
        start_secs: Option<f64>,
        end_secs: Option<f64>,
        stream_copy: bool,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let source_duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let clip = match (start_secs, end_secs, source_duration) {
            (Some(s), Some(e), _) => Some(e - s),
            (Some(s), None, Some(total)) => Some((total - s).max(0.0)),
            (None, Some(e), _) => Some(e),
            _ => source_duration,
        };
        let args = build_trim_args(input, output, start_secs, end_secs, stream_copy)?;
        Self::run(app, args, clip, job_id).await
    }

    /// Mux selected streams from a video file, an audio file, and optionally a
    /// dedicated subtitle file into a single container (stream copy).
    pub async fn mux(
        app: &AppHandle,
        video_input: &str,
        audio_input: &str,
        output: &str,
        video_streams: &[u32],
        audio_streams: &[u32],
        subtitle_streams: &[u32],
        subtitle_input: Option<&str>,
        subtitle_input_streams: &[u32],
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = Self::resolve_duration(app, video_input, total_duration_secs).await;
        let args = build_mux_args(
            video_input,
            audio_input,
            output,
            video_streams,
            audio_streams,
            subtitle_streams,
            subtitle_input,
            subtitle_input_streams,
        );
        Self::run(app, args, duration, job_id).await
    }

    /// Convert a single MPEG-TS file to MP4. Policy lives in `ts_to_mp4`; this
    /// method is probe → plan → `run` / `run_with_hw_fallback`.
    pub async fn convert_ts_to_mp4(
        app: &AppHandle,
        input: &str,
        output: &str,
        mode: Option<&str>,
        video_codec: Option<&str>,
        audio_codec: Option<&str>,
        crf: Option<u8>,
        video_stream_index: Option<u32>,
        audio_stream_index: Option<u32>,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        if input.is_empty() || output.is_empty() {
            return Err(AppError::InvalidArgument(
                "input_path and output_path must not be empty".into(),
            ));
        }
        // HLS playlists share a `.ts` segment extension; reject before probe (K8).
        if is_hls_playlist_path(input) {
            return Err(AppError::InvalidArgument(
                "HLS playlists are not supported; use a single MPEG-TS file".into(),
            ));
        }
        if !output_is_mp4(output) {
            return Err(AppError::InvalidArgument(
                "output_path must end with .mp4".into(),
            ));
        }

        let info = FFprobeService::probe(app, input).await?;
        if !is_mpegts_format(&info.format.format_name) {
            return Err(AppError::InvalidArgument("input is not MPEG-TS".into()));
        }

        let first_video = info
            .streams
            .iter()
            .filter(|s| s.codec_type == "video")
            .map(|s| s.index)
            .min();
        let Some(default_video) = first_video else {
            return Err(AppError::InvalidArgument(
                "input has no video stream".into(),
            ));
        };
        let video_idx = video_stream_index.unwrap_or(default_video);
        let audio_idx = audio_stream_index.or_else(|| {
            info.streams
                .iter()
                .filter(|s| s.codec_type == "audio")
                .map(|s| s.index)
                .min()
        });
        validate_ts_streams(&info.streams, video_idx, audio_idx)?;

        let video_codec_name = info
            .streams
            .iter()
            .find(|s| s.index == video_idx)
            .map(|s| s.codec_name.as_str())
            .unwrap_or("");
        let audio_codec_name = audio_idx.and_then(|idx| {
            info.streams
                .iter()
                .find(|s| s.index == idx)
                .map(|s| s.codec_name.as_str())
        });

        let parsed_mode = TsConvertMode::parse(mode)?;
        // auto follows the codec table even if the UI leaked codec/crf fields (K21).
        let (user_video, user_audio, user_crf) = match parsed_mode {
            TsConvertMode::Auto => (None, None, None),
            _ => (video_codec, audio_codec, crf),
        };
        let plan = choose_ts_codecs(
            video_codec_name,
            audio_codec_name,
            parsed_mode,
            user_video,
            user_audio,
            user_crf,
        )?;

        let duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let primary = build_ts_to_mp4_args(input, output, &plan, video_idx, audio_idx);
        if hwaccel_for_codec(&plan.video_codec).is_some() {
            let mut fallback_plan = plan.clone();
            fallback_plan.video_codec = software_fallback_codec(&plan.video_codec).to_string();
            let fallback =
                build_ts_to_mp4_args(input, output, &fallback_plan, video_idx, audio_idx);
            Self::run_with_hw_fallback(
                app,
                primary,
                Some(fallback),
                duration,
                job_id,
                &plan.video_codec,
            )
            .await
        } else {
            Self::run(app, primary, duration, job_id).await
        }
    }

    /// Resize a video to target dimensions, optionally with a hardware encoder.
    pub async fn resize(
        app: &AppHandle,
        input: &str,
        output: &str,
        width: i32,
        height: i32,
        video_codec: Option<&str>,
        crf: Option<u8>,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let codec = video_codec.unwrap_or("libx264");

        let primary = build_resize_args(input, output, width, height, codec, crf);
        let fallback = hwaccel_for_codec(codec).map(|_| {
            build_resize_args(
                input,
                output,
                width,
                height,
                software_fallback_codec(codec),
                crf,
            )
        });

        Self::run_with_hw_fallback(app, primary, fallback, duration, job_id, codec).await
    }

    pub async fn concat(
        app: &AppHandle,
        inputs: &[String],
        output: &str,
        stream_copy: bool,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let list_body = concat_list_contents(inputs)?;
        let list_path = std::env::temp_dir().join(format!(
            "video-rs-concat-{}.txt",
            resolve_job_id(job_id)
        ));
        std::fs::write(&list_path, list_body)?;

        let mut total = 0.0;
        for path in inputs {
            if let Some(d) = Self::resolve_duration(app, path, None).await {
                total += d;
            }
        }
        let duration = if total > 0.0 { Some(total) } else { None };
        let list_str = list_path.to_string_lossy().to_string();
        let args = build_concat_args(&list_str, output, stream_copy);
        let result = Self::run(app, args, duration, job_id).await;
        let _ = std::fs::remove_file(&list_path);
        result
    }

    pub async fn transform(
        app: &AppHandle,
        input: &str,
        output: &str,
        rotate_degrees: i32,
        hflip: bool,
        vflip: bool,
        video_codec: Option<&str>,
        crf: Option<u8>,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = Self::resolve_duration(app, input, total_duration_secs).await;
        let codec = video_codec.unwrap_or("libx264");
        let args = build_transform_args(input, output, rotate_degrees, hflip, vflip, codec, crf)?;
        Self::run(app, args, duration, job_id).await
    }

    pub async fn export_frame(
        app: &AppHandle,
        input: &str,
        output: &str,
        at_secs: f64,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let args = build_frame_args(input, output, at_secs)?;
        Self::run(app, args, Some(1.0), job_id).await
    }
}

pub(crate) struct BurnTarget {
    path: String,
    ordinal: u32,
    bitmap: bool,
}

pub(crate) fn build_transcode_args(
    input: &str,
    output: &str,
    video_codec: &str,
    audio_codec: &str,
    crf: Option<u8>,
    subtitle_mode: Option<&str>,
    burn: Option<&BurnTarget>,
) -> Vec<String> {
    let mut builder = FFmpegCommandBuilder::new();
    // Hardware decode + the subtitles filter cannot share frames; skip hwaccel when burning.
    if burn.is_none() {
        if let Some(hw) = hwaccel_for_codec(video_codec) {
            builder = builder.hwaccel(hw);
        }
    }
    builder = builder.input(input);

    if let Some(target) = burn {
        if target.bitmap {
            builder = builder
                .filter_complex(&burn_in_bitmap_graph(target.ordinal))
                .map("[vout]")
                .map("0:a?");
        } else {
            builder = builder
                .video_filter(&burn_in_text_filter(&target.path, target.ordinal))
                .map("0:v?")
                .map("0:a?")
                .no_subtitles();
        }
    }

    builder = builder
        .video_codec(video_codec)
        .audio_codec(audio_codec)
        .apply_video_quality(video_codec, crf);

    if subtitle_mode == Some("copy") {
        builder = builder
            .map("0:v?")
            .map("0:a?")
            .map("0:s?")
            .subtitle_codec(subtitle_codec_for_output(output));
    }

    builder.output(output).build()
}

pub(crate) fn build_resize_args(
    input: &str,
    output: &str,
    width: i32,
    height: i32,
    codec: &str,
    crf: Option<u8>,
) -> Vec<String> {
    let mut builder = FFmpegCommandBuilder::new();
    if let Some(hw) = hwaccel_for_codec(codec) {
        builder = builder.hwaccel(hw);
    }
    builder
        .input(input)
        .scale(width, height)
        .video_codec(codec)
        .apply_video_quality(codec, crf.or(Some(23)))
        .audio_codec("copy")
        .output(output)
        .build()
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Map an ffmpeg stderr line to `(percent, trimmed line)` for `ffmpeg-progress`.
/// Falls back to 0% when `time=` is present but duration is missing or zero.
pub(crate) fn progress_event_from_stderr(
    line: &str,
    total_secs: Option<f64>,
) -> Option<(f64, String)> {
    if let Some(percent) = parse_progress_percent(line, total_secs) {
        return Some((percent, line.trim().to_string()));
    }
    let duration_unknown = total_secs.map(|t| t <= 0.0).unwrap_or(true);
    if duration_unknown && line.contains("time=") {
        Some((0.0, line.trim().to_string()))
    } else {
        None
    }
}

/// Parse "time=HH:MM:SS.mm" from an ffmpeg stderr line and convert to a
/// 0–100 percentage given `total_duration_secs`.
fn parse_progress_percent(line: &str, total_secs: Option<f64>) -> Option<f64> {
    let total = total_secs?;
    if total <= 0.0 {
        return None;
    }

    // Find "time=HH:MM:SS.xx"
    let idx = line.find("time=")?;
    let time_str = &line[idx + 5..];
    let end = time_str.find(' ').unwrap_or(time_str.len());
    let time_str = &time_str[..end];

    parse_time_to_secs(time_str).map(|elapsed| (elapsed / total * 100.0).min(100.0))
}

fn parse_time_to_secs(s: &str) -> Option<f64> {
    // Format: HH:MM:SS.ms or HH:MM:SS
    let parts: Vec<&str> = s.splitn(3, ':').collect();
    if parts.len() != 3 {
        return None;
    }
    let h: f64 = parts[0].parse().ok()?;
    let m: f64 = parts[1].parse().ok()?;
    let sec: f64 = parts[2].parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_maps_before_output() {
        let args = FFmpegCommandBuilder::new()
            .input("v.mp4")
            .input("a.aac")
            .map("0:0")
            .map("1:1")
            .copy_all()
            .output("out.mkv")
            .build();
        assert_eq!(
            args,
            vec![
                "-y",
                "-hide_banner",
                "-i",
                "v.mp4",
                "-i",
                "a.aac",
                "-map",
                "0:0",
                "-map",
                "1:1",
                "-c",
                "copy",
                "out.mkv",
            ]
        );
    }

    #[test]
    fn builder_hwaccel_precedes_input() {
        let args = FFmpegCommandBuilder::new()
            .hwaccel("videotoolbox")
            .input("in.mov")
            .video_codec("h264_videotoolbox")
            .apply_video_quality("h264_videotoolbox", Some(23))
            .output("out.mp4")
            .build();
        assert_eq!(args[0], "-y");
        assert_eq!(args[2], "-hwaccel");
        assert_eq!(args[3], "videotoolbox");
        assert_eq!(args[4], "-i");
        assert!(args.contains(&"-q:v".to_string()));
        assert!(args.contains(&"-allow_sw".to_string()));
        assert!(!args.contains(&"-crf".to_string()));
    }

    #[test]
    fn builder_nvenc_uses_cq() {
        let args = FFmpegCommandBuilder::new()
            .input("in.mp4")
            .video_codec("hevc_nvenc")
            .apply_video_quality("hevc_nvenc", Some(28))
            .output("out.mp4")
            .build();
        assert!(args.windows(2).any(|w| w == ["-cq", "28"]));
        assert!(!args.contains(&"-crf".to_string()));
    }

    #[test]
    fn builder_software_uses_crf() {
        let args = FFmpegCommandBuilder::new()
            .input("in.mp4")
            .video_codec("libx264")
            .apply_video_quality("libx264", Some(18))
            .output("out.mp4")
            .build();
        assert!(args.windows(2).any(|w| w == ["-crf", "18"]));
    }

    #[test]
    fn mux_maps_default_to_first_of_each_type() {
        assert_eq!(
            build_mux_maps(&[], &[], &[], false, &[]),
            vec!["0:v:0", "1:a:0"]
        );
    }

    #[test]
    fn mux_maps_selected_absolute_indices() {
        assert_eq!(
            build_mux_maps(&[2], &[0, 3], &[5], true, &[1]),
            vec!["0:2", "1:0", "1:3", "0:5", "2:1"]
        );
    }

    #[test]
    fn mux_maps_default_subtitle_input() {
        assert_eq!(
            build_mux_maps(&[], &[], &[], true, &[]),
            vec!["0:v:0", "1:a:0", "2:s:0"]
        );
    }

    #[test]
    fn mux_converts_subtitles_for_mp4() {
        let args = build_mux_args(
            "v.mp4",
            "a.m4a",
            "out.mp4",
            &[],
            &[],
            &[],
            Some("subs.srt"),
            &[],
        );
        assert!(args.windows(2).any(|w| w == ["-c", "copy"]));
        assert!(args.windows(2).any(|w| w == ["-c:s", "mov_text"]));
        assert!(args.windows(2).any(|w| w == ["-map", "2:s:0"]));
    }

    #[test]
    fn mux_without_subtitles_stays_copy_only() {
        let args = build_mux_args("v.mp4", "a.m4a", "out.mp4", &[], &[], &[], None, &[]);
        assert!(args.windows(2).any(|w| w == ["-c", "copy"]));
        assert!(!args.contains(&"-c:s".to_string()));
    }

    #[test]
    fn parse_time() {
        assert_eq!(parse_time_to_secs("00:01:23.45"), Some(83.45));
        assert_eq!(parse_time_to_secs("01:00:00"), Some(3600.0));
        assert_eq!(parse_time_to_secs("bad"), None);
    }

    #[test]
    fn parse_progress() {
        let line = "frame= 123 fps= 60 time=00:00:10.00 bitrate=1000kbits/s";
        assert_eq!(parse_progress_percent(line, Some(40.0)), Some(25.0));
        assert_eq!(parse_progress_percent(line, None), None);
        assert_eq!(parse_progress_percent(line, Some(0.0)), None);
    }

    #[test]
    fn progress_event_from_stderr_with_duration() {
        let line = "frame= 123 fps= 60 time=00:00:10.00 bitrate=1000kbits/s";
        let (percent, msg) = progress_event_from_stderr(line, Some(40.0)).unwrap();
        assert_eq!(percent, 25.0);
        assert_eq!(msg, line.trim());
    }

    #[test]
    fn progress_event_from_stderr_without_duration() {
        let line = "frame= 123 fps= 60 time=00:00:10.00 bitrate=1000kbits/s";
        let (percent, msg) = progress_event_from_stderr(line, None).unwrap();
        assert_eq!(percent, 0.0);
        assert_eq!(msg, line.trim());
    }

    #[test]
    fn progress_event_from_stderr_zero_duration() {
        let line = "frame= 123 fps= 60 time=00:00:10.00 bitrate=1000kbits/s";
        let (percent, _) = progress_event_from_stderr(line, Some(0.0)).unwrap();
        assert_eq!(percent, 0.0);
    }

    #[test]
    fn progress_event_from_stderr_no_time() {
        assert_eq!(progress_event_from_stderr("frame=1 fps=1", None), None);
    }

    #[test]
    fn parse_progress_percent_none_duration_stays_none() {
        let line = "frame= 123 fps= 60 time=00:00:10.00 bitrate=1000kbits/s";
        assert_eq!(parse_progress_percent(line, None), None);
        assert_eq!(parse_progress_percent(line, Some(0.0)), None);
    }

    #[test]
    fn video_filter_composes_with_scale() {
        let args = FFmpegCommandBuilder::new()
            .input("in.mkv")
            .scale(1280, -2)
            .video_filter("subtitles='/tmp/a.mkv':si=0")
            .output("out.mp4")
            .build();
        let vf = args
            .windows(2)
            .find(|w| w[0] == "-vf")
            .map(|w| w[1].as_str())
            .unwrap();
        assert_eq!(vf, "scale=1280:-2,subtitles='/tmp/a.mkv':si=0");
    }

    #[test]
    fn subtitle_ordinal_picks_absolute_then_first() {
        let streams = vec![(2, "ass".into()), (5, "subrip".into())];
        assert_eq!(
            subtitle_stream_ordinal(&streams, Some(5)),
            Some((1, "subrip".into()))
        );
        assert_eq!(
            subtitle_stream_ordinal(&streams, None),
            Some((0, "ass".into()))
        );
        assert_eq!(subtitle_stream_ordinal(&[], None), None);
    }

    #[test]
    fn burn_in_args_text_skips_hwaccel() {
        let burn = BurnTarget {
            path: "/tmp/in.mkv".into(),
            ordinal: 1,
            bitmap: false,
        };
        let args = build_transcode_args(
            "/tmp/in.mkv",
            "/tmp/out.mp4",
            "h264_videotoolbox",
            "aac",
            Some(23),
            Some("burn"),
            Some(&burn),
        );
        assert!(!args.contains(&"-hwaccel".to_string()));
        assert!(args.iter().any(|a| a.contains("subtitles=")));
        assert!(args.iter().any(|a| a.contains("si=1")));
        assert!(args.contains(&"-sn".to_string()));
        assert!(args.windows(2).any(|w| w == ["-map", "0:v?"]));
        assert!(!args.iter().any(|a| a.contains("0:s")));
    }

    fn stream(index: u32, codec_type: &str) -> crate::models::video_info::StreamInfo {
        crate::models::video_info::StreamInfo {
            index,
            codec_type: codec_type.into(),
            codec_name: "h264".into(),
            codec_long_name: None,
            width: Some(320),
            height: Some(240),
            rotation: None,
            r_frame_rate: None,
            avg_frame_rate: None,
            pix_fmt: None,
            sample_rate: None,
            channels: None,
            channel_layout: None,
            bit_rate: None,
            duration: None,
            language: None,
            title: None,
        }
    }

    fn video_info(streams: Vec<crate::models::video_info::StreamInfo>) -> VideoInfo {
        VideoInfo {
            format: crate::models::video_info::FormatInfo {
                filename: "t.mp4".into(),
                format_name: "mp4".into(),
                format_long_name: "MP4".into(),
                duration: Some(2.0),
                bit_rate: None,
                size: None,
            },
            streams,
        }
    }

    #[test]
    fn validate_extract_audio_rejects_video_only() {
        let info = video_info(vec![stream(0, "video")]);
        let err = validate_extract_audio(&info, None).unwrap_err();
        assert!(matches!(
            err,
            AppError::InvalidArgument(ref m) if m == "input has no audio stream"
        ));
    }

    #[test]
    fn validate_extract_audio_checks_absolute_index() {
        let info = video_info(vec![stream(0, "video"), stream(1, "audio")]);
        assert!(validate_extract_audio(&info, Some(1)).is_ok());
        let err = validate_extract_audio(&info, Some(0)).unwrap_err();
        assert!(matches!(
            err,
            AppError::InvalidArgument(ref m) if m == "stream 0 is not an audio track"
        ));
    }

    #[test]
    fn burn_in_args_bitmap_uses_overlay() {
        let burn = BurnTarget {
            path: "in.mkv".into(),
            ordinal: 0,
            bitmap: true,
        };
        let args = build_transcode_args(
            "in.mkv",
            "out.mkv",
            "libx264",
            "copy",
            Some(18),
            Some("burn"),
            Some(&burn),
        );
        assert!(args.windows(2).any(|w| {
            w[0] == "-filter_complex" && w[1] == "[0:v][0:s:0]overlay[vout]"
        }));
        assert!(args.windows(2).any(|w| w == ["-map", "[vout]"]));
    }

    #[test]
    fn burn_in_uses_external_subtitle_path() {
        let burn = BurnTarget {
            path: "/subs/en.srt".into(),
            ordinal: 0,
            bitmap: false,
        };
        let args = build_transcode_args(
            "/tmp/in.mkv",
            "/tmp/out.mp4",
            "libx264",
            "aac",
            Some(23),
            Some("burn"),
            Some(&burn),
        );
        let vf = args
            .windows(2)
            .find(|w| w[0] == "-vf")
            .map(|w| w[1].as_str())
            .unwrap();
        assert!(vf.contains("/subs/en.srt"));
        assert!(!vf.contains("/tmp/in.mkv"));
    }

    #[test]
    fn trim_copy_seeks_before_input() {
        let args = build_trim_args("in.mp4", "out.mp4", Some(10.0), Some(25.5), true).unwrap();
        assert_eq!(
            args,
            vec![
                "-y",
                "-hide_banner",
                "-ss",
                "10.000",
                "-to",
                "25.500",
                "-i",
                "in.mp4",
                "-c",
                "copy",
                "out.mp4",
            ]
        );
    }

    #[test]
    fn trim_reencode_seeks_after_input() {
        let args = build_trim_args("in.mp4", "out.mp4", Some(1.0), None, false).unwrap();
        let i = args.iter().position(|a| a == "-i").unwrap();
        let ss = args.iter().position(|a| a == "-ss").unwrap();
        assert!(ss > i);
        assert!(args.contains(&"libx264".to_string()));
    }

    #[test]
    fn trim_rejects_inverted_range() {
        assert!(build_trim_args("a", "b", Some(10.0), Some(10.0), true).is_err());
        assert!(build_trim_args("a", "b", None, None, true).is_err());
    }

    #[test]
    fn concat_list_quotes_paths() {
        let body = concat_list_contents(&[
            "/tmp/a.mp4".into(),
            "/tmp/it's.mp4".into(),
        ])
        .unwrap();
        assert_eq!(body, "file '/tmp/a.mp4'\nfile '/tmp/it'\\''s.mp4'\n");
        assert!(concat_list_contents(&["only-one".into()]).is_err());
    }

    #[test]
    fn concat_args_use_demuxer() {
        let args = build_concat_args("/tmp/list.txt", "out.mp4", true);
        assert!(args.windows(2).any(|w| w == ["-f", "concat"]));
        assert!(args.windows(2).any(|w| w == ["-safe", "0"]));
        assert!(args.windows(2).any(|w| w == ["-i", "/tmp/list.txt"]));
        assert!(args.contains(&"copy".to_string()));
    }

    #[test]
    fn transform_filter_combinations() {
        assert_eq!(build_transform_filter(90, false, false).unwrap(), "transpose=1");
        assert_eq!(
            build_transform_filter(180, true, false).unwrap(),
            "transpose=1,transpose=1,hflip"
        );
        assert_eq!(build_transform_filter(270, false, true).unwrap(), "transpose=2,vflip");
        assert!(build_transform_filter(0, false, false).is_err());
        assert!(build_transform_filter(45, false, false).is_err());
    }

    #[test]
    fn frame_export_seeks_then_one_frame() {
        let args = build_frame_args("in.mp4", "out.png", 12.5).unwrap();
        assert!(args.windows(2).any(|w| w == ["-ss", "12.500"]));
        assert!(args.windows(2).any(|w| w == ["-frames:v", "1"]));
        assert!(build_frame_args("in.mp4", "out.png", -1.0).is_err());
    }
}
