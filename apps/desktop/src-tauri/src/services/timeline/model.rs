use serde::{Deserialize, Serialize};

pub const TIMELINE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineProject {
    pub version: u32,
    pub name: String,
    pub fps: f64,
    pub width: u32,
    pub height: u32,
    pub sample_rate: u32,
    pub tracks: Vec<TimelineTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineTrack {
    pub id: String,
    pub kind: TrackKind,
    pub name: String,
    pub muted: bool,
    pub clips: Vec<TimelineClip>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TrackKind {
    Video,
    Audio,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineClip {
    pub id: String,
    pub source_path: String,
    /// Source seconds, inclusive start.
    pub source_in: f64,
    /// Source seconds, exclusive end. Must be > source_in.
    pub source_out: f64,
    /// Timeline seconds where this clip starts.
    pub timeline_start: f64,
    /// Reserved. Phase 1 must be empty. Unknown items → validate error.
    #[serde(default)]
    pub effects: Vec<ClipEffect>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenderProfile {
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub video_codec: String,
    pub audio_codec: String,
    pub crf: Option<u8>,
    pub video_bitrate: Option<String>,
    pub preset: Option<String>,
    pub audio_bitrate: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimelineValidation {
    pub duration_secs: f64,
    pub warnings: Vec<String>,
}

/// Effect payload is open so unknown items still deserialize and fail in validate.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClipEffect {
    #[serde(rename = "type")]
    pub kind: String,
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl TimelineClip {
    pub fn source_duration(&self) -> f64 {
        self.source_out - self.source_in
    }
    pub fn timeline_end(&self) -> f64 {
        self.timeline_start + self.source_duration()
    }
}

impl TimelineProject {
    pub fn duration_secs(&self) -> f64 {
        self.tracks
            .iter()
            .flat_map(|t| t.clips.iter())
            .map(TimelineClip::timeline_end)
            .fold(0.0_f64, f64::max)
    }
}

impl RenderProfile {
    /// Phase 1 export default.
    pub fn export(project: &TimelineProject) -> Self {
        Self {
            width: project.width,
            height: project.height,
            fps: project.fps,
            video_codec: "libx264".into(),
            audio_codec: "aac".into(),
            crf: Some(23),
            video_bitrate: None,
            preset: Some("medium".into()),
            audio_bitrate: Some("192k".into()),
        }
    }

    /// Phase 2. Do not call from Phase 1 UI.
    pub fn proxy(project: &TimelineProject) -> Self {
        let w = 640u32;
        let h = ((project.height as f64) * (640.0 / project.width as f64)).round() as u32;
        let h = if h % 2 == 0 { h } else { h + 1 };
        Self {
            width: w,
            height: h.max(2),
            fps: project.fps.min(30.0),
            video_codec: "libx264".into(),
            audio_codec: "aac".into(),
            crf: Some(28),
            video_bitrate: None,
            preset: Some("ultrafast".into()),
            audio_bitrate: Some("96k".into()),
        }
    }
}
