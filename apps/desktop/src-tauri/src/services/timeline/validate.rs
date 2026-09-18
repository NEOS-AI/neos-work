use std::collections::HashSet;

use crate::models::error::AppError;
use crate::services::timeline::model::{
    TimelineProject, TimelineValidation, TrackKind, TIMELINE_VERSION,
};

pub fn validate(project: &TimelineProject) -> Result<TimelineValidation, AppError> {
    if project.version != TIMELINE_VERSION {
        return Err(AppError::InvalidArgument(format!(
            "unsupported timeline version {} (expected {TIMELINE_VERSION})",
            project.version
        )));
    }

    if !(project.fps > 0.0 && project.fps <= 120.0) {
        return Err(AppError::InvalidArgument(format!(
            "fps must be in (0, 120], got {}",
            project.fps
        )));
    }

    if project.width < 2 || project.width % 2 != 0 {
        return Err(AppError::InvalidArgument(format!(
            "width must be even and >= 2, got {}",
            project.width
        )));
    }
    if project.height < 2 || project.height % 2 != 0 {
        return Err(AppError::InvalidArgument(format!(
            "height must be even and >= 2, got {}",
            project.height
        )));
    }

    if project.sample_rate != 44100 && project.sample_rate != 48000 {
        return Err(AppError::InvalidArgument(format!(
            "sample_rate must be 44100 or 48000, got {}",
            project.sample_rate
        )));
    }

    let video_tracks = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Video)
        .count();
    let audio_tracks = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Audio)
        .count();
    if video_tracks != 1 || audio_tracks > 1 {
        return Err(AppError::InvalidArgument(
            "phase 1 supports one video track and at most one audio track".into(),
        ));
    }

    let mut track_ids = HashSet::new();
    let mut clip_ids = HashSet::new();

    for track in &project.tracks {
        if !track_ids.insert(track.id.as_str()) {
            return Err(AppError::InvalidArgument(format!(
                "duplicate track id '{}'",
                track.id
            )));
        }

        // Half-open ranges [start, end); sort then ensure next.start >= prev.end.
        let mut ranges: Vec<(f64, f64, &str)> = Vec::with_capacity(track.clips.len());

        for clip in &track.clips {
            if !clip_ids.insert(clip.id.as_str()) {
                return Err(AppError::InvalidArgument(format!(
                    "duplicate clip id '{}'",
                    clip.id
                )));
            }

            if clip.source_path.is_empty() {
                return Err(AppError::InvalidArgument(format!(
                    "clip '{}' source_path must be non-empty",
                    clip.id
                )));
            }
            if clip.source_in < 0.0 {
                return Err(AppError::InvalidArgument(format!(
                    "clip '{}' source_in must be >= 0",
                    clip.id
                )));
            }
            if clip.source_out <= clip.source_in {
                return Err(AppError::InvalidArgument(format!(
                    "clip '{}' source_out must be > source_in",
                    clip.id
                )));
            }
            if clip.timeline_start < 0.0 {
                return Err(AppError::InvalidArgument(format!(
                    "clip '{}' timeline_start must be >= 0",
                    clip.id
                )));
            }
            if !clip.effects.is_empty() {
                return Err(AppError::InvalidArgument(
                    "clip effects are not supported yet".into(),
                ));
            }

            ranges.push((clip.timeline_start, clip.timeline_end(), clip.id.as_str()));
        }

        ranges.sort_by(|a, b| a.0.total_cmp(&b.0));
        for window in ranges.windows(2) {
            let (start_a, end_a, id_a) = window[0];
            let (start_b, _end_b, id_b) = window[1];
            if start_b < end_a {
                return Err(AppError::InvalidArgument(format!(
                    "clips '{id_a}' and '{id_b}' overlap on track '{}' ([{start_a}, {end_a}) vs start {start_b})",
                    track.id
                )));
            }
        }
    }

    Ok(TimelineValidation {
        duration_secs: project.duration_secs(),
        warnings: vec![],
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::timeline::model::{
        ClipEffect, RenderProfile, TimelineClip, TimelineTrack, TrackKind,
    };

    fn base_project(tracks: Vec<TimelineTrack>) -> TimelineProject {
        TimelineProject {
            version: TIMELINE_VERSION,
            name: "test".into(),
            fps: 30.0,
            width: 1920,
            height: 1080,
            sample_rate: 48000,
            tracks,
        }
    }

    fn video_track(id: &str, clips: Vec<TimelineClip>) -> TimelineTrack {
        TimelineTrack {
            id: id.into(),
            kind: TrackKind::Video,
            name: "V1".into(),
            muted: false,
            clips,
        }
    }

    fn audio_track(id: &str, clips: Vec<TimelineClip>) -> TimelineTrack {
        TimelineTrack {
            id: id.into(),
            kind: TrackKind::Audio,
            name: "A1".into(),
            muted: false,
            clips,
        }
    }

    fn clip(id: &str, start: f64, source_in: f64, source_out: f64) -> TimelineClip {
        TimelineClip {
            id: id.into(),
            source_path: "/tmp/a.mp4".into(),
            source_in,
            source_out,
            timeline_start: start,
            effects: vec![],
        }
    }

    #[test]
    fn same_track_overlap_is_error() {
        let project = base_project(vec![video_track(
            "v1",
            vec![clip("c1", 0.0, 0.0, 2.0), clip("c2", 1.0, 0.0, 1.0)],
        )]);
        assert!(validate(&project).is_err());
    }

    #[test]
    fn empty_timeline_duration_is_zero() {
        let project = base_project(vec![video_track("v1", vec![])]);
        assert_eq!(project.duration_secs(), 0.0);
        let v = validate(&project).expect("empty video track should validate");
        assert_eq!(v.duration_secs, 0.0);
        assert!(v.warnings.is_empty());
    }

    #[test]
    fn non_empty_effects_rejected() {
        let mut c = clip("c1", 0.0, 0.0, 1.0);
        c.effects.push(ClipEffect {
            kind: "fade".into(),
            extra: serde_json::Map::new(),
        });
        let project = base_project(vec![video_track("v1", vec![c])]);
        let err = validate(&project).expect_err("effects must fail");
        assert!(
            err.to_string()
                .contains("clip effects are not supported yet")
        );
    }

    #[test]
    fn two_video_tracks_rejected() {
        let project = base_project(vec![
            video_track("v1", vec![]),
            video_track("v2", vec![]),
        ]);
        let err = validate(&project).expect_err("two video tracks must fail");
        assert_eq!(
            err.to_string(),
            "Invalid argument: phase 1 supports one video track and at most one audio track"
        );
    }

    #[test]
    fn two_clips_with_gap_duration_and_ok() {
        // clip A [0,1) at t=0, clip B [0,1) at t=2 → duration 3.0
        let project = base_project(vec![video_track(
            "v1",
            vec![clip("a", 0.0, 0.0, 1.0), clip("b", 2.0, 0.0, 1.0)],
        )]);
        assert_eq!(project.duration_secs(), 3.0);
        let v = validate(&project).expect("gapped clips should validate");
        assert_eq!(v.duration_secs, 3.0);
    }

    #[test]
    fn render_profile_export_and_proxy() {
        let project = base_project(vec![video_track("v1", vec![])]);
        let export = RenderProfile::export(&project);
        assert_eq!(export.width, 1920);
        assert_eq!(export.height, 1080);
        assert_eq!(export.fps, 30.0);
        assert_eq!(export.preset.as_deref(), Some("medium"));

        let proxy = RenderProfile::proxy(&project);
        assert_eq!(proxy.width, 640);
        assert_eq!(proxy.preset.as_deref(), Some("ultrafast"));
        // 1080 * (640/1920) = 360 even
        assert_eq!(proxy.height, 360);
        assert_eq!(proxy.fps, 30.0);
    }

    #[test]
    fn odd_width_rejected() {
        let mut project = base_project(vec![video_track("v1", vec![])]);
        project.width = 1921;
        assert!(validate(&project).is_err());
    }

    #[test]
    fn fps_zero_rejected() {
        let mut project = base_project(vec![video_track("v1", vec![])]);
        project.fps = 0.0;
        assert!(validate(&project).is_err());
    }

    #[test]
    fn missing_version_fails_deserialize() {
        let json = r#"{
            "name": "x",
            "fps": 30.0,
            "width": 1920,
            "height": 1080,
            "sample_rate": 48000,
            "tracks": []
        }"#;
        let err = serde_json::from_str::<TimelineProject>(json).unwrap_err();
        assert!(err.to_string().contains("version") || err.is_data());
    }

    #[test]
    fn version_mismatch_rejected() {
        let mut project = base_project(vec![video_track("v1", vec![])]);
        project.version = 99;
        assert!(validate(&project).is_err());
    }

    #[test]
    fn sample_rate_must_be_44100_or_48000() {
        let mut project = base_project(vec![video_track("v1", vec![])]);
        project.sample_rate = 22050;
        assert!(validate(&project).is_err());
    }

    #[test]
    fn one_video_and_one_audio_ok() {
        let project = base_project(vec![
            video_track("v1", vec![clip("c1", 0.0, 0.0, 1.0)]),
            audio_track("a1", vec![clip("c2", 0.0, 0.0, 1.0)]),
        ]);
        assert!(validate(&project).is_ok());
    }

    #[test]
    fn adjacent_clips_do_not_overlap() {
        // [0,1) and [1,2) touch at 1 but half-open so OK
        let project = base_project(vec![video_track(
            "v1",
            vec![clip("a", 0.0, 0.0, 1.0), clip("b", 1.0, 0.0, 1.0)],
        )]);
        assert!(validate(&project).is_ok());
    }

    #[test]
    fn duplicate_clip_ids_rejected() {
        let project = base_project(vec![video_track(
            "v1",
            vec![clip("same", 0.0, 0.0, 1.0), clip("same", 2.0, 0.0, 1.0)],
        )]);
        assert!(validate(&project).is_err());
    }

    #[test]
    fn empty_source_path_rejected() {
        let mut c = clip("c1", 0.0, 0.0, 1.0);
        c.source_path = "".into();
        let project = base_project(vec![video_track("v1", vec![c])]);
        assert!(validate(&project).is_err());
    }

    #[test]
    fn zero_video_tracks_rejected() {
        let project = base_project(vec![]);
        let err = validate(&project).expect_err("need exactly one video track");
        assert_eq!(
            err.to_string(),
            "Invalid argument: phase 1 supports one video track and at most one audio track"
        );
    }
}
