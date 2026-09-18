use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

use super::runner::{path_str, probe_file, run_ffmpeg, run_ffmpeg_raw};

pub struct Fixtures {
    pub dir: PathBuf,
    pub in_av: PathBuf,
    pub in_silent: PathBuf,
    pub in_rot: PathBuf,
    pub mark_png: PathBuf,
    pub subs_srt: PathBuf,
}

static FIXTURES: OnceLock<Fixtures> = OnceLock::new();

pub fn fixtures() -> &'static Fixtures {
    FIXTURES.get_or_init(|| create_fixtures().unwrap_or_else(|e| panic!("smoke fixtures: {e}")))
}

pub fn unique_out(name: &str) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    fixtures().dir.join(format!("{nanos}-{name}"))
}

fn create_fixtures() -> Result<Fixtures, String> {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("video-rs-smoke-{nanos}"));
    fs::create_dir_all(&dir).map_err(|e| format!("mkdir {}: {e}", dir.display()))?;

    let in_av = dir.join("in_av.mp4");
    let in_silent = dir.join("in_silent.mp4");
    let in_rot = dir.join("in_rot.mp4");
    let mark_png = dir.join("mark.png");
    let subs_srt = dir.join("subs.srt");
    let rot_raw = dir.join("in_rot_raw.mp4");

    run_ffmpeg_raw(&[
        "-y",
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=25:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=1000:sample_rate=44100:duration=2",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-g",
        "12",
        "-c:a",
        "aac",
        "-ac",
        "2",
        &path_str(&in_av),
    ])?;

    run_ffmpeg_raw(&[
        "-y",
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=320x240:rate=25:duration=2",
        "-an",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        &path_str(&in_silent),
    ])?;

    run_ffmpeg_raw(&[
        "-y",
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=640x480:rate=25:duration=2",
        "-an",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        &path_str(&rot_raw),
    ])?;

    write_rotated(&rot_raw, &in_rot)?;
    let rot = probe_file(&in_rot)?;
    let video = rot
        .streams
        .iter()
        .find(|s| s.codec_type == "video")
        .ok_or_else(|| "in_rot has no video stream".to_string())?;
    if video.width != Some(640) || video.height != Some(480) {
        return Err(format!(
            "in_rot coded size {:?}x{:?} (want 640x480)",
            video.width, video.height
        ));
    }
    if video.display_size() != Some((480, 640)) {
        return Err(format!(
            "in_rot display_size {:?} rotation {:?} (want Some((480, 640)))",
            video.display_size(),
            video.rotation
        ));
    }

    run_ffmpeg_raw(&[
        "-y",
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "color=c=red:s=32x32:d=0.04",
        "-frames:v",
        "1",
        &path_str(&mark_png),
    ])?;

    fs::write(
        &subs_srt,
        "1\n00:00:00,000 --> 00:00:01,000\nhello smoke\n",
    )
    .map_err(|e| format!("write srt: {e}"))?;

    Ok(Fixtures {
        dir,
        in_av,
        in_silent,
        in_rot,
        mark_png,
        subs_srt,
    })
}

fn write_rotated(raw: &Path, dest: &Path) -> Result<(), String> {
    let dest_s = path_str(dest);
    let raw_s = path_str(raw);
    if run_ffmpeg_raw(&[
        "-y",
        "-hide_banner",
        "-display_rotation",
        "90",
        "-i",
        &raw_s,
        "-c",
        "copy",
        &dest_s,
    ])
    .is_ok()
    {
        return Ok(());
    }
    run_ffmpeg(&[
        "-y".into(),
        "-hide_banner".into(),
        "-i".into(),
        raw_s,
        "-c".into(),
        "copy".into(),
        "-metadata:s:v:0".into(),
        "rotate=90".into(),
        dest_s,
    ])
}
