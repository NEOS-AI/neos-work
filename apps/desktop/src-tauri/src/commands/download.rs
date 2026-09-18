use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;

use crate::models::error::AppError;
use crate::services::ffmpeg::ProgressPayload;
use crate::services::job::{resolve_job_id, JobRegistry};
use crate::services::sidecar::{output_ytdlp, resolve_ffmpeg_location, spawn_ytdlp};
use crate::services::ytdlp::{
    build_download_args, build_flat_playlist_args, build_probe_args, classify_youtube_url,
    output_template_for_dir, parse_destination_path, parse_flat_playlist, parse_url_lines,
    parse_ytdlp_percent_from_output, validate_youtube_video_url, watch_url_for_id, DownloadQuality,
    YoutubeUrlKind,
};

#[derive(Debug, Deserialize)]
pub struct ProbeDownloadOptions {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct DownloadInfo {
    pub id: String,
    pub title: String,
    pub duration_secs: Option<f64>,
    pub uploader: Option<String>,
    pub thumbnail: Option<String>,
    pub url: String,
}

#[derive(Debug, Deserialize)]
pub struct DownloadVideoOptions {
    pub url: String,
    pub output_dir: String,
    pub quality: String,
    pub job_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct YtdlpProbeJson {
    id: Option<String>,
    title: Option<String>,
    duration: Option<f64>,
    uploader: Option<String>,
    thumbnail: Option<String>,
    is_live: Option<bool>,
}

#[tauri::command(rename_all = "snake_case")]
pub async fn probe_download(
    app: AppHandle,
    options: ProbeDownloadOptions,
) -> Result<DownloadInfo, AppError> {
    let url = validate_youtube_video_url(&options.url)?;
    let args = build_probe_args(&url);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (ok, stdout, _) = output_ytdlp(&app, &arg_refs).await?;
    if !ok {
        return Err(AppError::Ytdlp(if stdout.trim().is_empty() {
            "yt-dlp probe failed".into()
        } else {
            stdout
        }));
    }
    let parsed: YtdlpProbeJson = serde_json::from_str(stdout.trim())
        .map_err(|e| AppError::Ytdlp(format!("could not parse yt-dlp metadata: {e}")))?;
    if parsed.is_live == Some(true) {
        return Err(AppError::InvalidArgument(
            "live streams are not supported".into(),
        ));
    }
    let id = parsed
        .id
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::Ytdlp("yt-dlp metadata is missing a video id".into()))?;
    Ok(DownloadInfo {
        id,
        title: parsed.title.unwrap_or_else(|| "YouTube video".into()),
        duration_secs: parsed.duration.filter(|d| *d > 0.0),
        uploader: parsed.uploader.filter(|s| !s.is_empty()),
        thumbnail: parsed.thumbnail.filter(|s| !s.is_empty()),
        url,
    })
}

#[derive(Debug, Deserialize)]
pub struct ProbeDownloadListOptions {
    pub url: String,
}

#[derive(Debug, Serialize)]
pub struct DownloadList {
    pub title: Option<String>,
    pub entries: Vec<DownloadInfo>,
}

#[derive(Debug, Serialize)]
pub struct ParsedDownloadLine {
    pub raw: String,
    pub kind: Option<String>,
    pub video_id: Option<String>,
    pub error: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn classify_download_url(url: String) -> Result<String, AppError> {
    match classify_youtube_url(&url)? {
        YoutubeUrlKind::Video => Ok("video".into()),
        YoutubeUrlKind::Playlist => Ok("playlist".into()),
    }
}

#[tauri::command(rename_all = "snake_case")]
pub fn parse_download_lines(text: String) -> Vec<ParsedDownloadLine> {
    parse_url_lines(&text)
        .into_iter()
        .map(|line| ParsedDownloadLine {
            raw: line.raw,
            kind: line.kind.map(|k| match k {
                YoutubeUrlKind::Video => "video".into(),
                YoutubeUrlKind::Playlist => "playlist".into(),
            }),
            video_id: line.video_id,
            error: line.error,
        })
        .collect()
}

#[tauri::command(rename_all = "snake_case")]
pub async fn probe_download_list(
    app: AppHandle,
    options: ProbeDownloadListOptions,
) -> Result<DownloadList, AppError> {
    let kind = classify_youtube_url(&options.url)?;
    if kind != YoutubeUrlKind::Playlist {
        return Err(AppError::InvalidArgument(
            "url is not a YouTube playlist".into(),
        ));
    }
    let args = build_flat_playlist_args(options.url.trim());
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let (ok, stdout, _) = output_ytdlp(&app, &arg_refs).await?;
    if !ok {
        return Err(AppError::Ytdlp(if stdout.trim().is_empty() {
            "yt-dlp playlist probe failed".into()
        } else {
            stdout
        }));
    }
    let (title, entries) = parse_flat_playlist(&stdout)?;
    Ok(DownloadList {
        title,
        entries: entries
            .into_iter()
            .map(|e| DownloadInfo {
                url: watch_url_for_id(&e.id),
                id: e.id,
                title: e.title,
                duration_secs: e.duration_secs,
                uploader: e.uploader,
                thumbnail: None,
            })
            .collect(),
    })
}

#[tauri::command(rename_all = "snake_case")]
pub async fn download_video(
    app: AppHandle,
    options: DownloadVideoOptions,
) -> Result<String, AppError> {
    if options.output_dir.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "output_dir must not be empty".into(),
        ));
    }
    let url = validate_youtube_video_url(&options.url)?;
    let quality = DownloadQuality::parse(&options.quality)?;
    let template = output_template_for_dir(&options.output_dir);
    let ffmpeg_loc = resolve_ffmpeg_location(&app);
    let args = build_download_args(&url, &template, quality, ffmpeg_loc.as_deref())?;
    run_ytdlp(&app, args, options.job_id.as_deref()).await
}

async fn run_ytdlp(
    app: &AppHandle,
    args: Vec<String>,
    job_id: Option<&str>,
) -> Result<String, AppError> {
    let job_id = resolve_job_id(job_id);
    let registry = app.state::<JobRegistry>();
    if registry.is_cancelled(&job_id) {
        let _ = registry.finish(&job_id);
        emit_progress(app, &job_id, 0.0, "Cancelled");
        return Err(AppError::Cancelled);
    }

    let spawned = spawn_ytdlp(app, &args)?;
    eprintln!("yt-dlp source={} job={}", spawned.source, job_id);
    let mut rx = spawned.rx;

    if let Err(err) = registry.register(&job_id, spawned.child) {
        let _ = registry.finish(&job_id);
        if matches!(err, AppError::Cancelled) {
            emit_progress(app, &job_id, 0.0, "Cancelled");
        }
        return Err(err);
    }

    let mut log_buf = String::new();
    let mut output_path: Option<String> = None;
    let mut term_code: Option<Option<i32>> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stderr(line) | CommandEvent::Stdout(line) => {
                let text = String::from_utf8_lossy(&line).to_string();
                log_buf.push_str(&text);
                log_buf.push('\n');
                if let Some(path) = parse_destination_path(&text) {
                    output_path = Some(path);
                }
                if let Some(percent) = parse_ytdlp_percent_from_output(&text) {
                    let message = text
                        .split(['\n', '\r'])
                        .rev()
                        .map(str::trim)
                        .find(|line| !line.is_empty())
                        .unwrap_or("")
                        .to_string();
                    emit_progress(app, &job_id, percent, message);
                } else if text.contains("Merging formats") {
                    emit_progress(app, &job_id, 100.0, text.trim());
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
            return Err(AppError::Ytdlp(log_buf));
        }
    }
    output_path.ok_or_else(|| {
        AppError::Ytdlp(format!(
            "yt-dlp finished but no output path was reported\n{log_buf}"
        ))
    })
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
