use std::path::Path;
use std::process::Command;

use serde_json::Value;

use crate::models::video_info::VideoInfo;
use crate::services::ffprobe::parse_probe_output;

pub fn run_ffmpeg(args: &[String]) -> Result<(), String> {
    let output = Command::new("ffmpeg")
        .args(args)
        .output()
        .map_err(|e| format!("spawn ffmpeg: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffmpeg failed ({:?}): {}\nargs: {args:?}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

pub fn run_ffmpeg_raw(args: &[&str]) -> Result<(), String> {
    let owned: Vec<String> = args.iter().map(|s| (*s).to_string()).collect();
    run_ffmpeg(&owned)
}

pub fn tool_version(name: &str) -> Result<(), String> {
    let output = Command::new(name)
        .arg("-version")
        .output()
        .map_err(|e| format!("spawn {name}: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "{name} -version failed ({:?}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

pub fn probe_file(path: &Path) -> Result<VideoInfo, String> {
    let output = Command::new("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .map_err(|e| format!("spawn ffprobe: {e}"))?;
    if !output.status.success() {
        return Err(format!(
            "ffprobe failed ({:?}): {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: Value =
        serde_json::from_str(&stdout).map_err(|e| format!("ffprobe json: {e}\n{stdout}"))?;
    parse_probe_output(&json).map_err(|e| format!("parse_probe_output: {e}"))
}

pub fn path_str(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

pub fn first_video(info: &VideoInfo) -> &crate::models::video_info::StreamInfo {
    info.streams
        .iter()
        .find(|s| s.codec_type == "video")
        .expect("video stream")
}

pub fn audio_count(info: &VideoInfo) -> usize {
    info.streams.iter().filter(|s| s.codec_type == "audio").count()
}

pub fn assert_duration_near(info: &VideoInfo, expected: f64, tol: f64) {
    let d = info
        .format
        .duration
        .unwrap_or_else(|| panic!("missing duration (expected {expected} ± {tol})"));
    assert!(
        (d - expected).abs() <= tol,
        "duration {d} not near {expected} ± {tol}"
    );
}
