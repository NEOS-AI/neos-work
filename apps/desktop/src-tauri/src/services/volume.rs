use tauri::AppHandle;

use crate::models::error::AppError;
use crate::services::ffmpeg::{FFmpegCommandBuilder, FFmpegService};

/// Build `-af` for a dB gain (`volume=3dB`) or EBU R128 `loudnorm`.
pub fn build_volume_filter(normalize: bool, gain_db: f64) -> Result<String, AppError> {
    if !gain_db.is_finite() || !(-48.0..=48.0).contains(&gain_db) {
        return Err(AppError::InvalidArgument(
            "gain_db must be a finite value between -48 and 48".into(),
        ));
    }
    if normalize {
        if (gain_db - 0.0).abs() < f64::EPSILON {
            return Ok("loudnorm".into());
        }
        return Ok(format!("volume={gain_db}dB,loudnorm"));
    }
    Ok(format!("volume={gain_db}dB"))
}

pub fn build_volume_args(
    input: &str,
    output: &str,
    normalize: bool,
    gain_db: f64,
) -> Result<Vec<String>, AppError> {
    let filter = build_volume_filter(normalize, gain_db)?;
    Ok(FFmpegCommandBuilder::new()
        .input(input)
        .arg_pair("-af", &filter)
        .copy_all()
        .audio_codec("aac")
        .output(output)
        .build())
}

pub struct VolumeService;

impl VolumeService {
    pub async fn adjust(
        app: &AppHandle,
        input: &str,
        output: &str,
        normalize: bool,
        gain_db: f64,
        duration_secs: Option<f64>,
        job_id: Option<&str>,
    ) -> Result<(), AppError> {
        let duration = FFmpegService::resolve_duration(app, input, duration_secs).await;
        let args = build_volume_args(input, output, normalize, gain_db)?;
        FFmpegService::run(app, args, duration, job_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gain_only_filter() {
        assert_eq!(build_volume_filter(false, 6.0).unwrap(), "volume=6dB");
        assert_eq!(build_volume_filter(false, -3.5).unwrap(), "volume=-3.5dB");
    }

    #[test]
    fn loudnorm_filter() {
        assert_eq!(build_volume_filter(true, 0.0).unwrap(), "loudnorm");
        assert_eq!(
            build_volume_filter(true, 2.0).unwrap(),
            "volume=2dB,loudnorm"
        );
    }

    #[test]
    fn rejects_out_of_range_gain() {
        assert!(build_volume_filter(false, 100.0).is_err());
        assert!(build_volume_filter(false, f64::NAN).is_err());
    }

    #[test]
    fn args_copy_video_reencode_audio() {
        let args = build_volume_args("in.mp4", "out.mp4", false, 3.0).unwrap();
        assert!(args.windows(2).any(|w| w == ["-af", "volume=3dB"]));
        assert!(args.contains(&"copy".to_string()));
        assert!(args.contains(&"aac".to_string()));
    }
}
