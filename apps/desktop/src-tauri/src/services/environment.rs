use tauri::AppHandle;

use crate::models::environment::EnvironmentInfo;
use crate::models::error::AppError;
use crate::services::encoders::{parse_hw_accels, parse_hw_encoders, parse_version_line};
use crate::services::sidecar::{output_ffmpeg, output_ffprobe, output_ytdlp};
use crate::utils::binary::{
    current_arch, current_os, current_target_triple, sidecar_filename,
};

pub struct EnvironmentService;

impl EnvironmentService {
    pub async fn check(app: &AppHandle) -> Result<EnvironmentInfo, AppError> {
        let (ffmpeg_ok, ffmpeg_out, ffmpeg_source) =
            match output_ffmpeg(app, &["-version"]).await {
                Ok((ok, stdout, source)) => (ok, stdout, Some(source)),
                Err(_) => (false, String::new(), None),
            };
        let (ffprobe_ok, ffprobe_out, ffprobe_source) =
            match output_ffprobe(app, &["-version"]).await {
                Ok((ok, stdout, source)) => (ok, stdout, Some(source)),
                Err(_) => (false, String::new(), None),
            };
        let (ytdlp_ok, ytdlp_out, ytdlp_source) = match output_ytdlp(app, &["--version"]).await {
            Ok((ok, stdout, source)) => (ok, stdout, Some(source)),
            Err(_) => (false, String::new(), None),
        };

        let mut hw_encoders = Vec::new();
        let mut hw_accels = Vec::new();
        if ffmpeg_ok {
            if let Ok((ok, out, _)) = output_ffmpeg(app, &["-hide_banner", "-encoders"]).await {
                if ok {
                    hw_encoders = parse_hw_encoders(&out);
                }
            }
            if let Ok((ok, out, _)) = output_ffmpeg(app, &["-hide_banner", "-hwaccels"]).await {
                if ok {
                    hw_accels = parse_hw_accels(&out);
                }
            }
        }

        Ok(EnvironmentInfo {
            os: current_os().to_string(),
            arch: current_arch().to_string(),
            target_triple: current_target_triple().to_string(),
            ffmpeg_ok,
            ffprobe_ok,
            ffmpeg_version: parse_version_line(&ffmpeg_out),
            ffprobe_version: parse_version_line(&ffprobe_out),
            ffmpeg_source,
            ffprobe_source,
            ffmpeg_sidecar: sidecar_filename("ffmpeg"),
            ffprobe_sidecar: sidecar_filename("ffprobe"),
            ytdlp_ok,
            ytdlp_version: parse_version_line(&ytdlp_out),
            ytdlp_source,
            ytdlp_sidecar: sidecar_filename("yt-dlp"),
            hw_encoders,
            hw_accels,
        })
    }
}
