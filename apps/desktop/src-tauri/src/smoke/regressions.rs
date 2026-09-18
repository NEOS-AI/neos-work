use crate::models::error::AppError;
use crate::services::crop::{build_crop_args, snap_crop_even, validate_crop_rect};
use crate::services::ffmpeg::validate_extract_audio;

use super::fixtures::{fixtures, unique_out};
use super::runner::{first_video, path_str, probe_file, run_ffmpeg};
use super::skip_unless_smoke;

#[test]
fn s1_1_silent_extract_rejects_without_ffmpeg() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_silent).expect("probe in_silent");
    let err = validate_extract_audio(&info, None).unwrap_err();
    assert!(matches!(
        err,
        AppError::InvalidArgument(ref m) if m == "input has no audio stream"
    ));
}

#[test]
fn s1_2_silent_extract_rejects_wrong_index() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_silent).expect("probe in_silent");
    let err = validate_extract_audio(&info, Some(1)).unwrap_err();
    // Empty audio is checked before the absolute index (same as extract_audio).
    assert!(matches!(
        err,
        AppError::InvalidArgument(ref m) if m == "input has no audio stream"
    ));
}

#[test]
fn s1_3_crop_uses_display_size_not_coded() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    validate_crop_rect(400, 600, 0, 0, 480, 640).expect("display 480x640 must accept 400x600+0+0");
    assert!(
        validate_crop_rect(400, 600, 0, 0, 640, 480).is_err(),
        "coded 640x480 must reject 400x600+0+0"
    );

    let info = probe_file(&fx.in_rot).expect("probe in_rot");
    let video = first_video(&info);
    let (dw, dh) = video.display_size().expect("display_size");
    validate_crop_rect(400, 600, 0, 0, dw, dh).expect("validate against display_size");
    let (w, h, x, y) = snap_crop_even(400, 600, 0, 0);
    let out = unique_out("s1_3_crop.mp4");
    let args = build_crop_args(
        &path_str(&fx.in_rot),
        &path_str(&out),
        w,
        h,
        x,
        y,
        "libx264",
        Some(23),
    )
    .expect("build_crop_args");
    assert!(
        !args.iter().any(|a| a == "-noautorotate"),
        "app does not pass -noautorotate"
    );
    run_ffmpeg(&args).expect("crop ffmpeg");
    let out_info = probe_file(&out).expect("probe crop output");
    let ov = first_video(&out_info);
    assert_eq!(ov.width, Some(400));
    assert_eq!(ov.height, Some(600));
}
