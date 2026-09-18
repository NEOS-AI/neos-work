use std::collections::HashMap;

use serde::Deserialize;
use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegService;
use crate::services::ffprobe::FFprobeService;
use crate::services::timeline::{
    build_timeline_args, build_timeline_args_with_audio, validate, RenderProfile, TimelineProject,
    TimelineValidation,
};

#[derive(Debug, Deserialize)]
pub struct ExportTimelineOptions {
    pub project: TimelineProject,
    pub output_path: String,
    pub profile: Option<RenderProfile>,
    pub job_id: Option<String>,
}

#[tauri::command(rename_all = "snake_case")]
pub fn validate_timeline(project: TimelineProject) -> Result<TimelineValidation, AppError> {
    validate(&project)
}

#[tauri::command(rename_all = "snake_case")]
pub async fn export_timeline(
    app: AppHandle,
    options: ExportTimelineOptions,
) -> Result<(), AppError> {
    let (args, duration) = prepare_export(&app, &options, RenderProfile::export).await?;
    FFmpegService::run(&app, args, Some(duration), options.job_id.as_deref()).await
}

#[tauri::command(rename_all = "snake_case")]
pub async fn render_timeline_proxy(
    app: AppHandle,
    options: ExportTimelineOptions,
) -> Result<(), AppError> {
    let (args, duration) = prepare_export(&app, &options, RenderProfile::proxy).await?;
    FFmpegService::run(&app, args, Some(duration), options.job_id.as_deref()).await
}

#[tauri::command(rename_all = "snake_case")]
pub fn read_text_file(path: String) -> Result<String, AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidArgument("path must not be empty".into()));
    }
    Ok(std::fs::read_to_string(path)?)
}

#[tauri::command(rename_all = "snake_case")]
pub fn write_text_file(path: String, contents: String) -> Result<(), AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidArgument("path must not be empty".into()));
    }
    std::fs::write(path, contents)?;
    Ok(())
}

#[tauri::command(rename_all = "snake_case")]
pub fn remove_file(path: String) -> Result<(), AppError> {
    if path.is_empty() {
        return Err(AppError::InvalidArgument("path must not be empty".into()));
    }
    std::fs::remove_file(path)?;
    Ok(())
}

/// Validate options, probe unique sources for audio, and build ffmpeg args (no spawn).
async fn prepare_export(
    app: &AppHandle,
    options: &ExportTimelineOptions,
    default_profile: fn(&TimelineProject) -> RenderProfile,
) -> Result<(Vec<String>, f64), AppError> {
    if options.output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "output_path must not be empty".into(),
        ));
    }
    validate(&options.project)?;
    let has_audio = probe_source_audio(app, &options.project).await?;
    prepare_export_with_audio(options, &has_audio, default_profile)
}

/// Sync compile path used by unit tests (no AppHandle / no probe).
fn prepare_export_with_audio(
    options: &ExportTimelineOptions,
    has_audio: &HashMap<String, bool>,
    default_profile: fn(&TimelineProject) -> RenderProfile,
) -> Result<(Vec<String>, f64), AppError> {
    if options.output_path.is_empty() {
        return Err(AppError::InvalidArgument(
            "output_path must not be empty".into(),
        ));
    }
    validate(&options.project)?;
    let profile = options
        .profile
        .clone()
        .unwrap_or_else(|| default_profile(&options.project));
    let args = if has_audio.is_empty() {
        build_timeline_args(&options.project, &options.output_path, &profile)?
    } else {
        build_timeline_args_with_audio(&options.project, &options.output_path, &profile, has_audio)?
    };
    let duration = options.project.duration_secs();
    Ok((args, duration))
}

/// Probe each unique source path once. Missing files surface as FFprobe errors.
async fn probe_source_audio(
    app: &AppHandle,
    project: &TimelineProject,
) -> Result<HashMap<String, bool>, AppError> {
    let mut map = HashMap::new();
    for track in &project.tracks {
        if track.muted {
            continue;
        }
        for clip in &track.clips {
            if map.contains_key(&clip.source_path) {
                continue;
            }
            let info = FFprobeService::probe(app, &clip.source_path).await?;
            let has = info.streams.iter().any(|s| s.codec_type == "audio");
            map.insert(clip.source_path.clone(), has);
        }
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use crate::services::timeline::{TimelineClip, TimelineTrack, TrackKind, TIMELINE_VERSION};

    fn sample_project() -> TimelineProject {
        TimelineProject {
            version: TIMELINE_VERSION,
            name: "t".into(),
            fps: 30.0,
            width: 1280,
            height: 720,
            sample_rate: 48000,
            tracks: vec![TimelineTrack {
                id: "v1".into(),
                kind: TrackKind::Video,
                name: "V1".into(),
                muted: false,
                clips: vec![TimelineClip {
                    id: "c1".into(),
                    source_path: "/tmp/a.mp4".into(),
                    source_in: 0.0,
                    source_out: 2.0,
                    timeline_start: 0.0,
                    effects: vec![],
                }],
            }],
        }
    }

    #[test]
    fn export_rejects_empty_output_path() {
        let options = ExportTimelineOptions {
            project: sample_project(),
            output_path: String::new(),
            profile: None,
            job_id: None,
        };
        let err =
            prepare_export_with_audio(&options, &HashMap::new(), RenderProfile::export).unwrap_err();
        match err {
            AppError::InvalidArgument(msg) => {
                assert_eq!(msg, "output_path must not be empty");
            }
            other => panic!("expected InvalidArgument, got {other:?}"),
        }
    }

    #[test]
    fn prepare_export_builds_args() {
        let project = sample_project();
        let options = ExportTimelineOptions {
            project: project.clone(),
            output_path: "/tmp/out.mp4".into(),
            profile: None,
            job_id: None,
        };
        let (args, duration) =
            prepare_export_with_audio(&options, &HashMap::new(), RenderProfile::export).unwrap();
        assert_eq!(duration, 2.0);
        assert!(args.iter().any(|a| a == "/tmp/out.mp4"));
        assert!(args.iter().any(|a| a == "-filter_complex"));
        // Export default: project size, medium, crf 23
        let joined = args.join(" ");
        assert!(joined.contains("1280") || joined.contains("720"));
        assert!(args.iter().any(|a| a == "medium"));
        assert!(args.iter().any(|a| a == "23"));
    }

    #[test]
    fn prepare_proxy_default_profile_args() {
        let project = sample_project();
        let options = ExportTimelineOptions {
            project: project.clone(),
            output_path: "/tmp/proxy.mp4".into(),
            profile: None,
            job_id: None,
        };
        let (args, duration) =
            prepare_export_with_audio(&options, &HashMap::new(), RenderProfile::proxy).unwrap();
        assert_eq!(duration, 2.0);
        let joined = args.join(" ");
        assert!(
            joined.contains("640"),
            "proxy default should scale to 640-wide: {joined}"
        );
        assert!(
            args.iter().any(|a| a == "ultrafast"),
            "proxy default preset ultrafast: {args:?}"
        );
        assert!(
            args.iter().any(|a| a == "28"),
            "proxy default crf 28: {args:?}"
        );
        assert!(
            !args.iter().any(|a| a == "medium"),
            "proxy must not use export preset medium"
        );
        assert!(
            !args.iter().any(|a| a == "23"),
            "proxy must not use export crf 23"
        );
    }
}
