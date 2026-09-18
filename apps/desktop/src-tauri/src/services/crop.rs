use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::{FFmpegCommandBuilder, FFmpegService};
use crate::services::ffprobe::FFprobeService;

/// libx264 / yuv420p need even origins and sizes; FFmpeg otherwise shifts the crop.
pub fn snap_crop_even(width: u32, height: u32, x: u32, y: u32) -> (u32, u32, u32, u32) {
    let x = x & !1;
    let y = y & !1;
    let width = width.max(2) & !1;
    let height = height.max(2) & !1;
    (width, height, x, y)
}

pub fn validate_crop_rect(
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    src_w: u32,
    src_h: u32,
) -> Result<(), AppError> {
    if width == 0 || height == 0 {
        return Err(AppError::InvalidArgument(
            "width and height must be greater than zero".into(),
        ));
    }
    if x.saturating_add(width) > src_w || y.saturating_add(height) > src_h {
        return Err(AppError::InvalidArgument(format!(
            "crop {width}x{height}+{x}+{y} exceeds source {src_w}x{src_h}"
        )));
    }
    Ok(())
}

pub fn build_crop_args(
    input: &str,
    output: &str,
    width: u32,
    height: u32,
    x: u32,
    y: u32,
    video_codec: &str,
    crf: Option<u8>,
) -> Result<Vec<String>, AppError> {
    if width == 0 || height == 0 {
        return Err(AppError::InvalidArgument(
            "width and height must be greater than zero".into(),
        ));
    }
    Ok(FFmpegCommandBuilder::new()
        .input(input)
        .video_filter(&format!("crop={width}:{height}:{x}:{y}"))
        .video_codec(video_codec)
        .apply_video_quality(video_codec, crf.or(Some(23)))
        .audio_codec("copy")
        .output(output)
        .build())
}

pub struct CropService;

impl CropService {
    pub async fn crop(
        app: &AppHandle,
        input: &str,
        output: &str,
        width: u32,
        height: u32,
        x: u32,
        y: u32,
        video_codec: Option<&str>,
        crf: Option<u8>,
        duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = FFmpegService::resolve_duration(app, input, duration_secs).await;
        if let Ok(info) = FFprobeService::probe(app, input).await {
            if let Some(video) = info.streams.iter().find(|s| s.codec_type == "video") {
                if let Some((src_w, src_h)) = video.display_size() {
                    validate_crop_rect(width, height, x, y, src_w, src_h)?;
                }
            }
        }
        let (width, height, x, y) = snap_crop_even(width, height, x, y);
        let codec = video_codec.unwrap_or("libx264");
        let args = build_crop_args(input, output, width, height, x, y, codec, crf)?;
        FFmpegService::run(app, args, duration, job_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crop_args_include_filter_and_video_codec() {
        let args =
            build_crop_args("in.mp4", "out.mp4", 1280, 720, 10, 20, "libx264", Some(23)).unwrap();
        assert!(args.iter().any(|a| a == "crop=1280:720:10:20"));
        assert!(args.contains(&"-c:v".to_string()));
    }

    #[test]
    fn crop_rejects_zero_dimensions() {
        assert!(build_crop_args("in.mp4", "out.mp4", 0, 720, 0, 0, "libx264", None).is_err());
        assert!(build_crop_args("in.mp4", "out.mp4", 1280, 0, 0, 0, "libx264", None).is_err());
    }

    #[test]
    fn crop_rejects_rect_past_source() {
        assert!(validate_crop_rect(100, 100, 1900, 0, 1920, 1080).is_err());
        assert!(validate_crop_rect(1920, 1080, 0, 0, 1920, 1080).is_ok());
    }

    #[test]
    fn snap_crop_even_floors_to_pairs() {
        assert_eq!(snap_crop_even(641, 479, 3, 5), (640, 478, 2, 4));
    }
}
