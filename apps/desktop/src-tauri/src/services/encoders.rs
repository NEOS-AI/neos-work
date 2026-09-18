/// Hardware encoder names we surface in the UI when FFmpeg reports them.
pub const KNOWN_HW_ENCODERS: &[&str] = &[
    "h264_videotoolbox",
    "hevc_videotoolbox",
    "prores_videotoolbox",
    "h264_nvenc",
    "hevc_nvenc",
    "av1_nvenc",
    "h264_qsv",
    "hevc_qsv",
    "av1_qsv",
    "vp9_qsv",
];

/// Software encoder to retry with when a hardware encoder fails at runtime.
pub fn software_fallback_codec(hw_codec: &str) -> &'static str {
    let c = hw_codec.to_ascii_lowercase();
    if c.contains("hevc") || c.contains("h265") {
        "libx265"
    } else if c.contains("vp9") {
        "libvpx-vp9"
    } else if c.contains("prores") {
        "prores_ks"
    } else {
        "libx264"
    }
}

/// Bitmap (image-based) subtitle codecs cannot use the `subtitles=` text filter.
pub fn is_bitmap_subtitle(codec: &str) -> bool {
    matches!(
        codec.to_ascii_lowercase().as_str(),
        "dvd_subtitle"
            | "dvdsub"
            | "hdmv_pgs_subtitle"
            | "pgssub"
            | "xsub"
            | "dvb_subtitle"
            | "dvbsub"
    )
}

/// Escape a filesystem path for an FFmpeg filtergraph argument.
pub fn escape_filter_path(path: &str) -> String {
    let mut s = path.replace('\\', "/");
    s = s.replace('\'', r"\'");
    s = s.replace(':', r"\:");
    s = s.replace('[', r"\[");
    s = s.replace(']', r"\]");
    s = s.replace(',', r"\,");
    s = s.replace(';', r"\;");
    format!("'{s}'")
}

/// Infer a decode `-hwaccel` name from an encoder codec string.
pub fn hwaccel_for_codec(codec: &str) -> Option<&'static str> {
    if codec.contains("videotoolbox") {
        Some("videotoolbox")
    } else if codec.contains("nvenc") {
        Some("cuda")
    } else if codec.contains("qsv") {
        Some("qsv")
    } else {
        None
    }
}

/// Map a 0–51 CRF-like quality value to VideoToolbox `-q:v` (1–100, higher is better).
pub fn crf_to_videotoolbox_q(crf: u8) -> u8 {
    let q = 100u32.saturating_sub((crf as u32 * 80) / 51);
    q.clamp(1, 100) as u8
}

/// Pick a subtitle encoder that the destination container will accept.
pub fn subtitle_codec_for_output(output: &str) -> &'static str {
    let ext = output
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "mp4" | "mov" | "m4v" => "mov_text",
        "webm" => "webvtt",
        "srt" => "srt",
        "ass" | "ssa" => "ass",
        "vtt" => "webvtt",
        _ => "copy",
    }
}

/// Parse `ffmpeg -encoders` stdout and return the known hardware encoders that appear.
pub fn parse_hw_encoders(encoders_output: &str) -> Vec<String> {
    let mut found = Vec::new();
    for line in encoders_output.lines() {
        for name in KNOWN_HW_ENCODERS {
            // Encoder table rows look like: " V..... h264_videotoolbox  VideoToolbox H.264 Encoder"
            let tokens: Vec<&str> = line.split_whitespace().collect();
            if tokens.iter().any(|t| t == name) && !found.iter().any(|e| e == name) {
                found.push((*name).to_string());
            }
        }
    }
    found
}

/// Parse `ffmpeg -hwaccels` stdout (one name per line after the header).
pub fn parse_hw_accels(hwaccels_output: &str) -> Vec<String> {
    hwaccels_output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.to_ascii_lowercase().contains("hardware"))
        .map(|s| s.to_string())
        .collect()
}

/// First line of `ffmpeg -version` / `ffprobe -version`.
pub fn parse_version_line(output: &str) -> Option<String> {
    output.lines().next().map(|s| s.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn software_fallback_picks_family() {
        assert_eq!(software_fallback_codec("hevc_videotoolbox"), "libx265");
        assert_eq!(software_fallback_codec("h264_nvenc"), "libx264");
        assert_eq!(software_fallback_codec("vp9_qsv"), "libvpx-vp9");
        assert_eq!(software_fallback_codec("prores_videotoolbox"), "prores_ks");
    }

    #[test]
    fn bitmap_subtitle_detection() {
        assert!(is_bitmap_subtitle("hdmv_pgs_subtitle"));
        assert!(is_bitmap_subtitle("dvdsub"));
        assert!(!is_bitmap_subtitle("subrip"));
        assert!(!is_bitmap_subtitle("ass"));
        assert!(!is_bitmap_subtitle("mov_text"));
    }

    #[test]
    fn filter_path_escaping() {
        assert_eq!(escape_filter_path("/tmp/foo.mkv"), "'/tmp/foo.mkv'");
        assert_eq!(
            escape_filter_path(r"C:\Media\clip:1.mkv"),
            r"'C\:/Media/clip\:1.mkv'"
        );
    }

    #[test]
    fn hwaccel_inference() {
        assert_eq!(hwaccel_for_codec("h264_videotoolbox"), Some("videotoolbox"));
        assert_eq!(hwaccel_for_codec("hevc_nvenc"), Some("cuda"));
        assert_eq!(hwaccel_for_codec("h264_qsv"), Some("qsv"));
        assert_eq!(hwaccel_for_codec("libx264"), None);
        assert_eq!(hwaccel_for_codec("copy"), None);
    }

    #[test]
    fn videotoolbox_quality_mapping() {
        assert_eq!(crf_to_videotoolbox_q(0), 100);
        assert_eq!(crf_to_videotoolbox_q(51), 20);
        let mid = crf_to_videotoolbox_q(23);
        assert!(mid > 20 && mid < 100);
    }

    #[test]
    fn subtitle_codec_by_extension() {
        assert_eq!(subtitle_codec_for_output("/tmp/out.mp4"), "mov_text");
        assert_eq!(subtitle_codec_for_output("clip.MOV"), "mov_text");
        assert_eq!(subtitle_codec_for_output("a.webm"), "webvtt");
        assert_eq!(subtitle_codec_for_output("subs.srt"), "srt");
        assert_eq!(subtitle_codec_for_output("subs.ass"), "ass");
        assert_eq!(subtitle_codec_for_output("movie.mkv"), "copy");
    }

    #[test]
    fn parse_encoder_table() {
        let sample = "\
Encoders:
 V..... libx264              libx264 H.264
 V..... h264_videotoolbox    VideoToolbox H.264 Encoder
 A..... aac                  AAC
 V..... hevc_nvenc           NVIDIA NVENC hevc
";
        let found = parse_hw_encoders(sample);
        assert_eq!(
            found,
            vec![
                "h264_videotoolbox".to_string(),
                "hevc_nvenc".to_string()
            ]
        );
    }

    #[test]
    fn parse_hwaccels_skips_header() {
        let sample = "Hardware acceleration methods:\nvideotoolbox\nvideotoolbox_vld\n";
        let found = parse_hw_accels(sample);
        assert_eq!(found, vec!["videotoolbox", "videotoolbox_vld"]);
    }
}
