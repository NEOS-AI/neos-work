use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::{FFmpegCommandBuilder, FFmpegService};

/// Split `rate` into FFmpeg `atempo` factors in `[0.5, 2.0]`.
///
/// FFmpeg rejects a single `atempo` outside that range, so values such as
/// `4.0` become `atempo=2,atempo=2` and `0.25` becomes `atempo=0.5,atempo=0.5`.
pub fn atempo_chain(rate: f64) -> Result<String, AppError> {
    validate_rate(rate)?;

    let mut factors: Vec<f64> = Vec::new();
    let mut remaining = rate;

    while remaining > 2.0 {
        factors.push(2.0);
        remaining /= 2.0;
    }
    while remaining < 0.5 {
        factors.push(0.5);
        remaining *= 2.0;
    }
    factors.push(remaining);

    Ok(factors
        .into_iter()
        .map(|f| format!("atempo={}", format_rate(f)))
        .collect::<Vec<_>>()
        .join(","))
}

/// Build a `filter_complex` graph that changes playback speed.
///
/// Video uses `setpts=PTS/{rate}`. Audio (when requested) uses `atempo_chain`.
pub fn build_speed_filter(rate: f64, has_audio: bool) -> Result<String, AppError> {
    validate_rate(rate)?;
    let video = format!("[0:v]setpts=PTS/{}[v]", format_rate(rate));
    if has_audio {
        Ok(format!("{video};[0:a]{}[a]", atempo_chain(rate)?))
    } else {
        Ok(video)
    }
}

/// Build ffmpeg args that re-encode `input` at `rate` into `output`.
pub fn build_speed_args(
    input: &str,
    output: &str,
    rate: f64,
    has_audio: bool,
    video_codec: Option<&str>,
    crf: Option<u8>,
) -> Result<Vec<String>, AppError> {
    let filter = build_speed_filter(rate, has_audio)?;
    let codec = video_codec
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .unwrap_or("libx264");

    let mut builder = FFmpegCommandBuilder::new()
        .input(input)
        .filter_complex(&filter)
        .map("[v]");
    if has_audio {
        builder = builder.map("[a]");
    }
    builder = builder
        .video_codec(codec)
        .apply_video_quality(codec, crf.or(Some(23)));
    if has_audio {
        builder = builder.audio_codec("aac");
    }
    Ok(builder.output(output).build())
}

pub struct SpeedService;

impl SpeedService {
    /// Re-encode `input` so it plays at `rate` times the original speed.
    ///
    /// Progress is reported against `source_duration / rate` when the source
    /// duration is known, matching the shortened (or lengthened) output.
    pub async fn change(
        app: &AppHandle,
        input: &str,
        output: &str,
        rate: f64,
        has_audio: bool,
        video_codec: Option<&str>,
        crf: Option<u8>,
        duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let args = build_speed_args(input, output, rate, has_audio, video_codec, crf)?;
        let source_duration = FFmpegService::resolve_duration(app, input, duration_secs).await;
        let progress_duration = source_duration.filter(|d| *d > 0.0).map(|d| d / rate);
        FFmpegService::run(app, args, progress_duration, job_id).await
    }
}

fn validate_rate(rate: f64) -> Result<(), AppError> {
    if !rate.is_finite() || !(0.125..=8.0).contains(&rate) {
        return Err(AppError::InvalidArgument(
            "rate must be between 0.125 and 8".into(),
        ));
    }
    Ok(())
}

fn format_rate(rate: f64) -> String {
    let rounded = (rate * 1_000_000.0).round() / 1_000_000.0;
    format!("{rounded}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atempo_chain_two_is_single_factor() {
        assert_eq!(atempo_chain(2.0).unwrap(), "atempo=2");
    }

    #[test]
    fn atempo_chain_four_uses_two_doubles() {
        let chain = atempo_chain(4.0).unwrap();
        assert_eq!(chain.matches("atempo=2").count(), 2);
        assert_eq!(chain, "atempo=2,atempo=2");
    }

    #[test]
    fn atempo_chain_quarter_uses_two_halves() {
        let chain = atempo_chain(0.25).unwrap();
        assert_eq!(chain.matches("atempo=0.5").count(), 2);
        assert_eq!(chain, "atempo=0.5,atempo=0.5");
    }

    #[test]
    fn atempo_chain_zero_errors() {
        assert!(atempo_chain(0.0).is_err());
    }

    #[test]
    fn atempo_chain_rejects_out_of_range() {
        assert!(atempo_chain(-1.0).is_err());
        assert!(atempo_chain(0.1).is_err());
        assert!(atempo_chain(8.1).is_err());
        assert!(atempo_chain(f64::NAN).is_err());
        assert!(atempo_chain(f64::INFINITY).is_err());
        assert_eq!(atempo_chain(1.5).unwrap(), "atempo=1.5");
        assert_eq!(atempo_chain(8.0).unwrap(), "atempo=2,atempo=2,atempo=2");
        assert_eq!(
            atempo_chain(0.125).unwrap(),
            "atempo=0.5,atempo=0.5,atempo=0.5"
        );
        assert_eq!(atempo_chain(3.0).unwrap(), "atempo=2,atempo=1.5");
    }

    #[test]
    fn build_speed_filter_with_and_without_audio() {
        assert_eq!(
            build_speed_filter(2.0, true).unwrap(),
            "[0:v]setpts=PTS/2[v];[0:a]atempo=2[a]"
        );
        assert_eq!(
            build_speed_filter(2.0, false).unwrap(),
            "[0:v]setpts=PTS/2[v]"
        );
        assert_eq!(
            build_speed_filter(4.0, true).unwrap(),
            "[0:v]setpts=PTS/4[v];[0:a]atempo=2,atempo=2[a]"
        );
    }

    #[test]
    fn build_speed_args_includes_filter_complex_and_setpts() {
        let args = build_speed_args("in.mp4", "out.mp4", 2.0, true, None, None).unwrap();
        assert!(args.contains(&"-filter_complex".to_string()));
        assert!(args.iter().any(|a| a.contains("setpts")));
        assert!(args.windows(2).any(|w| {
            w[0] == "-filter_complex" && w[1] == "[0:v]setpts=PTS/2[v];[0:a]atempo=2[a]"
        }));
        assert!(args.windows(2).any(|w| w == ["-map", "[v]"]));
        assert!(args.windows(2).any(|w| w == ["-map", "[a]"]));
        assert!(args.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(args.windows(2).any(|w| w == ["-c:a", "aac"]));
        assert!(args.windows(2).any(|w| w == ["-crf", "23"]));
        assert_eq!(args.last().map(String::as_str), Some("out.mp4"));
    }

    #[test]
    fn build_speed_args_video_only_omits_audio_map() {
        let args =
            build_speed_args("in.mp4", "out.mp4", 1.5, false, Some("libx264"), Some(18)).unwrap();
        assert!(args.contains(&"-filter_complex".to_string()));
        assert!(args.iter().any(|a| a.contains("setpts=PTS/1.5")));
        assert!(args.windows(2).any(|w| w == ["-map", "[v]"]));
        assert!(!args.iter().any(|a| a == "[a]"));
        assert!(!args.contains(&"-c:a".to_string()));
        assert!(args.windows(2).any(|w| w == ["-crf", "18"]));
    }
}
