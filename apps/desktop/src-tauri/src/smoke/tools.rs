use std::fs;

use crate::services::encoders::subtitle_codec_for_output;
use crate::services::fade::{build_fade_args, fade_out_start};
use crate::services::ffmpeg::{
    build_extract_audio_args, build_mux_args, build_transcode_args, validate_extract_audio,
    FFmpegCommandBuilder,
};
use crate::services::gif::build_gif_args;
use crate::services::speed::build_speed_args;
use crate::services::ts_to_mp4::{build_ts_to_mp4_args, choose_ts_codecs, TsConvertMode};
use crate::services::volume::build_volume_args;
use crate::services::watermark::{build_image_watermark_args, OverlayPosition};

use super::fixtures::{fixtures, unique_out};
use super::runner::{
    assert_duration_near, audio_count, first_video, path_str, probe_file, run_ffmpeg,
};
use super::skip_unless_smoke;

#[test]
fn s3_1_extract_audio_ok() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_av).unwrap();
    validate_extract_audio(&info, None).expect("has audio");
    let out = unique_out("s3_1.m4a");
    let args = build_extract_audio_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        "aac",
        Some("128k"),
        None,
    );
    run_ffmpeg(&args).expect("extract");
    let out_info = probe_file(&out).unwrap();
    assert!(audio_count(&out_info) >= 1);
    assert!(out_info.streams.iter().all(|s| s.codec_type != "video"));
}

#[test]
fn s3_2_gif() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s3_2.gif");
    let args = build_gif_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        Some(0.0),
        Some(1.0),
        10,
        160,
    )
    .expect("gif args");
    run_ffmpeg(&args).expect("gif");
    assert!(out.is_file());
    let info = probe_file(&out).unwrap();
    assert!(
        info.format.format_name.contains("gif"),
        "format_name={}",
        info.format.format_name
    );
}

#[test]
fn s3_3_speed_2x() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s3_3_speed.mp4");
    let args = build_speed_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        2.0,
        true,
        Some("libx264"),
        Some(23),
    )
    .expect("speed");
    run_ffmpeg(&args).expect("speed ffmpeg");
    assert_duration_near(&probe_file(&out).unwrap(), 1.0, 0.25);
}

#[test]
fn s3_4_fade() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out_start = fade_out_start(2.0, 0.3);
    assert_eq!(out_start, Some(1.7));
    let out = unique_out("s3_4_fade.mp4");
    let args = build_fade_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        0.3,
        0.3,
        out_start,
        true,
        "libx264",
        Some(23),
    )
    .expect("fade");
    run_ffmpeg(&args).expect("fade ffmpeg");
    assert!(out.is_file());
}

#[test]
fn s3_5_volume() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s3_5_vol.mp4");
    let args =
        build_volume_args(&path_str(&fx.in_av), &path_str(&out), false, 6.0).expect("volume");
    run_ffmpeg(&args).expect("volume ffmpeg");
    assert!(audio_count(&probe_file(&out).unwrap()) >= 1);
}

#[test]
fn s3_6_image_watermark() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s3_6_wm.mp4");
    let args = build_image_watermark_args(
        &path_str(&fx.in_av),
        &path_str(&fx.mark_png),
        &path_str(&out),
        OverlayPosition::TopLeft,
        "libx264",
        Some(23),
    );
    run_ffmpeg(&args).expect("watermark");
    let info = probe_file(&out).unwrap();
    assert!(first_video(&info).width.is_some());
}

#[test]
fn s3_7_transcode_software() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s3_7_tc.mp4");
    let args = build_transcode_args(
        &path_str(&fx.in_av),
        &path_str(&out),
        "libx264",
        "aac",
        Some(23),
        None,
        None,
    );
    run_ffmpeg(&args).expect("transcode");
    let info = probe_file(&out).unwrap();
    let v = first_video(&info);
    assert!(v.width.is_some());
    assert!(audio_count(&info) >= 1);
}

#[test]
fn s3_8_mux() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let out = unique_out("s3_8_mux.mp4");
    let args = build_mux_args(
        &path_str(&fx.in_silent),
        &path_str(&fx.in_av),
        &path_str(&out),
        &[],
        &[],
        &[],
        None,
        &[],
    );
    run_ffmpeg(&args).expect("mux");
    let info = probe_file(&out).unwrap();
    assert!(first_video(&info).width.is_some());
    assert!(audio_count(&info) >= 1);
}

#[test]
fn s3_9_extract_subtitle() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let muxed = unique_out("s3_9_muxed.mkv");
    let mux_args = build_mux_args(
        &path_str(&fx.in_av),
        &path_str(&fx.in_av),
        &path_str(&muxed),
        &[],
        &[],
        &[],
        Some(&path_str(&fx.subs_srt)),
        &[],
    );
    run_ffmpeg(&mux_args).expect("mux subs");
    let mux_info = probe_file(&muxed).unwrap();
    let sub = mux_info
        .streams
        .iter()
        .find(|s| s.codec_type == "subtitle")
        .expect("muxed subtitle stream");
    let out = unique_out("s3_9.srt");
    let codec = subtitle_codec_for_output(&path_str(&out));
    assert_eq!(codec, "srt");
    let args = FFmpegCommandBuilder::new()
        .input(&path_str(&muxed))
        .map(&format!("0:{}", sub.index))
        .subtitle_codec(codec)
        .output(&path_str(&out))
        .build();
    run_ffmpeg(&args).expect("extract srt");
    let text = fs::read_to_string(&out).expect("read srt");
    assert!(text.contains("hello smoke"), "srt contents: {text}");
}

#[test]
fn s3_10_ts_to_mp4_copy() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_ts_copy).unwrap();
    let video = first_video(&info);
    let audio = info
        .streams
        .iter()
        .find(|s| s.codec_type == "audio")
        .expect("audio stream");
    let plan = choose_ts_codecs(
        &video.codec_name,
        Some(audio.codec_name.as_str()),
        TsConvertMode::Auto,
        None,
        None,
        None,
    )
    .expect("plan");
    let out = unique_out("s3_10_ts_copy.mp4");
    let args = build_ts_to_mp4_args(
        &path_str(&fx.in_ts_copy),
        &path_str(&out),
        &plan,
        video.index,
        Some(audio.index),
    );
    run_ffmpeg(&args).expect("ts copy");
    let out_info = probe_file(&out).unwrap();
    assert!(
        out_info.format.format_name.contains("mp4"),
        "format_name={}",
        out_info.format.format_name
    );
    assert!(
        out_info
            .streams
            .iter()
            .any(|s| s.codec_type == "audio" && s.codec_name == "aac"),
        "expected aac audio"
    );
}

#[test]
fn s3_11_ts_to_mp4_encode() {
    if skip_unless_smoke() {
        return;
    }
    let fx = fixtures();
    let info = probe_file(&fx.in_ts_mpeg2).unwrap();
    let video = first_video(&info);
    let audio = info
        .streams
        .iter()
        .find(|s| s.codec_type == "audio")
        .expect("audio stream");
    let plan = choose_ts_codecs(
        &video.codec_name,
        Some(audio.codec_name.as_str()),
        TsConvertMode::Auto,
        None,
        None,
        None,
    )
    .expect("plan");
    let out = unique_out("s3_11_ts_enc.mp4");
    let args = build_ts_to_mp4_args(
        &path_str(&fx.in_ts_mpeg2),
        &path_str(&out),
        &plan,
        video.index,
        Some(audio.index),
    );
    run_ffmpeg(&args).expect("ts encode");
    let out_info = probe_file(&out).unwrap();
    assert!(
        out_info.format.format_name.contains("mp4"),
        "format_name={}",
        out_info.format.format_name
    );
    assert!(first_video(&out_info).width.is_some());
    assert!(
        out_info
            .streams
            .iter()
            .any(|s| s.codec_type == "audio" && s.codec_name == "aac"),
        "expected aac audio"
    );
}
