use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::{FFmpegCommandBuilder, FFmpegService};

/// Palette-based GIF filtergraph: fps → scale → palettegen/paletteuse.
pub fn build_gif_filter(fps: u32, width: u32) -> Result<String, AppError> {
    if fps == 0 {
        return Err(AppError::InvalidArgument(
            "fps must be greater than 0".into(),
        ));
    }
    if width == 0 {
        return Err(AppError::InvalidArgument(
            "width must be greater than 0".into(),
        ));
    }
    Ok(format!(
        "fps={fps},scale={width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
    ))
}

/// Build ffmpeg args for a GIF export. Seek flags (`-ss` / `-to`) go before `-i`
/// when present, matching stream-copy trim. Omitted bounds convert from the
/// source start and/or through the source end.
pub fn build_gif_args(
    input: &str,
    output: &str,
    start: Option<f64>,
    end: Option<f64>,
    fps: u32,
    width: u32,
) -> Result<Vec<String>, AppError> {
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

    let filter = build_gif_filter(fps, width)?;
    let mut builder = FFmpegCommandBuilder::new();
    if let Some(s) = start {
        builder = builder.seek_start(s);
    }
    if let Some(e) = end {
        builder = builder.seek_end(e);
    }
    Ok(builder
        .input(input)
        .filter_complex(&filter)
        .output(output)
        .build())
}

pub struct GifService;

impl GifService {
    /// Export `[start_secs, end_secs)` of `input` as an animated GIF.
    /// Omitted bounds mean the source start/end. Progress duration is the clip
    /// length (`end - start`) or the remaining source duration.
    pub async fn export(
        app: &AppHandle,
        input: &str,
        output: &str,
        start_secs: Option<f64>,
        end_secs: Option<f64>,
        fps: u32,
        width: u32,
        total_duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let source_duration = FFmpegService::resolve_duration(app, input, total_duration_secs).await;
        let clip = match (start_secs, end_secs, source_duration) {
            (Some(s), Some(e), _) => Some(e - s),
            (Some(s), None, Some(total)) => Some((total - s).max(0.0)),
            (None, Some(e), _) => Some(e),
            _ => source_duration,
        };
        let args = build_gif_args(input, output, start_secs, end_secs, fps, width)?;
        FFmpegService::run(app, args, clip, job_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filter_contains_palette_graph() {
        let filter = build_gif_filter(10, 480).unwrap();
        assert!(filter.contains("fps="));
        assert!(filter.contains("scale="));
        assert!(filter.contains("palettegen"));
        assert!(filter.contains("paletteuse"));
        assert_eq!(
            filter,
            "fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse"
        );
    }

    #[test]
    fn rejects_zero_fps_or_width() {
        assert!(build_gif_filter(0, 480).is_err());
        assert!(build_gif_filter(10, 0).is_err());
        assert!(build_gif_args("in.mp4", "out.gif", None, None, 0, 480).is_err());
        assert!(build_gif_args("in.mp4", "out.gif", None, None, 10, 0).is_err());
    }

    #[test]
    fn rejects_inverted_or_negative_range() {
        assert!(build_gif_args("in.mp4", "out.gif", Some(10.0), Some(10.0), 10, 480).is_err());
        assert!(build_gif_args("in.mp4", "out.gif", Some(20.0), Some(5.0), 10, 480).is_err());
        assert!(build_gif_args("in.mp4", "out.gif", Some(-1.0), None, 10, 480).is_err());
        assert!(build_gif_args("in.mp4", "out.gif", None, Some(-0.5), 10, 480).is_err());
    }

    #[test]
    fn seek_flags_precede_input_when_range_set() {
        let args = build_gif_args("in.mp4", "out.gif", Some(2.5), Some(8.0), 12, 320).unwrap();
        assert_eq!(
            args,
            vec![
                "-y",
                "-hide_banner",
                "-ss",
                "2.500",
                "-to",
                "8.000",
                "-i",
                "in.mp4",
                "-filter_complex",
                "fps=12,scale=320:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
                "out.gif",
            ]
        );
        let i = args.iter().position(|a| a == "-i").unwrap();
        let ss = args.iter().position(|a| a == "-ss").unwrap();
        let to = args.iter().position(|a| a == "-to").unwrap();
        assert!(ss < i);
        assert!(to < i);
        assert!(!args.contains(&"-vf".to_string()));
    }

    #[test]
    fn omits_absent_seek_flags() {
        let start_only = build_gif_args("in.mp4", "out.gif", Some(1.0), None, 10, 480).unwrap();
        assert!(start_only.windows(2).any(|w| w == ["-ss", "1.000"]));
        assert!(!start_only.contains(&"-to".to_string()));

        let end_only = build_gif_args("in.mp4", "out.gif", None, Some(5.0), 10, 480).unwrap();
        assert!(!end_only.contains(&"-ss".to_string()));
        assert!(end_only.windows(2).any(|w| w == ["-to", "5.000"]));

        let whole = build_gif_args("in.mp4", "out.gif", None, None, 10, 480).unwrap();
        assert!(!whole.contains(&"-ss".to_string()));
        assert!(!whole.contains(&"-to".to_string()));
        assert_eq!(whole.iter().position(|a| a == "-i").unwrap(), 2);
    }
}
