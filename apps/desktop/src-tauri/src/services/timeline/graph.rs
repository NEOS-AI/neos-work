use std::collections::HashMap;

use crate::models::error::AppError;
use crate::services::ffmpeg::FFmpegCommandBuilder;
use crate::services::timeline::model::{
    RenderProfile, TimelineClip, TimelineProject, TimelineTrack, TrackKind,
};
use crate::services::timeline::validate;

/// Compile a validated timeline project into an ffmpeg argv (no process spawn).
/// Missing `has_audio` entries are treated as `true` (unit tests / assume-audio).
pub fn build_timeline_args(
    project: &TimelineProject,
    output: &str,
    profile: &RenderProfile,
) -> Result<Vec<String>, AppError> {
    build_timeline_args_with_audio(project, output, profile, &HashMap::new())
}

/// Same as [`build_timeline_args`], but silent sources (`has_audio[path] == false`)
/// emit `anullsrc` instead of `[{ii}:a]atrim=...`.
pub fn build_timeline_args_with_audio(
    project: &TimelineProject,
    output: &str,
    profile: &RenderProfile,
    has_audio: &HashMap<String, bool>,
) -> Result<Vec<String>, AppError> {
    validate(project)?;

    let video_tracks: Vec<&TimelineTrack> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Video)
        .collect();
    let audio_tracks: Vec<&TimelineTrack> = project
        .tracks
        .iter()
        .filter(|t| t.kind == TrackKind::Audio)
        .collect();

    if video_tracks.len() != 1 || audio_tracks.len() > 1 {
        return Err(AppError::InvalidArgument(
            "phase 1 supports one video track and at most one audio track".into(),
        ));
    }

    for track in &project.tracks {
        for clip in &track.clips {
            if !clip.effects.is_empty() {
                return Err(AppError::InvalidArgument(
                    "clip effects are not supported yet".into(),
                ));
            }
        }
    }

    let vtrack = video_tracks[0];
    let atrack = audio_tracks.first().copied();
    let duration = project.duration_secs();

    let use_video_clips = !vtrack.muted && !vtrack.clips.is_empty();
    let use_a1 = atrack.is_some_and(|t| !t.muted && !t.clips.is_empty());

    // No clips on any track, or nothing to render after mute rules.
    if duration == 0.0 {
        return Err(AppError::InvalidArgument("timeline is empty".into()));
    }

    let (inputs, input_index) = collect_inputs(project, use_video_clips, use_a1);
    let sr = project.sample_rate;
    let w = profile.width;
    let h = profile.height;
    let fps = profile.fps;

    let mut parts: Vec<String> = Vec::new();
    let mut label_i = 0u32;
    let mut next_label = |prefix: &str| -> String {
        let l = format!("{prefix}{label_i}");
        label_i += 1;
        l
    };

    // --- Video ---
    if use_video_clips {
        let mut clips: Vec<&TimelineClip> = vtrack.clips.iter().collect();
        clips.sort_by(|a, b| a.timeline_start.total_cmp(&b.timeline_start));

        let mut v_labels: Vec<String> = Vec::new();
        let mut cursor = 0.0_f64;

        for clip in &clips {
            if clip.timeline_start > cursor {
                let gap = clip.timeline_start - cursor;
                let label = next_label("vg");
                parts.push(format!(
                    "color=c=black:s={w}x{h}:d={gap}:r={fps},format=yuv420p[{label}]"
                ));
                v_labels.push(label);
            }

            let ii = input_index[&clip.source_path];
            let si = clip.source_in;
            let so = clip.source_out;
            let label = next_label("vc");
            parts.push(format!(
                "[{ii}:v]trim=start={si}:end={so},setpts=PTS-STARTPTS,fps={fps},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[{label}]"
            ));
            v_labels.push(label);
            cursor = clip.timeline_end();
        }

        let n = v_labels.len();
        let mut concat_in = String::new();
        for l in &v_labels {
            concat_in.push_str(&format!("[{l}]"));
        }
        parts.push(format!("{concat_in}concat=n={n}:v=1:a=0[vout]"));
    } else {
        // Black canvas for muted V1 or audio-only timelines.
        parts.push(format!(
            "color=c=black:s={w}x{h}:d={duration}:r={fps},format=yuv420p[vout]"
        ));
    }

    // --- V1 linked audio (same order/gaps as video clips) ---
    let has_v1_audio = use_video_clips;
    if has_v1_audio {
        let mut clips: Vec<&TimelineClip> = vtrack.clips.iter().collect();
        clips.sort_by(|a, b| a.timeline_start.total_cmp(&b.timeline_start));

        let mut a_labels: Vec<String> = Vec::new();
        let mut cursor = 0.0_f64;

        for clip in &clips {
            if clip.timeline_start > cursor {
                let gap = clip.timeline_start - cursor;
                let label = next_label("ag");
                parts.push(anullsrc_branch(sr, gap, &label));
                a_labels.push(label);
            }

            let ii = input_index[&clip.source_path];
            let si = clip.source_in;
            let so = clip.source_out;
            let label = next_label("ac");
            if source_has_audio(has_audio, &clip.source_path) {
                parts.push(format!(
                    "[{ii}:a]atrim=start={si}:end={so},asetpts=PTS-STARTPTS,{}[{label}]",
                    audio_fmt(sr)
                ));
            } else {
                parts.push(anullsrc_branch(sr, clip.source_duration(), &label));
            }
            a_labels.push(label);
            cursor = clip.timeline_end();
        }

        let n = a_labels.len();
        let mut concat_in = String::new();
        for l in &a_labels {
            concat_in.push_str(&format!("[{l}]"));
        }
        let out_label = if use_a1 { "a_v1" } else { "aout" };
        parts.push(format!("{concat_in}concat=n={n}:v=0:a=1[{out_label}]"));
    }

    // --- A1 optional track ---
    if use_a1 {
        let atrack = atrack.expect("use_a1 implies audio track");
        let mut clips: Vec<&TimelineClip> = atrack.clips.iter().collect();
        clips.sort_by(|a, b| a.timeline_start.total_cmp(&b.timeline_start));

        // When A1 is the only audio stem, label the mix/branch [aout] directly.
        let a1_final = if has_v1_audio { "a_a1" } else { "aout" };

        let mut a1_labels: Vec<String> = Vec::new();
        for clip in &clips {
            let ii = input_index[&clip.source_path];
            let si = clip.source_in;
            let so = clip.source_out;
            let delay_ms = (clip.timeline_start * 1000.0).round() as i64;
            let label = if clips.len() == 1 {
                a1_final.to_string()
            } else {
                next_label("aa")
            };
            if source_has_audio(has_audio, &clip.source_path) {
                parts.push(format!(
                    "[{ii}:a]atrim=start={si}:end={so},asetpts=PTS-STARTPTS,adelay={delay_ms}|{delay_ms},apad,atrim=end={duration},asetpts=PTS-STARTPTS,{}[{label}]",
                    audio_fmt(sr)
                ));
            } else {
                let clip_dur = clip.source_duration();
                parts.push(format!(
                    "anullsrc=r={sr}:cl=stereo,atrim=end={clip_dur},asetpts=PTS-STARTPTS,adelay={delay_ms}|{delay_ms},apad,atrim=end={duration},asetpts=PTS-STARTPTS,{}[{label}]",
                    audio_fmt(sr)
                ));
            }
            a1_labels.push(label);
        }

        if a1_labels.len() > 1 {
            let mut mix_in = String::new();
            for l in &a1_labels {
                mix_in.push_str(&format!("[{l}]"));
            }
            let n = a1_labels.len();
            parts.push(format!(
                "{mix_in}amix=inputs={n}:duration=longest:dropout_transition=0[{a1_final}]"
            ));
        }

        if has_v1_audio {
            parts
                .push("[a_v1][a_a1]amix=inputs=2:duration=first:dropout_transition=0[aout]".into());
        }
    } else if !has_v1_audio {
        // Video-only black / muted with no A1: still need an audio stream.
        parts.push(anullsrc_branch(sr, duration, "aout"));
    }

    let graph = parts.join(";");

    let mut builder = FFmpegCommandBuilder::new();
    for path in &inputs {
        builder = builder.input(path);
    }
    builder = builder
        .filter_complex(&graph)
        .map("[vout]")
        .map("[aout]")
        .video_codec(&profile.video_codec)
        .apply_video_quality(&profile.video_codec, profile.crf);

    if let Some(preset) = &profile.preset {
        builder = builder.arg_pair("-preset", preset);
    }

    builder = builder.audio_codec(&profile.audio_codec);

    if let Some(br) = &profile.audio_bitrate {
        builder = builder.audio_bitrate(br);
    }

    Ok(builder.output(output).build())
}

fn collect_inputs(
    project: &TimelineProject,
    use_video_clips: bool,
    use_a1: bool,
) -> (Vec<String>, HashMap<String, usize>) {
    let mut inputs = Vec::new();
    let mut index = HashMap::new();
    for track in &project.tracks {
        let include = match track.kind {
            TrackKind::Video => use_video_clips,
            TrackKind::Audio => use_a1,
        };
        if !include {
            continue;
        }
        for clip in &track.clips {
            if !index.contains_key(&clip.source_path) {
                let i = inputs.len();
                index.insert(clip.source_path.clone(), i);
                inputs.push(clip.source_path.clone());
            }
        }
    }
    (inputs, index)
}

fn audio_fmt(sr: u32) -> String {
    format!("aresample={sr},aformat=sample_fmts=fltp:channel_layouts=stereo")
}

fn source_has_audio(has_audio: &HashMap<String, bool>, path: &str) -> bool {
    has_audio.get(path).copied().unwrap_or(true)
}

fn anullsrc_branch(sr: u32, duration: f64, label: &str) -> String {
    format!(
        "anullsrc=r={sr}:cl=stereo,atrim=end={duration},asetpts=PTS-STARTPTS,{}[{label}]",
        audio_fmt(sr)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    use crate::services::timeline::model::{
        ClipEffect, TimelineClip, TimelineTrack, TIMELINE_VERSION,
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

    fn video_track(id: &str, muted: bool, clips: Vec<TimelineClip>) -> TimelineTrack {
        TimelineTrack {
            id: id.into(),
            kind: TrackKind::Video,
            name: "V1".into(),
            muted,
            clips,
        }
    }

    fn audio_track(id: &str, muted: bool, clips: Vec<TimelineClip>) -> TimelineTrack {
        TimelineTrack {
            id: id.into(),
            kind: TrackKind::Audio,
            name: "A1".into(),
            muted,
            clips,
        }
    }

    fn clip(id: &str, path: &str, start: f64, source_in: f64, source_out: f64) -> TimelineClip {
        TimelineClip {
            id: id.into(),
            source_path: path.into(),
            source_in,
            source_out,
            timeline_start: start,
            effects: vec![],
        }
    }

    fn filter_complex_of(args: &[String]) -> &str {
        let pos = args
            .iter()
            .position(|a| a == "-filter_complex")
            .expect("-filter_complex");
        &args[pos + 1]
    }

    #[test]
    fn two_clips_with_gap_emits_color_and_concat3() {
        // A [0,1) at t=0, B [0,1) at t=2 → 1s mid gap → 3 concat segments
        let project = base_project(vec![video_track(
            "v1",
            false,
            vec![
                clip("a", "/tmp/a.mp4", 0.0, 0.0, 1.0),
                clip("b", "/tmp/b.mp4", 2.0, 0.0, 1.0),
            ],
        )]);
        let profile = RenderProfile::export(&project);
        let args = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap();
        let fc = filter_complex_of(&args);
        assert_eq!(fc.matches("color=").count(), 1);
        assert!(fc.contains("concat=n=3:v=1:a=0"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "-i" && w[1] == "/tmp/a.mp4"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "-i" && w[1] == "/tmp/b.mp4"));
        assert!(args.contains(&"-y".to_string()));
        assert!(args.contains(&"-hide_banner".to_string()));
        assert!(args.windows(2).any(|w| w == ["-map", "[vout]"]));
        assert!(args.windows(2).any(|w| w == ["-map", "[aout]"]));
        assert_eq!(args.last().map(String::as_str), Some("/tmp/out.mp4"));
    }

    #[test]
    fn same_track_overlap_is_error() {
        let project = base_project(vec![video_track(
            "v1",
            false,
            vec![
                clip("c1", "/tmp/a.mp4", 0.0, 0.0, 2.0),
                clip("c2", "/tmp/a.mp4", 1.0, 0.0, 1.0),
            ],
        )]);
        let profile = RenderProfile::export(&project);
        assert!(build_timeline_args(&project, "/tmp/out.mp4", &profile).is_err());
    }

    #[test]
    fn two_video_tracks_exact_message() {
        let project = base_project(vec![
            video_track("v1", false, vec![]),
            video_track("v2", false, vec![]),
        ]);
        let profile = RenderProfile::export(&project);
        let err = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Invalid argument: phase 1 supports one video track and at most one audio track"
        );
    }

    #[test]
    fn proxy_vs_export_same_inputs_and_trims_different_size_preset() {
        let project = base_project(vec![video_track(
            "v1",
            false,
            vec![
                clip("a", "/tmp/a.mp4", 0.0, 1.5, 3.5),
                clip("b", "/tmp/b.mp4", 2.0, 0.0, 1.0),
            ],
        )]);
        let export = RenderProfile::export(&project);
        let proxy = RenderProfile::proxy(&project);
        let export_args = build_timeline_args(&project, "/tmp/e.mp4", &export).unwrap();
        let proxy_args = build_timeline_args(&project, "/tmp/p.mp4", &proxy).unwrap();

        let export_inputs: Vec<_> = export_args
            .windows(2)
            .filter(|w| w[0] == "-i")
            .map(|w| w[1].clone())
            .collect();
        let proxy_inputs: Vec<_> = proxy_args
            .windows(2)
            .filter(|w| w[0] == "-i")
            .map(|w| w[1].clone())
            .collect();
        assert_eq!(export_inputs, proxy_inputs);

        let efc = filter_complex_of(&export_args);
        let pfc = filter_complex_of(&proxy_args);
        assert!(efc.contains("trim=start=1.5:end=3.5"));
        assert!(pfc.contains("trim=start=1.5:end=3.5"));
        assert!(efc.contains("trim=start=0:end=1") || efc.contains("trim=start=0:end=1.0"));
        assert!(pfc.contains("scale=640:") || pfc.contains("pad=640:"));
        assert_eq!(proxy.width, 640);
        assert!(proxy_args.windows(2).any(|w| w == ["-preset", "ultrafast"]));
        assert!(export_args.windows(2).any(|w| w == ["-preset", "medium"]));
        assert!(efc.contains("scale=1920:1080") || efc.contains("pad=1920:1080"));
    }

    #[test]
    fn empty_timeline_is_error() {
        let project = base_project(vec![video_track("v1", false, vec![])]);
        let profile = RenderProfile::export(&project);
        let err = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap_err();
        assert_eq!(err.to_string(), "Invalid argument: timeline is empty");
    }

    #[test]
    fn non_empty_effects_is_error() {
        let mut c = clip("c1", "/tmp/a.mp4", 0.0, 0.0, 1.0);
        c.effects.push(ClipEffect {
            kind: "fade".into(),
            extra: serde_json::Map::new(),
        });
        let project = base_project(vec![video_track("v1", false, vec![c])]);
        let profile = RenderProfile::export(&project);
        let err = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap_err();
        assert!(err
            .to_string()
            .contains("clip effects are not supported yet"));
    }

    #[test]
    fn leading_gap_emits_color() {
        let project = base_project(vec![video_track(
            "v1",
            false,
            vec![clip("a", "/tmp/a.mp4", 1.0, 0.0, 1.0)],
        )]);
        let profile = RenderProfile::export(&project);
        let args = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap();
        let fc = filter_complex_of(&args);
        assert!(fc.contains("color=c=black"));
        assert!(fc.contains("concat=n=2:v=1:a=0"));
        assert!(fc.contains(
            "anullsrc=r=48000:cl=stereo,atrim=end=1,asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"
        ));
    }

    #[test]
    fn silent_clip_uses_anullsrc_not_input_audio() {
        let project = base_project(vec![video_track(
            "v1",
            false,
            vec![clip("a", "/tmp/silent.mp4", 0.0, 0.0, 1.5)],
        )]);
        let profile = RenderProfile::export(&project);
        let mut has_audio = HashMap::new();
        has_audio.insert("/tmp/silent.mp4".into(), false);
        let args =
            build_timeline_args_with_audio(&project, "/tmp/out.mp4", &profile, &has_audio).unwrap();
        let fc = filter_complex_of(&args);
        assert!(fc.contains("anullsrc"));
        assert!(!fc.contains("[0:a]atrim"));
        assert!(fc.contains("aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo"));
    }

    #[test]
    fn v1_and_a1_emits_amix_first() {
        let project = base_project(vec![
            video_track("v1", false, vec![clip("v", "/tmp/v.mp4", 0.0, 0.0, 2.0)]),
            audio_track("a1", false, vec![clip("a", "/tmp/a.wav", 0.0, 0.0, 1.0)]),
        ]);
        let profile = RenderProfile::export(&project);
        let args = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap();
        let fc = filter_complex_of(&args);
        assert!(fc.contains("amix=inputs=2:duration=first"));
    }

    #[test]
    fn muted_v1_with_a1_uses_black_and_a1_aout() {
        let project = base_project(vec![
            video_track("v1", true, vec![clip("v", "/tmp/v.mp4", 0.0, 0.0, 2.0)]),
            audio_track("a1", false, vec![clip("a", "/tmp/a.wav", 0.5, 0.0, 1.0)]),
        ]);
        let profile = RenderProfile::export(&project);
        let args = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap();
        let fc = filter_complex_of(&args);
        assert!(fc.contains("color=c=black:s=1920x1080:d=2"));
        assert!(!fc.contains("concat=n="));
        assert!(fc.contains("adelay=500|500"));
        assert!(fc.contains("[aout]"));
        // No V1 linked audio concat
        assert!(!fc.contains("concat=n=") || !fc.contains(":v=0:a=1"));
    }

    #[test]
    fn dedupes_inputs_first_seen_order() {
        let project = base_project(vec![video_track(
            "v1",
            false,
            vec![
                clip("a", "/tmp/same.mp4", 0.0, 0.0, 1.0),
                clip("b", "/tmp/other.mp4", 1.0, 0.0, 1.0),
                clip("c", "/tmp/same.mp4", 2.0, 2.0, 3.0),
            ],
        )]);
        let profile = RenderProfile::export(&project);
        let args = build_timeline_args(&project, "/tmp/out.mp4", &profile).unwrap();
        let inputs: Vec<_> = args
            .windows(2)
            .filter(|w| w[0] == "-i")
            .map(|w| w[1].as_str())
            .collect();
        assert_eq!(inputs, vec!["/tmp/same.mp4", "/tmp/other.mp4"]);
        let fc = filter_complex_of(&args);
        assert!(fc.contains("[0:v]trim=start=0:end=1"));
        assert!(fc.contains("[1:v]trim="));
        assert!(fc.contains("[0:v]trim=start=2:end=3"));
    }
}
