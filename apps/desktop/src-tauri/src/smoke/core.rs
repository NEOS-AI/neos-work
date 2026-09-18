use std::fs;
use std::path::{Path, PathBuf};

use crate::services::ffmpeg::{
    build_concat_args, build_frame_args, build_resize_args, build_transform_args, build_trim_args,
    concat_list_contents,
};

use super::fixtures::{fixtures, unique_out};
use super::runner::{assert_duration_near, first_video, path_str, probe_file, run_ffmpeg};
use super::skip_unless_smoke;

fn clip_output_path(stem: &Path, index: usize) -> PathBuf {
    let name = format!(
        "{}_clip_{:02}.mp4",
        stem.file_name().unwrap().to_string_lossy(),
        index
    );
    stem.parent().unwrap_or(Path::new(".")).join(name)
}

#[test]
fn s2_1_trim_copy() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s2_1_trim_copy.mp4");
    let args = build_trim_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        Some(0.2),
        Some(1.2),
        true,
    )
    .expect("build_trim_args copy");
    run_ffmpeg(&args).expect("trim copy");
    let info = probe_file(&out).expect("probe");
    assert_duration_near(&info, 1.0, 0.25);
}

#[test]
fn s2_2_trim_reencode() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s2_2_trim_re.mp4");
    let args = build_trim_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        Some(0.0),
        Some(0.5),
        false,
    )
    .expect("build_trim_args reencode");
    run_ffmpeg(&args).expect("trim reencode");
    let info = probe_file(&out).expect("probe");
    assert_duration_near(&info, 0.5, 0.15);
}

#[test]
fn s2_3_clips_sequential() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let stem = unique_out("export");
    let clip1 = clip_output_path(&stem, 1);
    let clip2 = clip_output_path(&stem, 2);
    assert!(clip1.file_name().unwrap().to_string_lossy().ends_with("_clip_01.mp4"));
    assert!(clip2.file_name().unwrap().to_string_lossy().ends_with("_clip_02.mp4"));

    let ranges = [(0.0, 0.4), (0.6, 1.0)];
    let outs = [&clip1, &clip2];
    for (i, ((start, end), dest)) in ranges.iter().zip(outs.iter()).enumerate() {
        let args = match build_trim_args(
            &path_str(&fx.in_av),
            &path_str(dest),
            Some(*start),
            Some(*end),
            false,
        ) {
            Ok(a) => a,
            Err(e) => {
                assert_eq!(i, 0, "only the first clip is allowed to fail before running");
                panic!("unexpected trim build error: {e}");
            }
        };
        run_ffmpeg(&args).unwrap_or_else(|e| {
            panic!("clip {} ffmpeg failed; must not run later clips: {e}", i + 1)
        });
    }

    assert!(clip1.is_file());
    assert!(clip2.is_file());
    assert_duration_near(&probe_file(&clip1).unwrap(), 0.4, 0.15);
    assert_duration_near(&probe_file(&clip2).unwrap(), 0.4, 0.15);
}

#[test]
fn s2_3b_first_clip_failure_skips_second() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let stem = unique_out("export_fail");
    let clip1 = clip_output_path(&stem, 1);
    let clip2 = clip_output_path(&stem, 2);

    let first = build_trim_args(
        &path_str(&fx.in_av),
        &path_str(&clip1),
        Some(1.0),
        Some(0.4),
        false,
    );
    assert!(first.is_err(), "inverted range must fail build_trim_args");
    assert!(!clip2.exists(), "_clip_02 must not be created");
}

#[test]
fn s2_4_concat_reencode() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let a = unique_out("s2_4_a.mp4");
    let b = unique_out("s2_4_b.mp4");
    run_ffmpeg(
        &build_trim_args(&path_str(&fx.in_av), &path_str(&a), Some(0.0), Some(0.4), false).unwrap(),
    )
    .unwrap();
    run_ffmpeg(
        &build_trim_args(&path_str(&fx.in_av), &path_str(&b), Some(0.6), Some(1.0), false).unwrap(),
    )
    .unwrap();

    let list_body = concat_list_contents(&[path_str(&a), path_str(&b)]).expect("concat list");
    let list_path = unique_out("s2_4_list.txt");
    fs::write(&list_path, list_body).expect("write concat list");
    let out = unique_out("s2_4_cat.mp4");
    let args = build_concat_args(&path_str(&list_path), &path_str(&out), false);
    run_ffmpeg(&args).expect("concat");
    let info = probe_file(&out).expect("probe concat");
    assert_duration_near(&info, 0.8, 0.35);
}

#[test]
fn s2_5_resize() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s2_5_resize.mp4");
    let args = build_resize_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        160,
        120,
        "libx264",
        Some(23),
    );
    run_ffmpeg(&args).expect("resize");
    let info = probe_file(&out).unwrap();
    let v = first_video(&info);
    assert_eq!(v.width, Some(160));
    assert_eq!(v.height, Some(120));
}

#[test]
fn s2_6_rotate_pixels() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s2_6_rot.mp4");
    let args = build_transform_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        90,
        false,
        false,
        "libx264",
        Some(23),
    )
    .expect("transform");
    run_ffmpeg(&args).expect("rotate");
    let info = probe_file(&out).unwrap();
    let v = first_video(&info);
    assert_eq!(v.width, Some(240));
    assert_eq!(v.height, Some(320));
}

#[test]
fn s2_7_export_frame() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s2_7.png");
    let args = build_frame_args(&path_str(&fx.in_av), &path_str(&out), 0.5).expect("frame");
    run_ffmpeg(&args).expect("frame ffmpeg");
    let len = fs::metadata(&out).expect("png meta").len();
    assert!(len > 100, "png too small: {len}");
}
