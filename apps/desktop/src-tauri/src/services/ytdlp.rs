use crate::models::error::AppError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DownloadQuality {
    Best,
    Height(u32),
}

impl DownloadQuality {
    pub fn parse(raw: &str) -> Result<Self, AppError> {
        match raw.trim() {
            "best" => Ok(Self::Best),
            "1080" => Ok(Self::Height(1080)),
            "720" => Ok(Self::Height(720)),
            other => Err(AppError::InvalidArgument(format!(
                "quality must be best, 1080, or 720 (got {other})"
            ))),
        }
    }

    pub fn format_spec(self) -> &'static str {
        match self {
            Self::Best => "bv*+ba/b",
            Self::Height(1080) => "bv*[height<=1080]+ba/b[height<=1080]",
            Self::Height(720) => "bv*[height<=720]+ba/b[height<=720]",
            Self::Height(_) => "bv*+ba/b",
        }
    }
}

const ALLOWED_HOSTS: &[&str] = &[
    "youtube.com",
    "m.youtube.com",
    "music.youtube.com",
    "youtu.be",
    "youtube-nocookie.com",
];

/// Phase 1: a single public watch/shorts/embed/live URL with a video id.
pub fn validate_youtube_video_url(raw: &str) -> Result<String, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidArgument("url must not be empty".into()));
    }
    let (host, path, query) = split_url(trimmed)?;
    let host = normalize_host(&host);
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(AppError::InvalidArgument(
            "only YouTube URLs are supported".into(),
        ));
    }
    if path.to_ascii_lowercase().starts_with("/playlist") {
        return Err(AppError::InvalidArgument(
            "playlists are not supported yet".into(),
        ));
    }
    if extract_video_id(&host, &path, &query).is_some() {
        return Ok(trimmed.to_string());
    }
    if query_param(&query, "list").is_some() {
        return Err(AppError::InvalidArgument(
            "playlists are not supported yet".into(),
        ));
    }
    Err(AppError::InvalidArgument(
        "URL must point to a single YouTube video".into(),
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum YoutubeUrlKind {
    Video,
    Playlist,
}

pub fn classify_youtube_url(raw: &str) -> Result<YoutubeUrlKind, AppError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidArgument("url must not be empty".into()));
    }
    let (host, path, query) = split_url(trimmed)?;
    let host = normalize_host(&host);
    if !ALLOWED_HOSTS.contains(&host.as_str()) {
        return Err(AppError::InvalidArgument(
            "only YouTube URLs are supported".into(),
        ));
    }
    if path.to_ascii_lowercase().starts_with("/playlist") {
        return Ok(YoutubeUrlKind::Playlist);
    }
    if extract_video_id(&host, &path, &query).is_some() {
        return Ok(YoutubeUrlKind::Video);
    }
    if query_param(&query, "list").is_some() {
        return Ok(YoutubeUrlKind::Playlist);
    }
    Err(AppError::InvalidArgument(
        "URL must point to a single YouTube video".into(),
    ))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedUrlLine {
    pub raw: String,
    pub kind: Option<YoutubeUrlKind>,
    pub video_id: Option<String>,
    pub error: Option<String>,
}

pub fn parse_url_lines(text: &str) -> Vec<ParsedUrlLine> {
    text.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(|raw| match classify_youtube_url(raw) {
            Ok(YoutubeUrlKind::Video) => {
                let video_id = split_url(raw).ok().and_then(|(host, path, query)| {
                    extract_video_id(&normalize_host(&host), &path, &query)
                });
                ParsedUrlLine {
                    raw: raw.to_string(),
                    kind: Some(YoutubeUrlKind::Video),
                    video_id,
                    error: None,
                }
            }
            Ok(YoutubeUrlKind::Playlist) => ParsedUrlLine {
                raw: raw.to_string(),
                kind: Some(YoutubeUrlKind::Playlist),
                video_id: None,
                error: Some("playlists cannot be mixed into a URL list".into()),
            },
            Err(e) => ParsedUrlLine {
                raw: raw.to_string(),
                kind: None,
                video_id: None,
                error: Some(e.to_string()),
            },
        })
        .collect()
}

pub fn watch_url_for_id(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}")
}

pub fn build_flat_playlist_args(url: &str) -> Vec<String> {
    vec![
        "--flat-playlist".into(),
        "-J".into(),
        "--no-download".into(),
        "--no-warnings".into(),
        url.into(),
    ]
}

#[derive(Debug, Clone, PartialEq)]
pub struct PlaylistEntry {
    pub id: String,
    pub title: String,
    pub duration_secs: Option<f64>,
    pub uploader: Option<String>,
}

pub fn parse_flat_playlist(json: &str) -> Result<(Option<String>, Vec<PlaylistEntry>), AppError> {
    let blob = extract_json_object(json)
        .ok_or_else(|| AppError::Ytdlp("yt-dlp playlist metadata is not JSON".into()))?;
    let value: serde_json::Value = serde_json::from_str(blob)?;
    let title = value
        .get("title")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let mut entries = Vec::new();
    if let Some(arr) = value.get("entries").and_then(|v| v.as_array()) {
        for item in arr {
            if item.is_null() {
                continue;
            }
            let id = item
                .get("id")
                .and_then(|v| v.as_str())
                .filter(|s| is_video_id(s))
                .map(str::to_string);
            let Some(id) = id else {
                continue;
            };
            let entry_title = item
                .get("title")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .unwrap_or("YouTube video")
                .to_string();
            let duration_secs = item
                .get("duration")
                .and_then(|v| v.as_f64())
                .filter(|d| *d > 0.0);
            let uploader = item
                .get("uploader")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(str::to_string);
            entries.push(PlaylistEntry {
                id,
                title: entry_title,
                duration_secs,
                uploader,
            });
        }
    }
    if entries.is_empty() {
        return Err(AppError::Ytdlp("playlist has no video entries".into()));
    }
    Ok((title, entries))
}

fn extract_json_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let end = s.rfind('}')?;
    if end < start {
        None
    } else {
        Some(&s[start..=end])
    }
}

pub fn build_probe_args(url: &str) -> Vec<String> {
    vec![
        "-J".into(),
        "--no-download".into(),
        "--no-playlist".into(),
        "--no-warnings".into(),
        url.into(),
    ]
}

pub fn build_download_args(
    url: &str,
    output_template: &str,
    quality: DownloadQuality,
    ffmpeg_location: Option<&str>,
) -> Result<Vec<String>, AppError> {
    if output_template.trim().is_empty() {
        return Err(AppError::InvalidArgument(
            "output_dir must not be empty".into(),
        ));
    }
    let mut args = vec![
        "--no-playlist".into(),
        "--newline".into(),
        "--progress".into(),
        "--no-warnings".into(),
        "--no-overwrites".into(),
        "--merge-output-format".into(),
        "mp4".into(),
        "-f".into(),
        quality.format_spec().into(),
        "--print".into(),
        "after_move:filepath".into(),
        "-o".into(),
        output_template.into(),
    ];
    if let Some(loc) = ffmpeg_location.filter(|s| !s.is_empty()) {
        args.push("--ffmpeg-location".into());
        args.push(loc.into());
    }
    args.push(url.into());
    Ok(args)
}

pub fn output_template_for_dir(output_dir: &str) -> String {
    let dir = output_dir.trim_end_matches(['/', '\\']);
    format!("{dir}/%(title).200B [%(id)s].%(ext)s")
}

pub fn parse_ytdlp_percent(line: &str) -> Option<f64> {
    let line = line.trim();
    if !line.contains("[download]") || !line.contains('%') {
        return None;
    }
    let after = line.split("[download]").nth(1)?;
    let token = after.split('%').next()?.split_whitespace().last()?;
    let value: f64 = token.parse().ok()?;
    if value.is_finite() {
        Some(value.clamp(0.0, 100.0))
    } else {
        None
    }
}

/// Last `[download] N%` in a possibly multi-line / `\r`-rewritten chunk.
pub fn parse_ytdlp_percent_from_output(text: &str) -> Option<f64> {
    text.split(['\n', '\r']).rev().find_map(parse_ytdlp_percent)
}

pub fn parse_destination_path(line: &str) -> Option<String> {
    let line = line.trim();
    if let Some(rest) = line.strip_prefix("[download] Destination: ") {
        return Some(rest.trim().to_string());
    }
    if let Some(rest) = line.strip_prefix("[Merger] Merging formats into ") {
        return Some(rest.trim().trim_matches('"').to_string());
    }
    if line.starts_with('[') || line.is_empty() {
        return None;
    }
    if line.contains('/') || line.contains('\\') {
        return Some(line.to_string());
    }
    None
}

fn split_url(raw: &str) -> Result<(String, String, String), AppError> {
    let rest = if let Some(r) = raw.strip_prefix("https://") {
        r
    } else if let Some(r) = raw.strip_prefix("http://") {
        r
    } else {
        return Err(AppError::InvalidArgument(
            "url must be http or https".into(),
        ));
    };
    let (host_path, query) = rest.split_once('?').unwrap_or((rest, ""));
    let query = query.split('#').next().unwrap_or(query);
    let host_path = host_path.split('#').next().unwrap_or(host_path);
    let (host, path) = host_path.split_once('/').unwrap_or((host_path, ""));
    if host.is_empty() {
        return Err(AppError::InvalidArgument("url host is empty".into()));
    }
    Ok((host.to_string(), format!("/{path}"), query.to_string()))
}

fn normalize_host(host: &str) -> String {
    let h = host.trim().trim_end_matches('.').to_ascii_lowercase();
    h.strip_prefix("www.").unwrap_or(&h).to_string()
}

fn query_param(query: &str, key: &str) -> Option<String> {
    for pair in query.split('&') {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        if k == key && !v.is_empty() {
            return Some(v.to_string());
        }
    }
    None
}

fn extract_video_id(host: &str, path: &str, query: &str) -> Option<String> {
    if host == "youtu.be" {
        return first_segment(path).filter(|id| is_video_id(id));
    }
    if let Some(v) = query_param(query, "v").filter(|id| is_video_id(id)) {
        return Some(v);
    }
    for prefix in ["/shorts/", "/embed/", "/live/"] {
        if let Some(rest) = path_ci_strip(path, prefix) {
            let id = rest.split('/').next().unwrap_or("");
            if is_video_id(id) {
                return Some(id.to_string());
            }
        }
    }
    None
}

fn path_ci_strip<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if path.len() >= prefix.len() && path[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&path[prefix.len()..])
    } else {
        None
    }
}

fn first_segment(path: &str) -> Option<String> {
    let seg = path.trim_start_matches('/').split('/').next().unwrap_or("");
    if seg.is_empty() {
        None
    } else {
        Some(seg.to_string())
    }
}

fn is_video_id(id: &str) -> bool {
    let n = id.len();
    (n >= 10 && n <= 12)
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_watch_and_short_forms() {
        for url in [
            "https://www.youtube.com/watch?v=dQw4w9wgBcQ",
            "https://youtu.be/dQw4w9wgBcQ",
            "https://youtube.com/shorts/dQw4w9wgBcQ",
            "https://www.youtube.com/embed/dQw4w9wgBcQ",
            "https://www.youtube.com/live/dQw4w9wgBcQ",
            "https://m.youtube.com/watch?v=dQw4w9wgBcQ",
            "https://music.youtube.com/watch?v=dQw4w9wgBcQ",
            "https://www.youtube.com/watch?v=dQw4w9wgBcQ&list=PLtest",
            "https://youtu.be/dQw4w9wgBcQ?list=PLtest",
            "https://youtube.com/shorts/dQw4w9wgBcQ?list=PLtest",
            "https://www.youtube.com/embed/dQw4w9wgBcQ?list=PLtest",
            "https://www.youtube.com/live/dQw4w9wgBcQ?list=PLtest",
        ] {
            validate_youtube_video_url(url).unwrap_or_else(|e| panic!("{url}: {e}"));
        }
    }

    #[test]
    fn rejects_non_youtube_and_playlist_only() {
        let err = validate_youtube_video_url("https://vimeo.com/123").unwrap_err();
        assert!(err.to_string().contains("only YouTube URLs are supported"));
        let err =
            validate_youtube_video_url("https://www.youtube.com/playlist?list=PLtest").unwrap_err();
        assert!(err.to_string().contains("playlists are not supported yet"));
        let err =
            validate_youtube_video_url("https://www.youtube.com/watch?list=PLtest").unwrap_err();
        assert!(err.to_string().contains("playlists are not supported yet"));
        assert!(validate_youtube_video_url("file:///tmp/x").is_err());
        assert!(validate_youtube_video_url("").is_err());
    }

    #[test]
    fn classify_playlist_and_batch_lines() {
        assert_eq!(
            classify_youtube_url("https://www.youtube.com/playlist?list=PLtest").unwrap(),
            YoutubeUrlKind::Playlist
        );
        assert_eq!(
            classify_youtube_url("https://music.youtube.com/playlist?list=PLtest").unwrap(),
            YoutubeUrlKind::Playlist
        );
        assert_eq!(
            classify_youtube_url("https://www.youtube.com/watch?list=PLtest").unwrap(),
            YoutubeUrlKind::Playlist
        );
        assert_eq!(
            classify_youtube_url("https://youtu.be/dQw4w9wgBcQ?list=PLtest").unwrap(),
            YoutubeUrlKind::Video
        );
        assert_eq!(
            watch_url_for_id("dQw4w9wgBcQ"),
            "https://www.youtube.com/watch?v=dQw4w9wgBcQ"
        );
        let lines = parse_url_lines(
            "https://youtu.be/dQw4w9wgBcQ\n\nhttps://vimeo.com/1\nhttps://www.youtube.com/playlist?list=PLtest\n",
        );
        assert_eq!(lines.len(), 3);
        assert!(lines[0].error.is_none());
        assert_eq!(lines[0].video_id.as_deref(), Some("dQw4w9wgBcQ"));
        assert!(lines[1].error.is_some());
        assert!(lines[2].error.as_deref().unwrap().contains("mixed"));
    }

    #[test]
    fn parse_flat_playlist_skips_nulls() {
        let json = r#"{
          "title": "Mix",
          "entries": [
            null,
            {"id": "dQw4w9wgBcQ", "title": "A", "duration": 10.0},
            {"id": "bad", "title": "skip"},
            {"id": "abcdefghijk", "title": "B"}
          ]
        }"#;
        let (title, entries) = parse_flat_playlist(json).unwrap();
        assert_eq!(title.as_deref(), Some("Mix"));
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].id, "dQw4w9wgBcQ");
        assert_eq!(entries[1].title, "B");
        let err =
            parse_flat_playlist(r#"{"title":"Empty","entries":[null,{"id":"bad"}]}"#).unwrap_err();
        assert!(err.to_string().contains("no video entries"));
    }

    #[test]
    fn flat_playlist_args_keep_playlist_mode() {
        let args = build_flat_playlist_args("https://www.youtube.com/playlist?list=PLtest");
        let joined = args.join(" ");
        assert!(args.contains(&"--flat-playlist".into()));
        assert!(args.contains(&"-J".into()));
        assert!(!joined.contains("--no-playlist"));
        assert!(!joined.contains("cookies"));
    }

    #[test]
    fn download_args_have_no_cookies_and_include_ffmpeg() {
        let args = build_download_args(
            "https://youtu.be/dQw4w9wgBcQ",
            "/tmp/out/%(title).200B [%(id)s].%(ext)s",
            DownloadQuality::Height(1080),
            Some("/opt/ffmpeg"),
        )
        .unwrap();
        let joined = args.join(" ");
        assert!(!joined.contains("cookies"));
        assert!(!joined.contains("username"));
        assert!(args.contains(&"--ffmpeg-location".into()));
        assert!(args.contains(&"/opt/ffmpeg".into()));
        assert!(args.contains(&"bv*[height<=1080]+ba/b[height<=1080]".into()));
        assert!(args.contains(&"--no-playlist".into()));
        assert!(args.contains(&"--no-overwrites".into()));
        assert!(args.contains(&"--progress".into()));
        assert!(args.contains(&"--newline".into()));
    }

    #[test]
    fn parse_percent_from_newline_progress() {
        let line = "[download]  12.3% of  10.00MiB at  1.20MiB/s ETA 00:08";
        assert_eq!(parse_ytdlp_percent(line), Some(12.3));
        assert_eq!(parse_ytdlp_percent("Merging formats"), None);
    }

    #[test]
    fn parse_percent_from_chunk_uses_latest_line() {
        let chunk = "[download] Destination: /tmp/clip.webm\n[download]  12.3% of  10.00MiB at  1.20MiB/s ETA 00:08\r[download]  40.0% of  10.00MiB at  2.00MiB/s ETA 00:03\n";
        assert_eq!(parse_ytdlp_percent_from_output(chunk), Some(40.0));
        assert_eq!(parse_ytdlp_percent(chunk), None);
    }

    #[test]
    fn parse_destination_from_progress_and_merger() {
        assert_eq!(
            parse_destination_path("[download] Destination: /tmp/clip.webm").as_deref(),
            Some("/tmp/clip.webm")
        );
        assert_eq!(
            parse_destination_path("[Merger] Merging formats into \"/tmp/clip.mp4\"").as_deref(),
            Some("/tmp/clip.mp4")
        );
        assert_eq!(
            parse_destination_path("/tmp/final clip.mp4").as_deref(),
            Some("/tmp/final clip.mp4")
        );
    }

    #[test]
    fn quality_parse() {
        assert!(matches!(
            DownloadQuality::parse("best"),
            Ok(DownloadQuality::Best)
        ));
        assert!(matches!(
            DownloadQuality::parse("1080"),
            Ok(DownloadQuality::Height(1080))
        ));
        assert!(DownloadQuality::parse("4k").is_err());
    }
}
