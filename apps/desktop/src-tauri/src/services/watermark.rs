use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::{FFmpegCommandBuilder, FFmpegService};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OverlayPosition {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
    Center,
}

impl OverlayPosition {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "tl" | "top-left" | "topleft" => Ok(Self::TopLeft),
            "tr" | "top-right" | "topright" => Ok(Self::TopRight),
            "bl" | "bottom-left" | "bottomleft" => Ok(Self::BottomLeft),
            "br" | "bottom-right" | "bottomright" => Ok(Self::BottomRight),
            "center" | "c" => Ok(Self::Center),
            _ => Err(AppError::InvalidArgument(
                "position must be tl, tr, bl, br, or center".into(),
            )),
        }
    }

    pub fn overlay_xy(self, margin: u32) -> (&'static str, &'static str) {
        let _ = margin;
        match self {
            Self::TopLeft => ("10", "10"),
            Self::TopRight => ("W-w-10", "10"),
            Self::BottomLeft => ("10", "H-h-10"),
            Self::BottomRight => ("W-w-10", "H-h-10"),
            Self::Center => ("(W-w)/2", "(H-h)/2"),
        }
    }

    pub fn drawtext_xy(self) -> (&'static str, &'static str) {
        match self {
            Self::TopLeft => ("10", "10"),
            Self::TopRight => ("w-tw-10", "10"),
            Self::BottomLeft => ("10", "h-th-10"),
            Self::BottomRight => ("w-tw-10", "h-th-10"),
            Self::Center => ("(w-tw)/2", "(h-th)/2"),
        }
    }
}

pub fn escape_drawtext(text: &str) -> String {
    text.replace('\\', r"\\")
        .replace(':', r"\:")
        .replace('\'', r"\'")
        .replace('%', r"\%")
}

pub fn default_font_path() -> Option<&'static str> {
    #[cfg(target_os = "macos")]
    {
        const CANDIDATES: &[&str] = &[
            "/System/Library/Fonts/Supplemental/Arial.ttf",
            "/System/Library/Fonts/Helvetica.ttc",
            "/Library/Fonts/Arial.ttf",
        ];
        CANDIDATES.iter().copied().find(|p| std::path::Path::new(p).exists())
    }
    #[cfg(target_os = "windows")]
    {
        const CANDIDATES: &[&str] = &[r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\segoeui.ttf"];
        CANDIDATES.iter().copied().find(|p| std::path::Path::new(p).exists())
    }
    #[cfg(target_os = "linux")]
    {
        const CANDIDATES: &[&str] = &[
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/freefont/FreeSans.ttf",
        ];
        CANDIDATES.iter().copied().find(|p| std::path::Path::new(p).exists())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

pub fn build_image_overlay_filter(position: OverlayPosition) -> String {
    let (x, y) = position.overlay_xy(10);
    format!("overlay={x}:{y}")
}

pub fn build_drawtext_filter(
    text: &str,
    position: OverlayPosition,
    font_path: &str,
    font_size: u32,
) -> Result<String, AppError> {
    if text.is_empty() {
        return Err(AppError::InvalidArgument("watermark text must not be empty".into()));
    }
    if font_size == 0 {
        return Err(AppError::InvalidArgument("font_size must be greater than 0".into()));
    }
    let (x, y) = position.drawtext_xy();
    Ok(format!(
        "drawtext=fontfile={}:text='{}':x={}:y={}:fontsize={}:fontcolor=white:borderw=2:bordercolor=black",
        crate::services::encoders::escape_filter_path(font_path),
        escape_drawtext(text),
        x,
        y,
        font_size
    ))
}

pub fn build_image_watermark_args(
    input: &str,
    image: &str,
    output: &str,
    position: OverlayPosition,
    video_codec: &str,
    crf: Option<u8>,
) -> Vec<String> {
    FFmpegCommandBuilder::new()
        .input(input)
        .input(image)
        .filter_complex(&format!(
            "[0:v][1:v]{}[v]",
            build_image_overlay_filter(position)
        ))
        .map("[v]")
        .map("0:a?")
        .video_codec(video_codec)
        .apply_video_quality(video_codec, crf.or(Some(23)))
        .audio_codec("copy")
        .output(output)
        .build()
}

pub fn build_text_watermark_args(
    input: &str,
    output: &str,
    text: &str,
    position: OverlayPosition,
    font_path: &str,
    font_size: u32,
    video_codec: &str,
    crf: Option<u8>,
) -> Result<Vec<String>, AppError> {
    let filter = build_drawtext_filter(text, position, font_path, font_size)?;
    Ok(FFmpegCommandBuilder::new()
        .input(input)
        .video_filter(&filter)
        .video_codec(video_codec)
        .apply_video_quality(video_codec, crf.or(Some(23)))
        .audio_codec("copy")
        .output(output)
        .build())
}

pub struct WatermarkService;

impl WatermarkService {
    pub async fn apply_image(
        app: &AppHandle,
        input: &str,
        image: &str,
        output: &str,
        position: &str,
        video_codec: Option<&str>,
        crf: Option<u8>,
        duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let pos = OverlayPosition::parse(position)?;
        let duration = FFmpegService::resolve_duration(app, input, duration_secs).await;
        let codec = video_codec.unwrap_or("libx264");
        let args = build_image_watermark_args(input, image, output, pos, codec, crf);
        FFmpegService::run(app, args, duration, job_id).await
    }

    pub async fn apply_text(
        app: &AppHandle,
        input: &str,
        output: &str,
        text: &str,
        position: &str,
        font_path: Option<&str>,
        font_size: u32,
        video_codec: Option<&str>,
        crf: Option<u8>,
        duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let pos = OverlayPosition::parse(position)?;
        let font = font_path
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .or_else(|| default_font_path().map(|s| s.to_string()))
            .ok_or_else(|| {
                AppError::InvalidArgument(
                    "no font file found; pass font_path for drawtext".into(),
                )
            })?;
        let duration = FFmpegService::resolve_duration(app, input, duration_secs).await;
        let codec = video_codec.unwrap_or("libx264");
        let args = build_text_watermark_args(input, output, text, pos, &font, font_size, codec, crf)?;
        FFmpegService::run(app, args, duration, job_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_parse_and_overlay() {
        assert_eq!(OverlayPosition::parse("br").unwrap(), OverlayPosition::BottomRight);
        let (x, y) = OverlayPosition::BottomRight.overlay_xy(10);
        assert_eq!((x, y), ("W-w-10", "H-h-10"));
        assert!(OverlayPosition::parse("north").is_err());
    }

    #[test]
    fn drawtext_escapes_colon() {
        let filter = build_drawtext_filter("Hi:there", OverlayPosition::TopLeft, "/tmp/a.ttf", 24)
            .unwrap();
        assert!(filter.contains("text='Hi\\:there'"));
        assert!(filter.contains("fontsize=24"));
    }

    #[test]
    fn image_args_have_two_inputs_and_overlay() {
        let args = build_image_watermark_args(
            "in.mp4",
            "logo.png",
            "out.mp4",
            OverlayPosition::TopRight,
            "libx264",
            Some(23),
        );
        assert_eq!(args.iter().filter(|a| *a == "-i").count(), 2);
        assert!(args.iter().any(|a| a.contains("overlay=W-w-10:10")));
    }
}
