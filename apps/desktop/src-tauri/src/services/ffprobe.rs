use serde_json::Value;
use tauri::AppHandle;

use crate::models::error::AppError;
use crate::models::video_info::{FormatInfo, StreamInfo, VideoInfo};
use crate::services::sidecar::output_ffprobe;

pub struct FFprobeService;

impl FFprobeService {
    /// Probe a media file and return structured metadata.
    pub async fn probe(app: &AppHandle, file_path: &str) -> Result<VideoInfo, AppError> {
        let args = [
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            file_path,
        ];

        let (ok, stdout, _source) = output_ffprobe(app, &args).await?;
        if !ok {
            return Err(AppError::Ffprobe(
                "ffprobe exited with a non-zero status".into(),
            ));
        }

        let json: Value = serde_json::from_str(&stdout)?;
        parse_probe_output(&json)
    }
}

pub(crate) fn parse_probe_output(json: &Value) -> Result<VideoInfo, AppError> {
    let format_obj = json
        .get("format")
        .ok_or_else(|| AppError::Ffprobe("missing 'format' key".to_string()))?;

    let format = FormatInfo {
        filename: format_obj["filename"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        format_name: format_obj["format_name"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        format_long_name: format_obj["format_long_name"]
            .as_str()
            .unwrap_or("")
            .to_string(),
        duration: format_obj["duration"]
            .as_str()
            .and_then(|s| s.parse().ok()),
        bit_rate: format_obj["bit_rate"]
            .as_str()
            .and_then(|s| s.parse().ok()),
        size: format_obj["size"].as_str().and_then(|s| s.parse().ok()),
    };

    let streams = json["streams"]
        .as_array()
        .map(|arr| arr.iter().map(parse_stream).collect())
        .unwrap_or_default();

    Ok(VideoInfo { format, streams })
}

fn parse_stream(v: &Value) -> StreamInfo {
    let tags = v.get("tags");
    StreamInfo {
        index: v["index"].as_u64().unwrap_or(0) as u32,
        codec_type: v["codec_type"].as_str().unwrap_or("unknown").to_string(),
        codec_name: v["codec_name"].as_str().unwrap_or("unknown").to_string(),
        codec_long_name: v["codec_long_name"].as_str().map(|s| s.to_string()),
        width: v["width"].as_u64().map(|n| n as u32),
        height: v["height"].as_u64().map(|n| n as u32),
        rotation: parse_rotation(v),
        r_frame_rate: v["r_frame_rate"].as_str().map(|s| s.to_string()),
        avg_frame_rate: v["avg_frame_rate"].as_str().map(|s| s.to_string()),
        pix_fmt: v["pix_fmt"].as_str().map(|s| s.to_string()),
        sample_rate: v["sample_rate"].as_str().map(|s| s.to_string()),
        channels: v["channels"].as_u64().map(|n| n as u32),
        channel_layout: v["channel_layout"].as_str().map(|s| s.to_string()),
        bit_rate: v["bit_rate"].as_str().map(|s| s.to_string()),
        duration: v["duration"].as_str().map(|s| s.to_string()),
        language: tag_value(tags, "language"),
        title: tag_value(tags, "title"),
    }
}

fn parse_rotation(v: &Value) -> Option<f64> {
    if let Some(list) = v.get("side_data_list").and_then(|x| x.as_array()) {
        for sd in list {
            if let Some(r) = sd.get("rotation").and_then(json_f64) {
                return Some(r);
            }
        }
    }
    tag_value(v.get("tags"), "rotate").and_then(|s| s.parse().ok())
}

fn json_f64(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_i64().map(|n| n as f64))
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
}

fn tag_value(tags: Option<&Value>, key: &str) -> Option<String> {
    tags.and_then(|t| t.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_language_and_title_tags() {
        let json = json!({
            "format": {
                "filename": "a.mkv",
                "format_name": "matroska",
                "format_long_name": "Matroska",
                "duration": "12.5",
                "bit_rate": "1000",
                "size": "2048"
            },
            "streams": [{
                "index": 2,
                "codec_type": "subtitle",
                "codec_name": "subrip",
                "tags": { "language": "eng", "title": "English" }
            }]
        });
        let info = parse_probe_output(&json).unwrap();
        assert_eq!(info.format.duration, Some(12.5));
        assert_eq!(info.streams[0].index, 2);
        assert_eq!(info.streams[0].language.as_deref(), Some("eng"));
        assert_eq!(info.streams[0].title.as_deref(), Some("English"));
    }

    #[test]
    fn parses_displaymatrix_rotation() {
        let json = json!({
            "format": { "filename": "a.mp4", "format_name": "mov", "format_long_name": "QuickTime" },
            "streams": [{
                "index": 0,
                "codec_type": "video",
                "codec_name": "h264",
                "width": 640,
                "height": 480,
                "side_data_list": [{
                    "side_data_type": "Display Matrix",
                    "rotation": -90
                }]
            }]
        });
        let info = parse_probe_output(&json).unwrap();
        assert_eq!(info.streams[0].rotation, Some(-90.0));
        assert_eq!(info.streams[0].display_size(), Some((480, 640)));
    }
}
