# Video studio (video-rs integration)

Port of [video-rs](https://github.com/YeonwooSung/video-rs) into the NEOS Work desktop app so local video analysis and FFmpeg tools live next to Workflow / Design Project.

## Surfaces

| Layer | Location |
|---|---|
| Rust IPC | `apps/desktop/src-tauri/src/{commands,services,models,utils}` |
| UI | `apps/desktop/src/video/` · route `/video` |
| Sidecar setup | `apps/desktop/scripts/setup-sidecars.cjs` |
| Skill | `skills/video-analyze/SKILL.md` |

Web and CLI do **not** run FFmpeg. Files stay on the machine.

## Setup

```bash
cd apps/desktop
pnpm setup:sidecars    # symlink/copy ffmpeg + ffprobe from PATH/Homebrew
# optional: brew install yt-dlp
pnpm tauri dev
```

`tauri dev` / `tauri build` run `setup:sidecars` first and bundle `binaries/ffmpeg` + `binaries/ffprobe` (`externalBin`). Runtime still falls back to `PATH` if the sidecar spawn fails. yt-dlp is optional (PATH or `yt-dlp-<triple>` next to the sidecars).

The studio is available **without an engine connection**: Mode selection → Video studio, or open `/video` directly. Timeline export is not license-gated.

## Tools

Analyze, transcode/mux, MPEG-TS → MP4 (third tab on the transcode page; MPEG-TS picker only, not the global Video filter), extract, GIF, YouTube download, trim, clips, concat, crop, resize, rotate/flip, speed, fade, volume, watermark, viewer, multi-track timeline, job history.

## MPEG-TS → MP4

v1 converts a single MPEG transport stream (`.ts` / `.m2ts` / `.mts`) to MP4 on Desktop `/video` only. Spec: [`docs/plans/PLAN_TS_TO_MP4.md`](../plans/PLAN_TS_TO_MP4.md) (Implemented, PRs #16–#19).

| Piece | Location |
|---|---|
| UI | `/video/transcode` third tab (`TsToMp4Panel` in `TranscodePage.tsx`). No extra Home card or nav item. |
| Picker | `MPEG_TS_EXTS = ["ts","m2ts","mts"]` + `openMpegTsFile()` on this tab only. Filter name `"MPEG transport stream"`. Global `VIDEO_EXTS` is unchanged. |
| IPC | `convert_ts_to_mp4` (`commands/transcode.rs`). Do not flag-extend `transcode_video` / `build_transcode_args`. |
| Policy | `services/ts_to_mp4.rs`. `FFmpegService::convert_ts_to_mp4` is a thin wrapper. |

Source of truth is probe `format_name` containing `mpegts`, not the file extension. HLS `.m3u8` / `.m3u` is rejected before probe. Output must be `.mp4`. Always `-dn -sn` (no subtitle fields on this IPC). No v1 deinterlace.

**Modes**

- `auto` — ignore user codecs/CRF; software only; mixed copy/encode allowed.
- `force_copy` — no upgrade on incompatible codecs; Run is disabled. Plan text is `tc.ts.planCopyBlocked`, not “stream copy”.
- `force_encode` — user video codec + AAC-only audio + CRF default 23. Hardware encoders only here.

**Copy policy**

- Video copy only for exact `h264` / `avc` / `hevc` / `h265`.
- Audio copy only for exact `aac` (not `aac_latm`).
- Re-encode mpeg2 / mp2 / ac-3 / `aac_latm`. Never `h264_mp4toannexb` or `hevc_mp4toannexb`.
- HEVC copy uses `-tag:v hvc1`. AAC copy uses `-bsf:a aac_adtstoasc`.
- Input `-fflags +genpts+discardcorrupt`; output `-avoid_negative_ts make_zero`; `-movflags +faststart` on this path only.

Duration-less jobs emit via `progress_event_from_stderr` in `ffmpeg.rs` `run()` (percent when computable, else 0% plus trimmed stderr when `time=` is present). Smoke: `s3_10_ts_to_mp4_copy` / `s3_11_ts_to_mp4_encode` behind `VIDEO_RS_SMOKE=1`.
