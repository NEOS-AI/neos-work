use std::collections::HashMap;

use crate::services::timeline::model::{
    RenderProfile, TimelineClip, TimelineProject, TimelineTrack, TrackKind, TIMELINE_VERSION,
};
use crate::services::timeline::{build_timeline_args, build_timeline_args_with_audio};

use super::fixtures::{fixtures, unique_out};
use super::runner::{
    assert_duration_near, audio_count, first_video, path_str, probe_file, run_ffmpeg,
    run_ffmpeg_raw,
};
use super::skip_unless_smoke;

fn clip(
    id: &str,
    path: &str,
    timeline_start: f64,
    source_in: f64,
    source_out: f64,
) -> TimelineClip {
    TimelineClip {
        id: id.into(),
        source_path: path.into(),
        source_in,
        source_out,
        timeline_start,
        effects: vec![],
    }
}

fn video_track(clips: Vec<TimelineClip>, muted: bool) -> TimelineTrack {
    TimelineTrack {
        id: "v1".into(),
        kind: TrackKind::Video,
        name: "V1".into(),
        muted,
        clips,
    }
}

fn audio_track(clips: Vec<TimelineClip>) -> TimelineTrack {
    TimelineTrack {
        id: "a1".into(),
        kind: TrackKind::Audio,
        name: "A1".into(),
        muted: false,
        clips,
    }
}

fn project(
    width: u32,
    height: u32,
    fps: f64,
    sample_rate: u32,
    tracks: Vec<TimelineTrack>,
) -> TimelineProject {
    TimelineProject {
        version: TIMELINE_VERSION,
        name: "smoke".into(),
        fps,
        width,
        height,
        sample_rate,
        tracks,
    }
}

fn fast_profile(project: &TimelineProject) -> RenderProfile {
    RenderProfile {
        width: project.width,
        height: project.height,
        fps: project.fps,
        video_codec: "libx264".into(),
        audio_codec: "aac".into(),
        crf: Some(28),
        video_bitrate: None,
        preset: Some("ultrafast".into()),
        audio_bitrate: Some("128k".into()),
    }
}

/// 640×360 AV sibling of fixtures (different size from in_av 320×240).
fn make_alt_res_av() -> std::path::PathBuf {
    let out = unique_out("alt_640x360.mp4");
    run_ffmpeg_raw(&[
        "-y",
        "-hide_banner",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=640x360:rate=25:duration=2",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=44100:duration=2",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-ac",
        "2",
        &path_str(&out),
    ])
    .expect("generate 640x360 fixture");
    out
}

#[test]
fn gap_concat_duration_and_size() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let src = path_str(&fx.in_av);
    // Clip A 0–0.5s @ t=0, gap 0.25s, clip B 0–0.5s @ t=0.75 → total 1.25s
    let proj = project(
        320,
        240,
        25.0,
        44100,
        vec![video_track(
            vec![
                clip("a", &src, 0.0, 0.0, 0.5),
                clip("b", &src, 0.75, 0.0, 0.5),
            ],
            false,
        )],
    );
    let out = unique_out("tl_gap.mp4");
    let args = build_timeline_args(&proj, &path_str(&out), &fast_profile(&proj)).expect("args");
    run_ffmpeg(&args).expect("timeline gap concat");
    let info = probe_file(&out).expect("probe");
    assert_duration_near(&info, 1.25, 0.15);
    let v = first_video(&info);
    assert_eq!(v.width, Some(320));
    assert_eq!(v.height, Some(240));
}

/// Same gap project as `gap_concat_duration_and_size`; export vs proxy width/duration.
#[test]
fn proxy_vs_export_width_and_duration() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let src = path_str(&fx.in_av);
    // Clip A 0–0.5s @ t=0, gap 0.25s, clip B 0–0.5s @ t=0.75 → total 1.25s
    let proj = project(
        320,
        240,
        25.0,
        44100,
        vec![video_track(
            vec![
                clip("a", &src, 0.0, 0.0, 0.5),
                clip("b", &src, 0.75, 0.0, 0.5),
            ],
            false,
        )],
    );

    let export_out = unique_out("tl_gap_export.mp4");
    let export_args =
        build_timeline_args(&proj, &path_str(&export_out), &RenderProfile::export(&proj))
            .expect("export args");
    run_ffmpeg(&export_args).expect("timeline export");
    let export_info = probe_file(&export_out).expect("probe export");
    assert_duration_near(&export_info, 1.25, 0.15);
    let export_v = first_video(&export_info);
    assert_eq!(export_v.width, Some(320));
    assert_eq!(export_v.height, Some(240));

    let proxy_out = unique_out("tl_gap_proxy.mp4");
    let proxy_args =
        build_timeline_args(&proj, &path_str(&proxy_out), &RenderProfile::proxy(&proj))
            .expect("proxy args");
    run_ffmpeg(&proxy_args).expect("timeline proxy");
    let proxy_info = probe_file(&proxy_out).expect("probe proxy");
    assert_duration_near(&proxy_info, 1.25, 0.15);
    let proxy_v = first_video(&proxy_info);
    assert_eq!(proxy_v.width, Some(640));
    // 240 * (640/320) = 480
    assert_eq!(proxy_v.height, Some(480));

    let export_dur = export_info
        .format
        .duration
        .expect("export duration");
    let proxy_dur = proxy_info.format.duration.expect("proxy duration");
    assert!(
        (export_dur - proxy_dur).abs() <= 0.15,
        "proxy duration {proxy_dur} should match export {export_dur} within ±0.15"
    );
}

#[test]
fn different_resolutions_scale_pad_to_project() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let alt = make_alt_res_av();
    let src_a = path_str(&fx.in_av); // 320×240
    let src_b = path_str(&alt); // 640×360
    let proj_w = 640u32;
    let proj_h = 360u32;
    let proj = project(
        proj_w,
        proj_h,
        25.0,
        44100,
        vec![video_track(
            vec![
                clip("a", &src_a, 0.0, 0.0, 0.4),
                clip("b", &src_b, 0.4, 0.0, 0.4),
            ],
            false,
        )],
    );
    let out = unique_out("tl_res.mp4");
    let args = build_timeline_args(&proj, &path_str(&out), &fast_profile(&proj)).expect("args");
    run_ffmpeg(&args).expect("timeline multi-res");
    let info = probe_file(&out).expect("probe");
    let v = first_video(&info);
    assert_eq!(v.width, Some(proj_w));
    assert_eq!(v.height, Some(proj_h));
    assert_duration_near(&info, 0.8, 0.2);
}

#[test]
fn a1_only_black_video_with_audio() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let src = path_str(&fx.in_av);
    // Empty V1 → black canvas; A1 carries audio (adelay path, audio_count ≥ 1).
    let proj = project(
        320,
        240,
        25.0,
        44100,
        vec![
            video_track(vec![], false),
            audio_track(vec![clip("a", &src, 0.25, 0.0, 0.75)]),
        ],
    );
    let out = unique_out("tl_a1.mp4");
    let args = build_timeline_args(&proj, &path_str(&out), &fast_profile(&proj)).expect("args");
    run_ffmpeg(&args).expect("timeline a1-only");
    let info = probe_file(&out).expect("probe");
    let v = first_video(&info);
    assert_eq!(v.width, Some(320));
    assert_eq!(v.height, Some(240));
    assert!(audio_count(&info) >= 1, "expected A1 audio stream");
    // A1 clip ends at 0.25+0.75 = 1.0s
    assert_duration_near(&info, 1.0, 0.2);
}

#[test]
fn v1_and_a1_mix_has_audio() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let src = path_str(&fx.in_av);
    // V1 0–0.8s @ t=0 plus A1 0–0.6s @ t=0 → mix, duration 0.8s
    let proj = project(
        320,
        240,
        25.0,
        44100,
        vec![
            video_track(vec![clip("v", &src, 0.0, 0.0, 0.8)], false),
            audio_track(vec![clip("a", &src, 0.0, 0.0, 0.6)]),
        ],
    );
    let out = unique_out("tl_mix.mp4");
    let args = build_timeline_args(&proj, &path_str(&out), &fast_profile(&proj)).expect("args");
    assert!(
        args.iter()
            .any(|a| a.contains("amix=inputs=2:duration=first")),
        "expected V1+A1 amix in argv"
    );
    run_ffmpeg(&args).expect("timeline v1+a1 mix");
    let info = probe_file(&out).expect("probe");
    assert!(audio_count(&info) >= 1, "expected mixed audio stream");
    assert_duration_near(&info, 0.8, 0.2);
}

#[test]
fn silent_v1_clip_emits_video_and_anull_audio() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let src = path_str(&fx.in_silent);
    let src_info = probe_file(&fx.in_silent).expect("probe in_silent");
    assert_eq!(
        audio_count(&src_info),
        0,
        "fixture in_silent must have no audio"
    );
    let proj = project(
        320,
        240,
        25.0,
        44100,
        vec![video_track(vec![clip("v", &src, 0.0, 0.0, 0.5)], false)],
    );
    let mut has_audio = HashMap::new();
    has_audio.insert(src.clone(), false);
    let out = unique_out("tl_silent.mp4");
    let args =
        build_timeline_args_with_audio(&proj, &path_str(&out), &fast_profile(&proj), &has_audio)
            .expect("args");
    assert!(
        args.iter().any(|a| a.contains("anullsrc")),
        "silent V1 must use anullsrc"
    );
    assert!(
        !args.iter().any(|a| a.contains("[0:a]atrim")),
        "silent V1 must not trim a missing audio stream"
    );
    run_ffmpeg(&args).expect("timeline silent v1");
    let info = probe_file(&out).expect("probe");
    let v = first_video(&info);
    assert_eq!(v.width, Some(320));
    assert_eq!(v.height, Some(240));
    assert!(
        audio_count(&info) >= 1,
        "anullsrc should produce a silent audio stream"
    );
    assert_duration_near(&info, 0.5, 0.2);
}
