use crate::models::error::AppError;
use crate::models::video_info::StreamInfo;
use crate::services::encoders::hwaccel_for_codec;
use crate::services::ffmpeg::FFmpegCommandBuilder;

pub fn is_mpegts_format(format_name: &str) -> bool {
    format_name
        .split(',')
        .any(|p| p.trim().eq_ignore_ascii_case("mpegts"))
}

pub fn has_mpegts_extension(path: &str) -> bool {
    matches!(
        path.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "ts" | "m2ts" | "mts"
    )
}

pub fn is_hls_playlist_path(path: &str) -> bool {
    matches!(
        path.rsplit('.')
            .next()
            .unwrap_or("")
            .to_ascii_lowercase()
            .as_str(),
        "m3u8" | "m3u"
    )
}

pub fn output_is_mp4(path: &str) -> bool {
    path.rsplit('.')
        .next()
        .unwrap_or("")
        .eq_ignore_ascii_case("mp4")
        && path.contains('.')
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TsConvertMode {
    Auto,
    ForceCopy,
    ForceEncode,
}

impl TsConvertMode {
    pub fn parse(raw: Option<&str>) -> Result<Self, AppError> {
        match raw
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("auto")
        {
            "auto" => Ok(Self::Auto),
            "force_copy" => Ok(Self::ForceCopy),
            "force_encode" => Ok(Self::ForceEncode),
            other => Err(AppError::InvalidArgument(format!(
                "mode must be auto, force_copy, or force_encode (got {other})"
            ))),
        }
    }
}

fn video_copy_compatible(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "h264" | "avc" | "hevc" | "h265"
    )
}

fn audio_copy_compatible(codec: &str) -> bool {
    codec.eq_ignore_ascii_case("aac")
}

fn is_hevc(codec: &str) -> bool {
    matches!(codec.to_ascii_lowercase().as_str(), "hevc" | "h265")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TsToMp4Plan {
    pub video_codec: String,
    pub audio_codec: Option<String>,
    pub audio_bsf: Option<String>,
    pub video_tag: Option<String>,
    pub crf: Option<u8>,
}

pub fn choose_ts_codecs(
    video_codec_name: &str,
    audio_codec_name: Option<&str>,
    mode: TsConvertMode,
    user_video_codec: Option<&str>,
    user_audio_codec: Option<&str>,
    user_crf: Option<u8>,
) -> Result<TsToMp4Plan, AppError> {
    match mode {
        TsConvertMode::Auto => {
            let (video_codec, video_tag, crf) = if video_copy_compatible(video_codec_name) {
                let tag = if is_hevc(video_codec_name) {
                    Some("hvc1".to_string())
                } else {
                    None
                };
                ("copy".to_string(), tag, None)
            } else {
                ("libx264".to_string(), None, Some(23))
            };
            let (audio_codec, audio_bsf) = match audio_codec_name {
                None => (None, None),
                Some(c) if audio_copy_compatible(c) => {
                    (Some("copy".to_string()), Some("aac_adtstoasc".to_string()))
                }
                Some(_) => (Some("aac".to_string()), None),
            };
            Ok(TsToMp4Plan {
                video_codec,
                audio_codec,
                audio_bsf,
                video_tag,
                crf,
            })
        }
        TsConvertMode::ForceCopy => {
            if !video_copy_compatible(video_codec_name) {
                return Err(AppError::InvalidArgument(format!(
                    "codec cannot be copied into MP4: {video_codec_name}"
                )));
            }
            if let Some(audio) = audio_codec_name {
                if !audio_copy_compatible(audio) {
                    return Err(AppError::InvalidArgument(format!(
                        "codec cannot be copied into MP4: {audio}"
                    )));
                }
            }
            let video_tag = if is_hevc(video_codec_name) {
                Some("hvc1".to_string())
            } else {
                None
            };
            let (audio_codec, audio_bsf) = match audio_codec_name {
                Some(_) => (Some("copy".to_string()), Some("aac_adtstoasc".to_string())),
                None => (None, None),
            };
            Ok(TsToMp4Plan {
                video_codec: "copy".to_string(),
                audio_codec,
                audio_bsf,
                video_tag,
                crf: None,
            })
        }
        TsConvertMode::ForceEncode => {
            let video_codec = user_video_codec
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or("libx264");
            if video_codec.eq_ignore_ascii_case("copy") {
                return Err(AppError::InvalidArgument(
                    "video_codec cannot be copy in force_encode".into(),
                ));
            }
            let audio_codec = match audio_codec_name {
                None => None,
                Some(_) => {
                    let requested = user_audio_codec
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .unwrap_or("aac");
                    if !requested.eq_ignore_ascii_case("aac") {
                        return Err(AppError::InvalidArgument(format!(
                            "audio_codec must be aac (got {requested})"
                        )));
                    }
                    Some("aac".to_string())
                }
            };
            Ok(TsToMp4Plan {
                video_codec: video_codec.to_string(),
                audio_codec,
                audio_bsf: None,
                video_tag: None,
                crf: Some(user_crf.unwrap_or(23)),
            })
        }
    }
}

pub fn build_ts_to_mp4_args(
    input: &str,
    output: &str,
    plan: &TsToMp4Plan,
    video_stream: u32,
    audio_stream: Option<u32>,
) -> Vec<String> {
    let mut builder = FFmpegCommandBuilder::new().arg_pair("-fflags", "+genpts+discardcorrupt");
    if let Some(hw) = hwaccel_for_codec(&plan.video_codec) {
        builder = builder.hwaccel(hw);
    }
    builder = builder.input(input).map(&format!("0:{video_stream}"));
    if let Some(idx) = audio_stream {
        builder = builder.map(&format!("0:{idx}"));
    }
    builder = builder.video_codec(&plan.video_codec);
    if let Some(audio) = plan.audio_codec.as_deref() {
        builder = builder.audio_codec(audio);
    }
    if let Some(bsf) = plan.audio_bsf.as_deref() {
        builder = builder.arg_pair("-bsf:a", bsf);
    }
    if let Some(tag) = plan.video_tag.as_deref() {
        builder = builder.arg_pair("-tag:v", tag);
    }
    builder
        .apply_video_quality(&plan.video_codec, plan.crf)
        .no_data()
        .no_subtitles()
        .arg_pair("-avoid_negative_ts", "make_zero")
        .arg_pair("-movflags", "+faststart")
        .output(output)
        .build()
}

pub fn validate_ts_streams(
    streams: &[StreamInfo],
    video_stream: u32,
    audio_stream: Option<u32>,
) -> Result<(), AppError> {
    match streams.iter().find(|s| s.index == video_stream) {
        Some(s) if s.codec_type == "video" => {}
        Some(_) => {
            return Err(AppError::InvalidArgument(format!(
                "stream {video_stream} is not a video track"
            )));
        }
        None => {
            return Err(AppError::InvalidArgument(format!(
                "stream {video_stream} not found"
            )));
        }
    }
    if let Some(idx) = audio_stream {
        match streams.iter().find(|s| s.index == idx) {
            Some(s) if s.codec_type == "audio" => {}
            Some(_) => {
                return Err(AppError::InvalidArgument(format!(
                    "stream {idx} is not an audio track"
                )));
            }
            None => {
                return Err(AppError::InvalidArgument(format!("stream {idx} not found")));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::video_info::StreamInfo;

    fn has_pair(args: &[String], a: &str, b: &str) -> bool {
        args.windows(2).any(|w| w[0] == a && w[1] == b)
    }

    fn idx(args: &[String], flag: &str) -> usize {
        args.iter().position(|a| a == flag).expect(flag)
    }

    fn args_for(plan: &TsToMp4Plan, video_stream: u32, audio_stream: Option<u32>) -> Vec<String> {
        build_ts_to_mp4_args("in.ts", "out.mp4", plan, video_stream, audio_stream)
    }

    fn auto_args(
        video: &str,
        audio: Option<&str>,
        video_stream: u32,
        audio_stream: Option<u32>,
    ) -> (TsToMp4Plan, Vec<String>) {
        let plan = choose_ts_codecs(video, audio, TsConvertMode::Auto, None, None, None).unwrap();
        let args = args_for(&plan, video_stream, audio_stream);
        (plan, args)
    }

    fn stream(index: u32, codec_type: &str, codec_name: &str) -> StreamInfo {
        StreamInfo {
            index,
            codec_type: codec_type.into(),
            codec_name: codec_name.into(),
            codec_long_name: None,
            width: None,
            height: None,
            rotation: None,
            r_frame_rate: None,
            avg_frame_rate: None,
            pix_fmt: None,
            sample_rate: None,
            channels: None,
            channel_layout: None,
            bit_rate: None,
            duration: None,
            language: None,
            title: None,
        }
    }

    #[test]
    fn is_mpegts_format_tokens() {
        assert!(is_mpegts_format("mpegts"));
        assert!(!is_mpegts_format("mov,mp4,m4a"));
        assert!(is_mpegts_format("mpegts,mpegts"));
        assert!(is_mpegts_format("MPEGTS"));
        assert!(is_mpegts_format(" mpegts "));
    }

    #[test]
    fn is_hls_playlist_path_extensions() {
        assert!(is_hls_playlist_path("a.m3u8"));
        assert!(is_hls_playlist_path("a.M3U"));
        assert!(!is_hls_playlist_path("a.ts"));
    }

    #[test]
    fn output_is_mp4_requires_extension() {
        assert!(output_is_mp4("out.mp4"));
        assert!(output_is_mp4("out.MP4"));
        assert!(!output_is_mp4("out.mkv"));
        assert!(!output_is_mp4("out"));
    }

    #[test]
    fn has_mpegts_extension_v1() {
        assert!(has_mpegts_extension("a.m2ts"));
        assert!(!has_mpegts_extension("a.mp4"));
        assert!(!has_mpegts_extension("a.m2t"));
    }

    #[test]
    fn copy_h264_aac_args() {
        let (_, args) = auto_args("h264", Some("aac"), 0, Some(1));
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-c:a", "copy"));
        assert!(has_pair(&args, "-bsf:a", "aac_adtstoasc"));
        assert!(args.contains(&"-dn".to_string()));
        assert!(args.contains(&"-sn".to_string()));
        assert!(has_pair(&args, "-movflags", "+faststart"));
        assert!(!args.iter().any(|a| a.contains("h264_mp4toannexb")));
        assert!(!args.contains(&"-hwaccel".to_string()));
        assert!(!args.contains(&"-tag:v".to_string()));
        assert!(idx(&args, "-fflags") < idx(&args, "-i"));
        assert!(idx(&args, "-avoid_negative_ts") > idx(&args, "-i"));
    }

    #[test]
    fn mix_h264_mp2_args() {
        let (_, args) = auto_args("h264", Some("mp2"), 0, Some(1));
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-c:a", "aac"));
        assert!(!args.contains(&"-bsf:a".to_string()));
        assert!(!args.contains(&"-crf".to_string()));
    }

    #[test]
    fn h264_aac_latm_auto_encodes_audio() {
        let (plan, args) = auto_args("h264", Some("aac_latm"), 0, Some(1));
        assert_eq!(plan.audio_codec.as_deref(), Some("aac"));
        assert_eq!(plan.audio_bsf, None);
        assert!(!args.contains(&"-bsf:a".to_string()));
    }

    #[test]
    fn force_copy_aac_latm_errors() {
        let err = choose_ts_codecs(
            "h264",
            Some("aac_latm"),
            TsConvertMode::ForceCopy,
            None,
            None,
            None,
        )
        .unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument(_)));
    }

    #[test]
    fn mpeg2_mp2_auto_encodes() {
        let (_, args) = auto_args("mpeg2video", Some("mp2"), 0, Some(1));
        assert!(has_pair(&args, "-c:v", "libx264"));
        assert!(has_pair(&args, "-c:a", "aac"));
        assert!(has_pair(&args, "-crf", "23"));
        assert!(!args.contains(&"-bsf:a".to_string()));
        assert!(!args.contains(&"-vf".to_string()));
        assert!(!args.iter().any(|a| a.contains("h264_mp4toannexb")));
    }

    #[test]
    fn mpeg2_aac_auto_mix_video_encode() {
        let (plan, args) = auto_args("mpeg2video", Some("aac"), 0, Some(1));
        assert_eq!(plan.video_codec, "libx264");
        assert_eq!(plan.audio_codec.as_deref(), Some("copy"));
        assert_eq!(plan.audio_bsf.as_deref(), Some("aac_adtstoasc"));
        assert!(has_pair(&args, "-c:v", "libx264"));
        assert!(has_pair(&args, "-c:a", "copy"));
        assert!(has_pair(&args, "-bsf:a", "aac_adtstoasc"));
        assert!(has_pair(&args, "-crf", "23"));
    }

    #[test]
    fn hevc_copy_tags_hvc1() {
        let (_, args) = auto_args("hevc", Some("aac"), 0, Some(1));
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-tag:v", "hvc1"));
        assert!(!args.iter().any(|a| a.contains("hevc_mp4toannexb")));
    }

    #[test]
    fn force_copy_rejects_mp2_accepts_h264_aac() {
        assert!(choose_ts_codecs(
            "h264",
            Some("mp2"),
            TsConvertMode::ForceCopy,
            None,
            None,
            None,
        )
        .is_err());
        let plan = choose_ts_codecs(
            "h264",
            Some("aac"),
            TsConvertMode::ForceCopy,
            None,
            None,
            None,
        )
        .unwrap();
        let args = args_for(&plan, 0, Some(1));
        assert_eq!(plan.video_codec, "copy");
        assert_eq!(plan.audio_codec.as_deref(), Some("copy"));
        assert_eq!(plan.audio_bsf.as_deref(), Some("aac_adtstoasc"));
        assert!(has_pair(&args, "-c:v", "copy"));
        assert!(has_pair(&args, "-c:a", "copy"));
        assert!(has_pair(&args, "-bsf:a", "aac_adtstoasc"));
    }

    #[test]
    fn force_encode_rejects_copy_and_non_aac() {
        assert!(choose_ts_codecs(
            "h264",
            Some("aac"),
            TsConvertMode::ForceEncode,
            Some("copy"),
            None,
            None,
        )
        .is_err());
        assert!(choose_ts_codecs(
            "h264",
            Some("mp2"),
            TsConvertMode::ForceEncode,
            Some("libx264"),
            Some("mp3"),
            None,
        )
        .is_err());
        let plan = choose_ts_codecs(
            "mpeg2video",
            Some("mp2"),
            TsConvertMode::ForceEncode,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(plan.audio_codec.as_deref(), Some("aac"));
        assert_eq!(plan.video_codec, "libx264");
        assert_eq!(plan.crf, Some(23));
    }

    #[test]
    fn force_encode_videotoolbox_inserts_hwaccel() {
        let plan = choose_ts_codecs(
            "mpeg2video",
            Some("mp2"),
            TsConvertMode::ForceEncode,
            Some("h264_videotoolbox"),
            None,
            None,
        )
        .unwrap();
        let args = args_for(&plan, 0, Some(1));
        let fflags = idx(&args, "-fflags");
        let hw = idx(&args, "-hwaccel");
        let input = idx(&args, "-i");
        assert!(fflags < hw && hw < input);
        assert_eq!(args[hw + 1], "videotoolbox");
        assert!(args.contains(&"-q:v".to_string()));
        assert!(!args.contains(&"-crf".to_string()));
    }

    #[test]
    fn absolute_video_stream_index() {
        let (_, args) = auto_args("h264", Some("aac"), 2, Some(1));
        assert!(has_pair(&args, "-map", "0:2"));
    }

    #[test]
    fn no_audio_omits_audio_map_and_codec() {
        let (plan, args) = auto_args("h264", None, 0, None);
        assert_eq!(plan.audio_codec, None);
        assert!(!args.iter().any(|a| a.contains("0:a")));
        assert!(!args.contains(&"-c:a".to_string()));
    }

    #[test]
    fn pcm_audio_encodes_aac() {
        for pcm in ["pcm_s16le", "pcm_bluray"] {
            let (plan, args) = auto_args("h264", Some(pcm), 0, Some(1));
            assert_eq!(plan.audio_codec.as_deref(), Some("aac"));
            assert_eq!(plan.audio_bsf, None);
            assert!(has_pair(&args, "-c:a", "aac"));
            assert!(!args.contains(&"-bsf:a".to_string()));
        }
    }

    #[test]
    fn auto_ignores_user_videotoolbox() {
        let h264 = choose_ts_codecs(
            "h264",
            Some("aac"),
            TsConvertMode::Auto,
            Some("h264_videotoolbox"),
            None,
            Some(18),
        )
        .unwrap();
        let args_h264 = args_for(&h264, 0, Some(1));
        assert_eq!(h264.video_codec, "copy");
        assert!(!args_h264.contains(&"-hwaccel".to_string()));

        let mpeg2 = choose_ts_codecs(
            "mpeg2video",
            Some("mp2"),
            TsConvertMode::Auto,
            Some("h264_videotoolbox"),
            None,
            Some(18),
        )
        .unwrap();
        let args_mpeg2 = args_for(&mpeg2, 0, Some(1));
        assert_eq!(mpeg2.video_codec, "libx264");
        assert_eq!(mpeg2.crf, Some(23));
        assert!(!args_mpeg2.contains(&"-hwaccel".to_string()));
        assert!(has_pair(&args_mpeg2, "-c:v", "libx264"));
    }

    #[test]
    fn mode_parse_rejects_unknown() {
        let err = TsConvertMode::parse(Some("foo")).unwrap_err();
        assert!(matches!(err, AppError::InvalidArgument(_)));
    }

    #[test]
    fn validate_video_index_must_be_video() {
        let streams = vec![stream(0, "audio", "aac"), stream(1, "video", "h264")];
        let err = validate_ts_streams(&streams, 0, None).unwrap_err();
        assert!(matches!(
            err,
            AppError::InvalidArgument(ref m) if m.contains("is not a video track")
        ));
    }

    #[test]
    fn validate_missing_index_errors() {
        let streams = vec![stream(0, "video", "h264"), stream(1, "audio", "aac")];
        assert!(validate_ts_streams(&streams, 9, None).is_err());
        assert!(validate_ts_streams(&streams, 0, Some(9)).is_err());
    }
}
