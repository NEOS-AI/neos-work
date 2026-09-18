use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::{FFmpegCommandBuilder, FFmpegService};

/// Video fade filter. `out_start` is when the fade-out begins (seconds).
pub fn build_fade_vf(in_secs: f64, out_secs: f64, out_start: Option<f64>) -> Result<String, AppError> {
    validate_durs(in_secs, out_secs)?;
    let mut parts = Vec::new();
    if in_secs > 0.0 {
        parts.push(format!("fade=t=in:st=0:d={in_secs}"));
    }
    if out_secs > 0.0 {
        let start = out_start.ok_or_else(|| {
            AppError::InvalidArgument(
                "fade-out needs the source duration (could not probe the file)".into(),
            )
        })?;
        if start < 0.0 {
            return Err(AppError::InvalidArgument(
                "fade-out is longer than the source duration".into(),
            ));
        }
        parts.push(format!("fade=t=out:st={start}:d={out_secs}"));
    }
    if parts.is_empty() {
        return Err(AppError::InvalidArgument(
            "set fade_in_secs and/or fade_out_secs greater than 0".into(),
        ));
    }
    Ok(parts.join(","))
}

pub fn build_fade_af(in_secs: f64, out_secs: f64, out_start: Option<f64>) -> Result<String, AppError> {
    validate_durs(in_secs, out_secs)?;
    let mut parts = Vec::new();
    if in_secs > 0.0 {
        parts.push(format!("afade=t=in:st=0:d={in_secs}"));
    }
    if out_secs > 0.0 {
        let start = out_start.unwrap_or(0.0);
        parts.push(format!("afade=t=out:st={start}:d={out_secs}"));
    }
    if parts.is_empty() {
        return Err(AppError::InvalidArgument(
            "set fade_in_secs and/or fade_out_secs greater than 0".into(),
        ));
    }
    Ok(parts.join(","))
}

fn validate_durs(in_secs: f64, out_secs: f64) -> Result<(), AppError> {
    if !in_secs.is_finite() || !out_secs.is_finite() || in_secs < 0.0 || out_secs < 0.0 {
        return Err(AppError::InvalidArgument(
            "fade durations must be finite and non-negative".into(),
        ));
    }
    Ok(())
}

pub fn fade_out_start(duration: f64, out_secs: f64) -> Option<f64> {
    if out_secs <= 0.0 {
        return None;
    }
    let start = duration - out_secs;
    if start < 0.0 {
        None
    } else {
        Some(start)
    }
}

pub fn build_fade_args(
    input: &str,
    output: &str,
    in_secs: f64,
    out_secs: f64,
    out_start: Option<f64>,
    include_audio: bool,
    video_codec: &str,
    crf: Option<u8>,
) -> Result<Vec<String>, AppError> {
    let vf = build_fade_vf(in_secs, out_secs, out_start)?;
    let mut builder = FFmpegCommandBuilder::new()
        .input(input)
        .video_filter(&vf)
        .video_codec(video_codec)
        .apply_video_quality(video_codec, crf.or(Some(23)));
    if include_audio {
        builder = builder
            .arg_pair("-af", &build_fade_af(in_secs, out_secs, out_start)?)
            .audio_codec("aac");
    } else {
        builder = builder.audio_codec("copy");
    }
    Ok(builder.output(output).build())
}

pub struct FadeService;

impl FadeService {
    pub async fn apply(
        app: &AppHandle,
        input: &str,
        output: &str,
        fade_in_secs: f64,
        fade_out_secs: f64,
        include_audio: bool,
        video_codec: Option<&str>,
        crf: Option<u8>,
        duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = FFmpegService::resolve_duration(app, input, duration_secs).await;
        let out_start = if fade_out_secs > 0.0 {
            let total = duration.ok_or_else(|| {
                AppError::InvalidArgument(
                    "fade-out needs the source duration (could not probe the file)".into(),
                )
            })?;
            Some(fade_out_start(total, fade_out_secs).ok_or_else(|| {
                AppError::InvalidArgument("fade-out is longer than the source duration".into())
            })?)
        } else {
            None
        };
        let codec = video_codec.unwrap_or("libx264");
        let args = build_fade_args(
            input,
            output,
            fade_in_secs,
            fade_out_secs,
            out_start,
            include_audio,
            codec,
            crf,
        )?;
        FFmpegService::run(app, args, duration, job_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fade_in_only() {
        let vf = build_fade_vf(1.5, 0.0, None).unwrap();
        assert_eq!(vf, "fade=t=in:st=0:d=1.5");
    }

    #[test]
    fn fade_in_and_out() {
        let vf = build_fade_vf(1.0, 2.0, Some(8.0)).unwrap();
        assert_eq!(vf, "fade=t=in:st=0:d=1,fade=t=out:st=8:d=2");
        let af = build_fade_af(1.0, 2.0, Some(8.0)).unwrap();
        assert!(af.contains("afade=t=in"));
        assert!(af.contains("afade=t=out:st=8"));
    }

    #[test]
    fn fade_out_start_math() {
        assert_eq!(fade_out_start(10.0, 2.0), Some(8.0));
        assert_eq!(fade_out_start(1.0, 2.0), None);
    }

    #[test]
    fn rejects_both_zero() {
        assert!(build_fade_vf(0.0, 0.0, None).is_err());
    }

    #[test]
    fn args_include_vf() {
        let args =
            build_fade_args("in.mp4", "out.mp4", 1.0, 0.0, None, true, "libx264", Some(23))
                .unwrap();
        assert!(args.iter().any(|a| a.contains("fade=t=in")));
        assert!(args.windows(2).any(|w| w[0] == "-af" && w[1].contains("afade")));
    }
}
