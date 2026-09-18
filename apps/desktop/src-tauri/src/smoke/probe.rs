use super::fixtures::fixtures;
use super::runner::{audio_count, first_video, tool_version, probe_file};
use super::skip_unless_smoke;

#[test]
fn s0_1_path_ffmpeg_ffprobe_version() {
    if skip_unless_smoke() {
        return;
    }
    tool_version("ffmpeg").expect("ffmpeg -version");
    tool_version("ffprobe").expect("ffprobe -version");
}

#[test]
fn s0_2_in_av_probe() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_av).expect("probe in_av");
    let v = first_video(&info);
    assert_eq!(v.width, Some(320));
    assert_eq!(v.height, Some(240));
    assert!(audio_count(&info) >= 1, "in_av should have audio");
}

#[test]
fn s0_3_in_silent_has_no_audio() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_silent).expect("probe in_silent");
    assert_eq!(audio_count(&info), 0);
}

#[test]
fn s0_4_in_rot_display_size() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_rot).expect("probe in_rot");
    let v = first_video(&info);
    assert_eq!(v.width, Some(640));
    assert_eq!(v.height, Some(480));
    assert_eq!(v.display_size(), Some((480, 640)));
}
