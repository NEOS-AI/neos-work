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

Analyze, transcode/mux, extract, GIF, YouTube download, trim, clips, concat, crop, resize, rotate/flip, speed, fade, volume, watermark, viewer, multi-track timeline, job history.
